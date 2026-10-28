import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { kioskCredentialStore } from '@/services/kioskCredentialStore'
import {
  ConciergeAPI,
  KIOSK_REQUEST_TIMEOUT_MS,
  KioskNotPairedError,
  UnexpectedDeviceResponseError,
  UnexpectedQrRedeemResponseError,
} from './ConciergeAPI'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const CREDENTIAL = { hubId: 'hub-kiosk-1', hubSecret: 'kiosk-secret' }
const HUB_HEADERS = { 'X-Hub-Id': 'hub-kiosk-1', 'X-Hub-Secret': 'kiosk-secret' }

function httpError(status: number, data: unknown = {}): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  kioskCredentialStore.clear()
})

describe('ConciergeAPI: llamadas del kiosko', () => {
  it('manda los headers de hub desde el store emparejado, sin cookie', async () => {
    kioskCredentialStore.save(CREDENTIAL)
    apiMock.request.mockResolvedValueOnce({ data: { sessionId: 's-1', ephemeralToken: 't', expiresAt: '' } })

    await ConciergeAPI.startSession('socket-hub-1')

    expect(apiMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/concierge/session/start',
        headers: HUB_HEADERS,
        withCredentials: false,
        data: expect.objectContaining({ socketId: 'socket-hub-1' }),
      }),
    )
  })

  it('el polling de /status del kiosko también va con los headers de hub', async () => {
    kioskCredentialStore.save(CREDENTIAL)
    apiMock.request.mockResolvedValueOnce({ data: { active: true } })

    await ConciergeAPI.getKioskSessionStatus('s-1')

    expect(apiMock.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', url: '/concierge/session/s-1/status', headers: HUB_HEADERS }),
    )
  })

  it('sin credencial emparejada no llama al backend', async () => {
    await expect(ConciergeAPI.getAgentConfig('15')).rejects.toBeInstanceOf(KioskNotPairedError)
    expect(apiMock.request).not.toHaveBeenCalled()
  })

  it('un 401 borra la credencial (y propaga el error)', async () => {
    kioskCredentialStore.save(CREDENTIAL)
    apiMock.request.mockRejectedValueOnce(httpError(401))

    await expect(ConciergeAPI.executeTool('s-1', 'buscar_residente', {})).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(kioskCredentialStore.get()).toBeNull()
    expect(kioskCredentialStore.getLastClearReason()).toBe('unauthorized')
  })

  it.each([429, 403, 500])('un %s no toca la credencial (solo un 401 la borra)', async (status) => {
    kioskCredentialStore.save(CREDENTIAL)
    apiMock.request.mockRejectedValueOnce(httpError(status))

    await expect(ConciergeAPI.endSession('s-1', 'completed')).rejects.toBeInstanceOf(AxiosError)

    expect(kioskCredentialStore.get()).toEqual(CREDENTIAL)
    expect(kioskCredentialStore.getLastClearReason()).not.toBe('unauthorized')
  })

  it('un 401 tardío de la credencial anterior no borra una recién emparejada', async () => {
    kioskCredentialStore.save(CREDENTIAL)
    let rejectRequest: (error: unknown) => void = () => undefined
    apiMock.request.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRequest = reject
      }),
    )

    const pending = ConciergeAPI.getKioskSessionStatus('s-1')
    const freshCredential = { hubId: 'hub-kiosk-2', hubSecret: 'nuevo' }
    kioskCredentialStore.save(freshCredential)
    rejectRequest(httpError(401))

    await expect(pending).rejects.toBeInstanceOf(AxiosError)
    expect(kioskCredentialStore.get()).toEqual(freshCredential)
  })

  it('codifica el sessionId y el número de casa en la ruta', async () => {
    kioskCredentialStore.save(CREDENTIAL)
    apiMock.request.mockResolvedValue({ data: {} })

    await ConciergeAPI.getAgentConfig('15/../x')
    await ConciergeAPI.endSession('a/b')

    expect(apiMock.request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ url: '/concierge/agent-config/15%2F..%2Fx' }),
    )
    expect(apiMock.request).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: '/concierge/session/a%2Fb/end' }))
  })
})

describe('ConciergeAPI.getDeviceIdentity (emparejamiento)', () => {
  it('valida la credencial candidata con sus propios headers', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: { hubId: 'hub-kiosk-1', type: 'web-kiosk', organizationId: 'org-1' },
    })

    await expect(ConciergeAPI.getDeviceIdentity(CREDENTIAL)).resolves.toEqual({
      hubId: 'hub-kiosk-1',
      type: 'web-kiosk',
      organizationId: 'org-1',
    })
    expect(apiMock.get).toHaveBeenCalledWith('/concierge/device', {
      headers: HUB_HEADERS,
      withCredentials: false,
      timeout: KIOSK_REQUEST_TIMEOUT_MS,
    })
  })

  it('rechaza una respuesta que no cumple el contrato', async () => {
    apiMock.get.mockResolvedValueOnce({ data: { hubId: 'hub-kiosk-1', type: 'otro-tipo', organizationId: null } })

    await expect(ConciergeAPI.getDeviceIdentity(CREDENTIAL)).rejects.toBeInstanceOf(UnexpectedDeviceResponseError)
  })

  it('un 401 al validar una candidata no borra la credencial guardada', async () => {
    const stored = { hubId: 'hub-guardado', hubSecret: 'ok' }
    kioskCredentialStore.save(stored)
    apiMock.get.mockRejectedValueOnce(httpError(401))

    await expect(ConciergeAPI.getDeviceIdentity(CREDENTIAL)).rejects.toBeInstanceOf(AxiosError)
    expect(kioskCredentialStore.get()).toEqual(stored)
  })
})

describe('ConciergeAPI: timeout y errores de red del kiosko', () => {
  beforeEach(() => {
    kioskCredentialStore.save(CREDENTIAL)
  })

  it('toda request del kiosko lleva timeout de 10 s', async () => {
    apiMock.request.mockResolvedValue({ data: {} })

    await ConciergeAPI.startSession('socket-1')
    await ConciergeAPI.getAgentConfig('15')
    await ConciergeAPI.executeTool('s-1', 'buscar_residente', {})
    await ConciergeAPI.endSession('s-1', 'completed')
    await ConciergeAPI.getKioskSessionStatus('s-1')
    await ConciergeAPI.pingDevice()

    expect(KIOSK_REQUEST_TIMEOUT_MS).toBe(10_000)
    for (const [config] of apiMock.request.mock.calls) {
      expect(config).toEqual(expect.objectContaining({ timeout: 10_000 }))
    }
  })

  it('el latido es un GET a /concierge/device con los headers de hub', async () => {
    apiMock.request.mockResolvedValueOnce({ data: { hubId: 'h', type: 'web-kiosk', organizationId: null } })

    await ConciergeAPI.pingDevice()

    expect(apiMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/concierge/device',
        headers: HUB_HEADERS,
        withCredentials: false,
      }),
    )
  })

  it('un error de red o un timeout NO borra la credencial', async () => {
    const networkError = new AxiosError('Network Error', 'ERR_NETWORK')
    const timeoutError = new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED')
    apiMock.request.mockRejectedValueOnce(networkError).mockRejectedValueOnce(timeoutError)

    await expect(ConciergeAPI.pingDevice()).rejects.toBe(networkError)
    await expect(ConciergeAPI.getKioskSessionStatus('s-1')).rejects.toBe(timeoutError)

    expect(kioskCredentialStore.get()).toEqual(CREDENTIAL)
  })

  it('un 5xx tampoco borra la credencial; un 401 sí', async () => {
    apiMock.request.mockRejectedValueOnce(httpError(503))
    await expect(ConciergeAPI.pingDevice()).rejects.toBeInstanceOf(AxiosError)
    expect(kioskCredentialStore.get()).toEqual(CREDENTIAL)

    apiMock.request.mockRejectedValueOnce(httpError(401))
    await expect(ConciergeAPI.pingDevice()).rejects.toBeInstanceOf(AxiosError)
    expect(kioskCredentialStore.get()).toBeNull()
  })
})

describe('ConciergeAPI.redeemVisitQr (QR de visitas en el kiosko)', () => {
  beforeEach(() => {
    kioskCredentialStore.save(CREDENTIAL)
  })

  it('POST /concierge/qr/redeem con los headers de hub y { qrCode }', async () => {
    apiMock.request.mockResolvedValueOnce({ data: { status: 'granted', access: 'pedestrian', doorOpened: true } })

    const result = await ConciergeAPI.redeemVisitQr('ABCD1234')

    expect(result).toEqual({ status: 'granted', access: 'pedestrian', doorOpened: true })
    expect(apiMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: '/concierge/qr/redeem',
        headers: HUB_HEADERS,
        withCredentials: false,
        timeout: 10_000,
        data: { qrCode: 'ABCD1234' },
      }),
    )
  })

  it.each([
    [{ status: 'granted', access: 'vehicular', doorOpened: false }],
    [{ status: 'denied', reason: 'invalid' }],
    [{ status: 'denied', reason: 'not_yet_valid' }],
    [{ status: 'denied', reason: 'expired' }],
    [{ status: 'denied', reason: 'already_inside' }],
    [{ status: 'denied', reason: 'no_uses_left' }],
    [{ status: 'denied', reason: 'host_inactive' }],
  ])('entrega tal cual la respuesta del contrato %o', async (body) => {
    apiMock.request.mockResolvedValueOnce({ data: body })

    await expect(ConciergeAPI.redeemVisitQr('ABCD1234')).resolves.toEqual(body)
  })

  it.each([
    [{ status: 'granted', access: 'otro', doorOpened: true }],
    [{ status: 'granted', access: 'pedestrian' }],
    [{ status: 'denied', reason: 'desconocido' }],
    [{ status: 'quizas' }],
    ['texto'],
    [null],
  ])('rechaza un cuerpo que no cumple el contrato %o', async (body) => {
    apiMock.request.mockResolvedValueOnce({ data: body })

    await expect(ConciergeAPI.redeemVisitQr('ABCD1234')).rejects.toBeInstanceOf(UnexpectedQrRedeemResponseError)
  })

  it('un 401 desempareja (como cualquier request del kiosko)', async () => {
    apiMock.request.mockRejectedValueOnce(httpError(401))

    await expect(ConciergeAPI.redeemVisitQr('ABCD1234')).rejects.toBeInstanceOf(AxiosError)
    expect(kioskCredentialStore.get()).toBeNull()
  })

  it('un 403 y un 429 se propagan sin tocar la credencial', async () => {
    apiMock.request.mockRejectedValueOnce(httpError(403)).mockRejectedValueOnce(httpError(429))

    await expect(ConciergeAPI.redeemVisitQr('ABCD1234')).rejects.toBeInstanceOf(AxiosError)
    await expect(ConciergeAPI.redeemVisitQr('ABCD1234')).rejects.toBeInstanceOf(AxiosError)
    expect(kioskCredentialStore.get()).toEqual(CREDENTIAL)
  })

  it('sin credencial emparejada no llama al backend', async () => {
    kioskCredentialStore.clear()

    await expect(ConciergeAPI.redeemVisitQr('ABCD1234')).rejects.toBeInstanceOf(KioskNotPairedError)
    expect(apiMock.request).not.toHaveBeenCalled()
  })
})

describe('ConciergeAPI: llamadas del residente', () => {
  it('respondToVisitor envía exactamente { approved, visitId }, sin residentId ni headers de hub', async () => {
    kioskCredentialStore.save(CREDENTIAL)
    apiMock.post.mockResolvedValueOnce({ data: { success: true, message: 'ok', entryRegistered: true } })

    await ConciergeAPI.respondToVisitor('s-1', true, 'visit-1')

    expect(apiMock.post).toHaveBeenCalledTimes(1)
    const [url, body, config] = apiMock.post.mock.calls[0]
    expect(url).toBe('/concierge/session/s-1/respond')
    expect(body).toStrictEqual({ approved: true, visitId: 'visit-1' })
    expect(Object.keys(body as object).sort()).toEqual(['approved', 'visitId'])
    expect(config).toBeUndefined()
    expect(apiMock.request).not.toHaveBeenCalled()
  })

  it('checkSessionStatus del residente va por cookie (sin headers de hub)', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { active: true, visitId: 'visit-1' } })

    await ConciergeAPI.checkSessionStatus('s-1')

    expect(apiMock.post).toHaveBeenCalledWith('/concierge/session/s-1/status')
  })
})
