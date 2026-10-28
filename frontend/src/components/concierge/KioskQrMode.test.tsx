import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { ConciergeAPI, UnexpectedQrRedeemResponseError, type KioskQrRedeemResult } from '@/api/ConciergeAPI'
import { KIOSK_QR_RESULT_MS, KIOSK_QR_SCAN_TIMEOUT_MS } from '@/hooks/kiosk/useKioskQrRedeem'
import { KioskQrMode } from './KioskQrMode'

vi.mock('@/lib/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn() } }))

// Cámara falsa: cada `new Html5Qrcode` queda registrado; `start` se controla desde el test.
const camera = vi.hoisted(() => {
  const state = {
    ids: [] as string[],
    onDecoded: undefined as ((text: string) => void) | undefined,
    startMode: 'ok' as 'ok' | 'fail' | 'hang',
    resolveStart: (): void => undefined,
  }
  return {
    state,
    start: vi.fn(async (_camera: unknown, _config: unknown, onSuccess: (text: string) => void) => {
      state.onDecoded = onSuccess
      if (state.startMode === 'fail') {
        throw new Error('NotAllowedError')
      }
      if (state.startMode === 'hang') {
        await new Promise<void>((resolve) => {
          state.resolveStart = resolve
        })
      }
    }),
    stop: vi.fn(async (): Promise<void> => undefined),
    clear: vi.fn(),
  }
})
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor(elementId: string) {
      camera.state.ids.push(elementId)
    }
    start = camera.start
    stop = camera.stop
    clear = camera.clear
  },
}))

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: {} }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve()
    }
  })
}

async function decode(text: string): Promise<void> {
  await act(async () => {
    camera.state.onDecoded?.(text)
  })
  await flush()
}

async function openScanner(onExit = vi.fn()) {
  const view = render(<KioskQrMode onExit={onExit} />)
  await flush()
  return { ...view, onExit }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  camera.state.ids.length = 0
  camera.state.onDecoded = undefined
  camera.state.startMode = 'ok'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('KioskQrMode: cámara', () => {
  it('abre la cámara frontal, pide acercar el código y avisa que no se guardan imágenes', async () => {
    await openScanner()

    expect(camera.start).toHaveBeenCalledWith(
      { facingMode: 'user' },
      expect.objectContaining({ fps: 10 }),
      expect.any(Function),
      expect.any(Function),
    )
    expect(screen.getByRole('heading', { name: 'Acerque su código QR' })).toBeInTheDocument()
    expect(screen.getByText('La cámara solo lee el código; no se guardan imágenes.')).toBeInTheDocument()
    expect(screen.getByText('Buscando el código…')).toBeInTheDocument()
  })

  it('mientras la cámara arranca muestra "Iniciando la cámara…"', async () => {
    camera.state.startMode = 'hang'
    render(<KioskQrMode onExit={vi.fn()} />)
    await flush()

    expect(screen.getByText('Iniciando la cámara…')).toBeInTheDocument()
  })

  it('cada arranque usa su propio contenedor con id único', async () => {
    const first = await openScanner()
    first.unmount()
    await openScanner()

    expect(new Set(camera.state.ids).size).toBe(2)
  })
})

describe('KioskQrMode: canje', () => {
  it('lee un código, lo canjea una vez (sin espacios) y libera la cámara', async () => {
    const redeem = vi
      .spyOn(ConciergeAPI, 'redeemVisitQr')
      .mockResolvedValue({ status: 'granted', access: 'pedestrian', doorOpened: true })
    await openScanner()

    await decode('  ABCD1234  ')

    expect(redeem).toHaveBeenCalledTimes(1)
    expect(redeem).toHaveBeenCalledWith('ABCD1234')
    expect(camera.stop).toHaveBeenCalledTimes(1)
    expect(camera.clear).toHaveBeenCalledTimes(1)
    // El contenedor de la cámara se retira del documento.
    expect(document.querySelector('[id^="kiosk-qr-reader-"]')).toBeNull()
  })

  it('muestra "Revisando el código…" mientras espera al backend', async () => {
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockImplementation(() => new Promise<KioskQrRedeemResult>(() => undefined))
    await openScanner()

    await decode('ABCD1234')

    expect(screen.getByText('Revisando el código…')).toBeInTheDocument()
  })

  it('ignora las lecturas repetidas: un solo canje y una sola liberación de la cámara', async () => {
    let resolveRedeem: (result: KioskQrRedeemResult) => void = () => undefined
    const redeem = vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockImplementation(
      () =>
        new Promise<KioskQrRedeemResult>((resolve) => {
          resolveRedeem = resolve
        }),
    )
    await openScanner()

    // La cámara entrega el mismo código varias veces por segundo, y otro distinto.
    await decode('ABCD1234')
    await decode('ABCD1234')
    await decode('ABCD1234')
    await decode('ZZZZ9999')
    expect(redeem).toHaveBeenCalledTimes(1)

    resolveRedeem({ status: 'granted', access: 'pedestrian', doorOpened: true })
    await flush()
    await decode('ABCD1234')

    expect(redeem).toHaveBeenCalledTimes(1)
    expect(camera.stop).toHaveBeenCalledTimes(1)
  })

  it('un QR que no tiene el formato de una visita ni se manda al backend', async () => {
    const redeem = vi.spyOn(ConciergeAPI, 'redeemVisitQr')
    await openScanner()

    await decode('https://example.com/promo')

    expect(redeem).not.toHaveBeenCalled()
    expect(screen.getByText('Código no válido')).toBeInTheDocument()
    expect(camera.stop).toHaveBeenCalled()
  })

  it.each<[string, KioskQrRedeemResult, string, string]>([
    ['permitido, peatonal', { status: 'granted', access: 'pedestrian', doorOpened: true }, 'Bienvenido', 'La puerta se está abriendo.'],
    ['permitido, vehicular', { status: 'granted', access: 'vehicular', doorOpened: true }, 'Bienvenido', 'El portón se está abriendo.'],
    ['permitido pero la puerta no abrió', { status: 'granted', access: 'pedestrian', doorOpened: false }, 'Avise al conserje', 'Su código es válido, pero la puerta no se abrió sola.'],
    ['inválido', { status: 'denied', reason: 'invalid' }, 'Código no válido', 'No reconocemos este código. Revise que sea el último que le enviaron o marque el departamento.'],
    ['aún no vigente', { status: 'denied', reason: 'not_yet_valid' }, 'Todavía no puede ingresar', 'Su visita aún no está vigente. Intente de nuevo a la hora indicada.'],
    ['vencido', { status: 'denied', reason: 'expired' }, 'Código vencido', 'Pida a quien visita que le envíe un código nuevo, o marque el departamento.'],
    ['ya adentro (reutilizado)', { status: 'denied', reason: 'already_inside' }, 'Su ingreso ya quedó registrado', 'Este código ya se usó para ingresar. Si la puerta no se abrió, avise al conserje.'],
    ['sin usos', { status: 'denied', reason: 'no_uses_left' }, 'Código sin usos disponibles', 'Este código ya no admite más ingresos. Avise a quien visita o marque el departamento.'],
    ['anfitrión inactivo', { status: 'denied', reason: 'host_inactive' }, 'No podemos autorizar el ingreso', 'Avise al conserje.'],
  ])('resultado %s: pantalla propia', async (_label, result, title, detail) => {
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockResolvedValue(result)
    await openScanner()

    await decode('ABCD1234')

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByText(detail)).toBeInTheDocument()
  })

  it('un 429 pide esperar un momento', async () => {
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockRejectedValue(httpError(429))
    await openScanner()

    await decode('ABCD1234')

    expect(screen.getByRole('heading', { name: 'Espere un momento' })).toBeInTheDocument()
  })

  it.each([
    ['sin red', new AxiosError('Network Error', 'ERR_NETWORK')],
    ['timeout', new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED')],
    ['un 500', httpError(500)],
    ['un 403', httpError(403)],
    ['respuesta fuera del contrato', new UnexpectedQrRedeemResponseError()],
  ])('%s: "No pudimos confirmar el código" (y no afirma nada del código)', async (_label, error) => {
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockRejectedValue(error)
    await openScanner()

    await decode('ABCD1234')

    expect(screen.getByRole('heading', { name: 'No pudimos confirmar el código' })).toBeInTheDocument()
    expect(screen.queryByText('Bienvenido')).not.toBeInTheDocument()
  })
})

describe('KioskQrMode: salida', () => {
  it('muestra el resultado 6 s y vuelve al inicio', async () => {
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockResolvedValue({ status: 'granted', access: 'pedestrian', doorOpened: true })
    const { onExit } = await openScanner()
    await decode('ABCD1234')

    await flush(KIOSK_QR_RESULT_MS - 1)
    expect(onExit).not.toHaveBeenCalled()

    await flush(1)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('"Volver al inicio" en el resultado vuelve de inmediato', async () => {
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockResolvedValue({ status: 'denied', reason: 'expired' })
    const { onExit } = await openScanner()
    await decode('ABCD1234')

    fireEvent.click(screen.getByRole('button', { name: 'Volver al inicio' }))

    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('sin código en 30 s vuelve al inicio, libera la cámara y no canjea nada', async () => {
    const redeem = vi.spyOn(ConciergeAPI, 'redeemVisitQr')
    const { onExit } = await openScanner()

    await flush(KIOSK_QR_SCAN_TIMEOUT_MS - 1)
    expect(onExit).not.toHaveBeenCalled()

    await flush(1)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(camera.stop).toHaveBeenCalled()
    expect(redeem).not.toHaveBeenCalled()
  })

  it('el plazo de 30 s no corta un canje en curso', async () => {
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockImplementation(() => new Promise<KioskQrRedeemResult>(() => undefined))
    const { onExit } = await openScanner()
    await flush(KIOSK_QR_SCAN_TIMEOUT_MS - 5_000)
    await decode('ABCD1234')

    await flush(KIOSK_QR_SCAN_TIMEOUT_MS)

    expect(onExit).not.toHaveBeenCalled()
  })

  it('"Volver" cancela: vuelve al inicio y libera la cámara', async () => {
    const { onExit } = await openScanner()

    fireEvent.click(screen.getByRole('button', { name: 'Volver' }))

    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('al desmontar con la cámara activa la libera', async () => {
    const { unmount } = await openScanner()

    unmount()
    await flush()

    expect(camera.stop).toHaveBeenCalledTimes(1)
    expect(camera.clear).toHaveBeenCalledTimes(1)
  })

  it('al desmontar con la cámara todavía arrancando la detiene apenas arranca', async () => {
    camera.state.startMode = 'hang'
    const { unmount } = render(<KioskQrMode onExit={vi.fn()} />)
    await flush()

    unmount()
    await flush()
    expect(camera.stop).not.toHaveBeenCalled()

    await act(async () => {
      camera.state.resolveStart()
    })
    await flush()
    expect(camera.stop).toHaveBeenCalledTimes(1)
  })

  it('al desmontar no queda ningún timer vivo ni se llama a onExit', async () => {
    const onExit = vi.fn()
    const { unmount } = render(<KioskQrMode onExit={onExit} />)
    await flush()

    unmount()
    await flush(KIOSK_QR_SCAN_TIMEOUT_MS * 2)

    expect(onExit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('una respuesta que llega tras desmontar no hace nada', async () => {
    let resolveRedeem: (result: KioskQrRedeemResult) => void = () => undefined
    vi.spyOn(ConciergeAPI, 'redeemVisitQr').mockImplementation(
      () =>
        new Promise<KioskQrRedeemResult>((resolve) => {
          resolveRedeem = resolve
        }),
    )
    const onExit = vi.fn()
    const { unmount } = render(<KioskQrMode onExit={onExit} />)
    await flush()
    await decode('ABCD1234')

    unmount()
    resolveRedeem({ status: 'granted', access: 'pedestrian', doorOpened: true })
    await flush(KIOSK_QR_RESULT_MS * 2)

    expect(onExit).not.toHaveBeenCalled()
  })
})

describe('KioskQrMode: falla de cámara', () => {
  it('sin permiso o sin cámara: lo dice, ofrece marcar el departamento y vuelve al inicio a los 6 s', async () => {
    camera.state.startMode = 'fail'
    const onExit = vi.fn()
    render(<KioskQrMode onExit={onExit} />)
    await flush()

    expect(screen.getByRole('heading', { name: 'No pudimos usar la cámara' })).toBeInTheDocument()
    expect(screen.getByText('Marque el departamento o avise al conserje.')).toBeInTheDocument()
    expect(camera.stop).toHaveBeenCalled()

    await flush(KIOSK_QR_RESULT_MS)
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
