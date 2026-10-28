import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useWakeLock } from './useWakeLock'

interface FakeSentinel {
  released: boolean
  release: ReturnType<typeof vi.fn>
  addEventListener: (type: 'release', listener: () => void) => void
  /** Lo que haría el navegador al ocultar la pestaña. */
  fireRelease: () => void
}

function createSentinel(): FakeSentinel {
  const listeners: Array<() => void> = []
  const sentinel: FakeSentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true
    }),
    addEventListener: (_type, listener) => {
      listeners.push(listener)
    },
    fireRelease: () => {
      sentinel.released = true
      listeners.forEach((listener) => listener())
    },
  }
  return sentinel
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

let sentinels: FakeSentinel[]
let request: ReturnType<typeof vi.fn>

beforeEach(() => {
  sentinels = []
  request = vi.fn(async () => {
    const sentinel = createSentinel()
    sentinels.push(sentinel)
    return sentinel
  })
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock')
})

describe('useWakeLock', () => {
  it('pide el bloqueo de pantalla al montar', async () => {
    renderHook(() => useWakeLock())
    await settle()

    expect(request).toHaveBeenCalledWith('screen')
  })

  it('lo vuelve a pedir cuando el navegador lo suelta y la página vuelve a estar visible', async () => {
    renderHook(() => useWakeLock())
    await settle()

    setVisibility('hidden')
    sentinels[0].fireRelease()
    await settle()
    expect(request).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('con el bloqueo vigente no pide otro al cambiar la visibilidad', async () => {
    renderHook(() => useWakeLock())
    await settle()

    setVisibility('visible')
    await settle()

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('no pide el bloqueo con la página oculta', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })

    renderHook(() => useWakeLock())
    await settle()

    expect(request).not.toHaveBeenCalled()
  })

  it('si el navegador lo rechaza, no falla y reintenta en el próximo cambio de visibilidad', async () => {
    request.mockRejectedValueOnce(new Error('NotAllowedError'))
    renderHook(() => useWakeLock())
    await settle()

    setVisibility('visible')
    await settle()

    expect(request).toHaveBeenCalledTimes(2)
  })

  it('sin la API (navegador sin Wake Lock) no hace nada ni lanza', async () => {
    Reflect.deleteProperty(navigator, 'wakeLock')

    expect(() => renderHook(() => useWakeLock())).not.toThrow()
    await settle()
  })

  it('al desmontar suelta el bloqueo y deja de escuchar', async () => {
    const { unmount } = renderHook(() => useWakeLock())
    await settle()

    unmount()
    await settle()
    setVisibility('visible')
    await settle()

    expect(sentinels[0].release).toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('si se desmonta mientras el navegador respondía, suelta el bloqueo recién obtenido', async () => {
    let grant: (sentinel: FakeSentinel) => void = () => undefined
    request.mockImplementationOnce(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          grant = resolve
        }),
    )
    const { unmount } = renderHook(() => useWakeLock())
    unmount()

    const late = createSentinel()
    await act(async () => {
      grant(late)
    })

    expect(late.release).toHaveBeenCalled()
  })
})
