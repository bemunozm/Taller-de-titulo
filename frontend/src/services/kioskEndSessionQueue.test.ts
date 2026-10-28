import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { ConciergeAPI } from '@/api/ConciergeAPI'
import {
  KIOSK_END_QUEUE_MAX_AGE_MS,
  KIOSK_END_QUEUE_MAX_ATTEMPTS,
  KIOSK_END_QUEUE_RETRY_MS,
  KioskEndSessionQueue,
  isRetryableEndError,
} from './kioskEndSessionQueue'

vi.mock('@/lib/axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn() } }))

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: {} }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

const networkError = () => new AxiosError('Network Error', 'ERR_NETWORK')
const END_RESPONSE = { sessionId: 's', status: 'completed', duration: 1, visitCreated: false }

let queue: KioskEndSessionQueue

beforeEach(() => {
  vi.useFakeTimers()
  queue = new KioskEndSessionQueue()
})

afterEach(() => {
  queue.clear()
  vi.useRealTimers()
})

describe('isRetryableEndError', () => {
  it('reintenta sin respuesta (red, timeout), 5xx y 429', () => {
    expect(isRetryableEndError(networkError())).toBe(true)
    expect(isRetryableEndError(new AxiosError('timeout', 'ECONNABORTED'))).toBe(true)
    expect(isRetryableEndError(httpError(500))).toBe(true)
    expect(isRetryableEndError(httpError(503))).toBe(true)
    expect(isRetryableEndError(httpError(429))).toBe(true)
  })

  it('no reintenta una respuesta definitiva ni un error que no es de HTTP', () => {
    for (const status of [400, 401, 403, 404, 409]) {
      expect(isRetryableEndError(httpError(status))).toBe(false)
    }
    expect(isRetryableEndError(new Error('boom'))).toBe(false)
  })
})

describe('KioskEndSessionQueue.endOrQueue', () => {
  it('cierra la sesión ya y no deja nada en cola si sale bien', async () => {
    const end = vi.spyOn(ConciergeAPI, 'endSession').mockResolvedValue(END_RESPONSE)

    await queue.endOrQueue('s-1', 'cancelled')

    expect(end).toHaveBeenCalledWith('s-1', 'cancelled')
    expect(queue.size).toBe(0)
  })

  it('si falla por la red, la deja en cola y NO lanza', async () => {
    vi.spyOn(ConciergeAPI, 'endSession').mockRejectedValue(networkError())

    await expect(queue.endOrQueue('s-1', 'cancelled')).resolves.toBeUndefined()

    expect(queue.size).toBe(1)
  })

  it('un error definitivo (404, 409) se propaga y no se encola', async () => {
    vi.spyOn(ConciergeAPI, 'endSession').mockRejectedValue(httpError(409))

    await expect(queue.endOrQueue('s-1', 'cancelled')).rejects.toBeInstanceOf(AxiosError)

    expect(queue.size).toBe(0)
  })

  it('no duplica la misma sesión', async () => {
    vi.spyOn(ConciergeAPI, 'endSession').mockRejectedValue(networkError())

    await queue.endOrQueue('s-1', 'cancelled')
    await queue.endOrQueue('s-1', 'timeout')

    expect(queue.size).toBe(1)
  })
})

describe('KioskEndSessionQueue.flush', () => {
  it('reintenta los pendientes con su estado final y los saca de la cola', async () => {
    const end = vi
      .spyOn(ConciergeAPI, 'endSession')
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(END_RESPONSE)
    await queue.endOrQueue('s-1', 'timeout')

    await queue.flush()

    expect(end).toHaveBeenLastCalledWith('s-1', 'timeout')
    expect(queue.size).toBe(0)
  })

  it('los que vuelven a fallar por la red siguen en cola', async () => {
    vi.spyOn(ConciergeAPI, 'endSession').mockRejectedValue(networkError())
    await queue.endOrQueue('s-1', 'cancelled')

    await queue.flush()

    expect(queue.size).toBe(1)
  })

  it('los que reciben una respuesta definitiva (404) se descartan', async () => {
    vi.spyOn(ConciergeAPI, 'endSession').mockRejectedValueOnce(networkError()).mockRejectedValue(httpError(404))
    await queue.endOrQueue('s-1', 'cancelled')

    await queue.flush()

    expect(queue.size).toBe(0)
  })

  it('se reintenta solo cada 15 s mientras queden pendientes', async () => {
    const end = vi
      .spyOn(ConciergeAPI, 'endSession')
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue(END_RESPONSE)
    await queue.endOrQueue('s-1', 'cancelled')

    await vi.advanceTimersByTimeAsync(KIOSK_END_QUEUE_RETRY_MS - 1)
    expect(end).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(end).toHaveBeenCalledTimes(2)
    expect(queue.size).toBe(1)

    await vi.advanceTimersByTimeAsync(KIOSK_END_QUEUE_RETRY_MS)
    expect(end).toHaveBeenCalledTimes(3)
    expect(queue.size).toBe(0)

    // Cola vacía: no queda ningún timer vivo.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('descarta lo que lleva más de 30 min (el backend ya expiró la sesión)', async () => {
    const end = vi.spyOn(ConciergeAPI, 'endSession').mockRejectedValueOnce(networkError())
    await queue.endOrQueue('s-1', 'cancelled')
    queue.clear()
    queue.enqueue('s-viejo', 'cancelled')

    vi.setSystemTime(Date.now() + KIOSK_END_QUEUE_MAX_AGE_MS + 1)
    await queue.flush()

    expect(end).toHaveBeenCalledTimes(1)
    expect(queue.size).toBe(0)
  })

  it('deja de insistir tras el máximo de intentos', async () => {
    const end = vi.spyOn(ConciergeAPI, 'endSession').mockRejectedValue(networkError())
    queue.enqueue('s-1', 'cancelled')

    for (let attempt = 0; attempt < KIOSK_END_QUEUE_MAX_ATTEMPTS + 2; attempt += 1) {
      await queue.flush()
    }

    expect(end).toHaveBeenCalledTimes(KIOSK_END_QUEUE_MAX_ATTEMPTS)
    expect(queue.size).toBe(0)
  })

  it('lo encolado mientras se vacía no se pierde', async () => {
    let release: () => void = () => undefined
    vi.spyOn(ConciergeAPI, 'endSession').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(END_RESPONSE)
        }),
    )
    queue.enqueue('s-1', 'cancelled')

    const flushing = queue.flush()
    queue.enqueue('s-2', 'timeout')
    release()
    await flushing

    expect(queue.size).toBe(1)
  })

  it('con la cola acotada (10), descarta el más viejo', () => {
    for (let index = 0; index < 12; index += 1) {
      queue.enqueue(`s-${index}`, 'cancelled')
    }

    expect(queue.size).toBe(10)
  })
})
