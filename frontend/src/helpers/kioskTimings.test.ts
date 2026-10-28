import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './kioskTimings'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withTimeout', () => {
  it('devuelve el valor si llega a tiempo y limpia su timer', async () => {
    const result = withTimeout(Promise.resolve('ok'), 1_000, 'tarde')

    await expect(result).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rechaza con el mensaje si no termina en el plazo', async () => {
    const result = withTimeout(new Promise<string>(() => undefined), 1_000, 'tarde')
    const assertion = expect(result).rejects.toThrow('tarde')

    await vi.advanceTimersByTimeAsync(1_000)

    await assertion
  })

  it('propaga el error original si falla antes del plazo', async () => {
    const original = new Error('falló antes')

    await expect(withTimeout(Promise.reject(original), 1_000, 'tarde')).rejects.toBe(original)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un rechazo que no es Error se informa con el mensaje del plazo', async () => {
    await expect(withTimeout(Promise.reject('texto'), 1_000, 'sin detalle')).rejects.toThrow('sin detalle')
  })
})
