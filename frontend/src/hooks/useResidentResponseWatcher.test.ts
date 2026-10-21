import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { kioskCredentialStore } from '@/services/kioskCredentialStore'
import {
  RESIDENT_RESPONSE_MAX_WAIT_MS,
  RESIDENT_RESPONSE_POLL_INTERVAL_MS,
} from '@/helpers/residentResponseWatcher'
import type { KioskWaitOutcome } from '@/helpers/kioskResidentResponse'
import { useResidentResponseWatcher } from './useResidentResponseWatcher'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>()
  const unsubscribes = new Map<string, ReturnType<typeof vi.fn>>()
  return {
    handlers,
    unsubscribes,
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler)
      const unsubscribe = vi.fn(() => {
        handlers.delete(event)
      })
      unsubscribes.set(event, unsubscribe)
      return unsubscribe
    }),
  }
})
vi.mock('@/services/KioskSocketService', () => ({ kioskSocket: { on: socketMock.on } }))

const POLL_MS = RESIDENT_RESPONSE_POLL_INTERVAL_MS
const PENDING = { active: true, residentResponse: 'pending', entryRegistered: null, visitId: 'v-1' }

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: {} }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

interface HookProps {
  sessionId: string | null
  awaitingResponse: boolean
}

function renderWatcher(initialProps: HookProps) {
  const onOutcome = vi.fn<(outcome: KioskWaitOutcome) => void>()
  const view = renderHook((props: HookProps) => useResidentResponseWatcher({ ...props, onOutcome }), {
    initialProps,
  })
  return { ...view, onOutcome }
}

function statusCallsFor(sessionId: string): number {
  return apiMock.request.mock.calls.filter(
    ([config]) => (config as { url?: string }).url === `/concierge/session/${sessionId}/status`,
  ).length
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  socketMock.handlers.clear()
  socketMock.unsubscribes.clear()
  window.localStorage.clear()
  kioskCredentialStore.clear()
  kioskCredentialStore.save({ hubId: 'hub-kiosk-1', hubSecret: 'kiosk-secret' })
  apiMock.request.mockResolvedValue({ data: PENDING })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useResidentResponseWatcher', () => {
  it('escucha el socket desde que hay sessionId, pero consulta /status solo con awaitingResponse', async () => {
    const { rerender } = renderWatcher({ sessionId: 's-1', awaitingResponse: false })

    expect(socketMock.on).toHaveBeenCalledWith('visitor:response:s-1', expect.any(Function))
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(apiMock.request).not.toHaveBeenCalled()

    rerender({ sessionId: 's-1', awaitingResponse: true })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(statusCallsFor('s-1')).toBe(1)
    expect(apiMock.request).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'X-Hub-Id': 'hub-kiosk-1', 'X-Hub-Secret': 'kiosk-secret' } }),
    )
  })

  it('awaitingResponse que vuelve a false no detiene la espera de la sesión en curso ni la duplica', async () => {
    const { rerender } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    rerender({ sessionId: 's-1', awaitingResponse: false })
    rerender({ sessionId: 's-1', awaitingResponse: true })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(statusCallsFor('s-1')).toBe(2)
  })

  it('cambio de sessionId: se desuscribe de la sesión anterior y deja de consultarla', async () => {
    const { rerender } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(statusCallsFor('s-1')).toBe(1)

    rerender({ sessionId: 's-2', awaitingResponse: true })
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)

    expect(socketMock.unsubscribes.get('visitor:response:s-1')).toHaveBeenCalledTimes(1)
    expect(statusCallsFor('s-1')).toBe(1)
    expect(statusCallsFor('s-2')).toBe(2)
  })

  it('la respuesta por socket llega una sola vez a onOutcome', () => {
    const { onOutcome } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })
    const handler = socketMock.handlers.get('visitor:response:s-1')

    handler?.({ sessionId: 's-1', approved: true, entryRegistered: true })
    handler?.({ sessionId: 's-1', approved: false, entryRegistered: false })

    expect(onOutcome).toHaveBeenCalledTimes(1)
    expect(onOutcome).toHaveBeenCalledWith('admitted')
  })

  it('desmontar limpia el socket y todos los timers (polling y espera máxima)', async () => {
    const { unmount, onOutcome } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(socketMock.unsubscribes.get('visitor:response:s-1')).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS)
    expect(onOutcome).not.toHaveBeenCalled()
  })

  it('sin respuesta en 3 minutos → onOutcome("no-response")', async () => {
    const { onOutcome } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })

    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS)

    expect(onOutcome).toHaveBeenCalledTimes(1)
    expect(onOutcome).toHaveBeenCalledWith('no-response')
  })

  it('sesión cerrada sin respuesta → onOutcome("closed")', async () => {
    apiMock.request.mockResolvedValue({ data: { active: false, residentResponse: 'pending', entryRegistered: null } })
    const { onOutcome } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })

    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(onOutcome).toHaveBeenCalledWith('closed')
  })

  it('un 429 en /status es transitorio: el polling sigue', async () => {
    apiMock.request.mockRejectedValueOnce(httpError(429)).mockResolvedValue({
      data: { active: false, residentResponse: 'denied', entryRegistered: false },
    })
    const { onOutcome } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(onOutcome).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(statusCallsFor('s-1')).toBe(2)
    expect(onOutcome).toHaveBeenCalledWith('denied')
    expect(kioskCredentialStore.get()).not.toBeNull()
  })

  it.each([401, 403, 404])('un %s en /status no se reintenta (la espera máxima sigue)', async (status) => {
    apiMock.request.mockRejectedValue(httpError(status))
    const { onOutcome } = renderWatcher({ sessionId: 's-1', awaitingResponse: true })

    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    expect(statusCallsFor('s-1')).toBe(1)

    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS)
    expect(onOutcome).toHaveBeenCalledWith('no-response')
  })

  it('usa el onOutcome más reciente sin reiniciar la espera', async () => {
    const first = vi.fn<(outcome: KioskWaitOutcome) => void>()
    const second = vi.fn<(outcome: KioskWaitOutcome) => void>()
    const { rerender } = renderHook(
      ({ onOutcome }: { onOutcome: (outcome: KioskWaitOutcome) => void }) =>
        useResidentResponseWatcher({ sessionId: 's-1', awaitingResponse: true, onOutcome }),
      { initialProps: { onOutcome: first } },
    )

    rerender({ onOutcome: second })
    socketMock.handlers.get('visitor:response:s-1')?.({ approved: false })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('denied')
    expect(socketMock.on).toHaveBeenCalledTimes(1)
  })
})
