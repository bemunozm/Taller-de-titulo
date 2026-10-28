import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { ConciergeAPI, KioskNotPairedError } from '@/api/ConciergeAPI'
import {
  KIOSK_PING_INTERVAL_MS,
  KIOSK_PING_RECHECK_MS,
  KIOSK_PING_RECOVERY_MS,
  useKioskConnectivity,
} from './useKioskConnectivity'

vi.mock('@/lib/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn() } }))

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: {} }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK')

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useKioskConnectivity', () => {
  it('arranca online y hace un latido cada 30 s', async () => {
    const ping = vi.spyOn(ConciergeAPI, 'pingDevice').mockResolvedValue(undefined)
    const { result } = renderHook(() => useKioskConnectivity())
    expect(result.current.status).toBe('online')

    await advance(KIOSK_PING_INTERVAL_MS - 1)
    expect(ping).not.toHaveBeenCalled()

    await advance(1)
    expect(ping).toHaveBeenCalledTimes(1)

    await advance(KIOSK_PING_INTERVAL_MS)
    expect(ping).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('online')
  })

  it('arranca offline si el navegador ya lo está, y revisa más seguido', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const ping = vi.spyOn(ConciergeAPI, 'pingDevice').mockRejectedValue(networkError())

    const { result } = renderHook(() => useKioskConnectivity())
    expect(result.current.status).toBe('offline')

    await advance(KIOSK_PING_RECOVERY_MS)
    expect(ping).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('offline')
  })

  it('el evento offline cambia el estado ya; online solo lo quita cuando el backend responde', async () => {
    const ping = vi.spyOn(ConciergeAPI, 'pingDevice').mockResolvedValue(undefined)
    const { result } = renderHook(() => useKioskConnectivity())

    setNavigatorOnline(false)
    expect(result.current.status).toBe('offline')

    setNavigatorOnline(true)
    expect(result.current.status).toBe('offline')
    await advance(0)

    expect(ping).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('online')
  })

  it('un solo fallo no la declara caída; el segundo, 5 s después, sí (backend-down)', async () => {
    vi.spyOn(ConciergeAPI, 'pingDevice').mockRejectedValue(networkError())
    const { result } = renderHook(() => useKioskConnectivity())

    await advance(KIOSK_PING_INTERVAL_MS)
    expect(result.current.status).toBe('online')

    await advance(KIOSK_PING_RECHECK_MS)
    expect(result.current.status).toBe('backend-down')
  })

  it('un solo fallo seguido de un acierto no cambia nada', async () => {
    vi.spyOn(ConciergeAPI, 'pingDevice').mockRejectedValueOnce(networkError()).mockResolvedValue(undefined)
    const { result } = renderHook(() => useKioskConnectivity())

    await advance(KIOSK_PING_INTERVAL_MS + KIOSK_PING_RECHECK_MS)

    expect(result.current.status).toBe('online')
  })

  it('caída por un 5xx; se recupera sola con el siguiente latido bueno', async () => {
    const ping = vi.spyOn(ConciergeAPI, 'pingDevice').mockRejectedValue(httpError(503))
    const { result } = renderHook(() => useKioskConnectivity())
    await advance(KIOSK_PING_INTERVAL_MS + KIOSK_PING_RECHECK_MS)
    expect(result.current.status).toBe('backend-down')

    ping.mockResolvedValue(undefined)
    await advance(KIOSK_PING_RECOVERY_MS)

    expect(result.current.status).toBe('online')
  })

  it.each([400, 403, 404, 429])('un %i del latido prueba que el backend respondió: sigue online', async (status) => {
    vi.spyOn(ConciergeAPI, 'pingDevice').mockRejectedValue(httpError(status))
    const { result } = renderHook(() => useKioskConnectivity())

    await advance(KIOSK_PING_INTERVAL_MS * 3)

    expect(result.current.status).toBe('online')
  })

  it('sin credencial (p. ej. tras un 401) deja de vigilar y no reintenta', async () => {
    const ping = vi.spyOn(ConciergeAPI, 'pingDevice').mockRejectedValue(new KioskNotPairedError())
    renderHook(() => useKioskConnectivity())

    await advance(KIOSK_PING_INTERVAL_MS * 4)

    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('al volver la pestaña a visible hace un latido', async () => {
    const ping = vi.spyOn(ConciergeAPI, 'pingDevice').mockResolvedValue(undefined)
    renderHook(() => useKioskConnectivity())

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(ping).toHaveBeenCalledTimes(1)
  })

  it('al desmontar quita las escuchas y los timers', async () => {
    const ping = vi.spyOn(ConciergeAPI, 'pingDevice').mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useKioskConnectivity())

    unmount()
    window.dispatchEvent(new Event('online'))
    await advance(KIOSK_PING_INTERVAL_MS * 3)

    expect(ping).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
