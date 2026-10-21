import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResidentOutcome } from './kioskResidentResponse'
import {
  RESIDENT_APPROVAL_PROCESSING_LIMIT_MS,
  RESIDENT_RESPONSE_MAX_WAIT_MS,
  createResidentResponseWatcher,
} from './residentResponseWatcher'

const SESSION_ID = 'session-1'
const POLL_MS = 3_000

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const PENDING = { active: true, residentResponse: 'pending', entryRegistered: null, visitId: 'v-1' }
const APPROVED_PROCESSING = { active: false, residentResponse: 'approved', entryRegistered: null, visitId: 'v-1' }

function setup(fetchStatus: () => Promise<unknown>, shouldRetry?: (error: unknown) => boolean) {
  let socketHandler: ((payload: unknown) => void) | null = null
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((handler: (payload: unknown) => void) => {
    socketHandler = handler
    return unsubscribe
  })
  const onResolved = vi.fn<(outcome: ResidentOutcome) => void>()
  const onClosed = vi.fn<() => void>()
  const onTimeout = vi.fn<() => void>()
  const fetchStatusMock = vi.fn(fetchStatus)

  const watcher = createResidentResponseWatcher({
    sessionId: SESSION_ID,
    subscribe,
    fetchStatus: fetchStatusMock,
    onResolved,
    onClosed,
    onTimeout,
    shouldRetry,
    pollIntervalMs: POLL_MS,
  })

  return {
    watcher,
    onResolved,
    onClosed,
    onTimeout,
    unsubscribe,
    fetchStatus: fetchStatusMock,
    emitSocket: (payload: unknown) => socketHandler?.(payload),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createResidentResponseWatcher: una sola respuesta', () => {
  it('socket primero y polling en vuelo después: se procesa UNA sola vez y se detiene todo', async () => {
    const pendingPoll = deferred<unknown>()
    const { watcher, onResolved, unsubscribe, fetchStatus, emitSocket } = setup(() => pendingPoll.promise)

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(fetchStatus).toHaveBeenCalledTimes(1)

    emitSocket({ sessionId: SESSION_ID, approved: true, entryRegistered: true })
    // El polling en vuelo también trae la respuesta: no debe procesarse de nuevo.
    pendingPoll.resolve({ active: false, residentResponse: 'approved', entryRegistered: true })
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    emitSocket({ sessionId: SESSION_ID, approved: false, entryRegistered: false })

    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith('admitted')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(watcher.isSettled()).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('polling primero: resuelve, se desuscribe del socket e ignora un evento posterior', async () => {
    const statuses: unknown[] = [PENDING, { active: false, residentResponse: 'approved', entryRegistered: true }]
    const { watcher, onResolved, unsubscribe, fetchStatus, emitSocket } = setup(async () => statuses.shift())

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(onResolved).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith('admitted')
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    emitSocket({ sessionId: SESSION_ID, approved: false, entryRegistered: false })
    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS)

    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('approved + entryRegistered false por polling es definitivo', async () => {
    const { watcher, onResolved, fetchStatus } = setup(async () => ({
      active: false,
      residentResponse: 'approved',
      entryRegistered: false,
    }))

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith('approved-not-opened')
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('el payload del socket es definitivo: approved sin apertura se anuncia de inmediato', () => {
    const { watcher, onResolved, fetchStatus, emitSocket } = setup(async () => PENDING)

    watcher.startPolling()
    emitSocket({ sessionId: SESSION_ID, approved: true, entryRegistered: false })

    expect(onResolved).toHaveBeenCalledWith('approved-not-opened')
    expect(fetchStatus).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un evento de socket que no es una decisión se ignora y se sigue esperando', () => {
    const { watcher, onResolved, unsubscribe, emitSocket } = setup(async () => PENDING)

    watcher.startPolling()
    emitSocket({ outcome: 'approved', message: 'formato viejo' })

    expect(onResolved).not.toHaveBeenCalled()
    expect(unsubscribe).not.toHaveBeenCalled()

    emitSocket({ approved: false })
    expect(onResolved).toHaveBeenCalledWith('denied')
  })
})

describe('createResidentResponseWatcher: la espera nunca es indefinida', () => {
  it('approved + entryRegistered null se resuelve con el resultado si llega antes de 30 s', async () => {
    const statuses: unknown[] = [
      APPROVED_PROCESSING,
      APPROVED_PROCESSING,
      { active: false, residentResponse: 'approved', entryRegistered: true },
    ]
    const { watcher, onResolved, fetchStatus } = setup(async () => statuses.shift())

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(onResolved).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(onResolved).toHaveBeenCalledWith('admitted')
    expect(fetchStatus).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('approved + entryRegistered null por más de 30 s → approved-not-opened (fail-closed)', async () => {
    const { watcher, onResolved, onTimeout, fetchStatus } = setup(async () => APPROVED_PROCESSING)

    watcher.startPolling()
    // Primera lectura `approved` a los 3 s: el límite corre desde ahí.
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await vi.advanceTimersByTimeAsync(RESIDENT_APPROVAL_PROCESSING_LIMIT_MS - 1)
    expect(onResolved).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onResolved).toHaveBeenCalledTimes(1)
    expect(onResolved).toHaveBeenCalledWith('approved-not-opened')
    expect(onTimeout).not.toHaveBeenCalled()

    const callsAtSettle = fetchStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS)
    expect(fetchStatus).toHaveBeenCalledTimes(callsAtSettle)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sesión cerrada sin respuesta → onClosed una vez, sin más consultas ni socket', async () => {
    const { watcher, onResolved, onClosed, unsubscribe, fetchStatus, emitSocket } = setup(async () => ({
      active: false,
      residentResponse: 'pending',
      entryRegistered: null,
    }))

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS * 4)

    expect(onClosed).toHaveBeenCalledTimes(1)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    emitSocket({ approved: true, entryRegistered: true })
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('sin respuesta en 3 minutos → onTimeout una vez y se detiene todo', async () => {
    const { watcher, onResolved, onTimeout, unsubscribe, fetchStatus, emitSocket } = setup(async () => PENDING)

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS - 1)
    expect(onTimeout).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    const callsAtTimeout = fetchStatus.mock.calls.length
    emitSocket({ approved: true, entryRegistered: true })
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(onResolved).not.toHaveBeenCalled()
    expect(fetchStatus).toHaveBeenCalledTimes(callsAtTimeout)
  })

  it('restartMaxWait reinicia la espera de 3 min desde ese momento', async () => {
    const { watcher, onTimeout } = setup(async () => PENDING)
    const restartAt = 150_000

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(restartAt)
    watcher.restartMaxWait()

    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS - 1)
    expect(onTimeout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restartMaxWait no arranca una espera que no estaba corriendo, ni revive una terminada', async () => {
    const { watcher, onTimeout, onResolved, emitSocket } = setup(async () => PENDING)

    watcher.restartMaxWait()
    expect(vi.getTimerCount()).toBe(0)

    watcher.startPolling()
    emitSocket({ approved: false })
    watcher.restartMaxWait()
    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS * 2)

    expect(onResolved).toHaveBeenCalledWith('denied')
    expect(onTimeout).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restartMaxWait no extiende el límite de 30 s de approved sin resultado', async () => {
    const { watcher, onResolved } = setup(async () => APPROVED_PROCESSING)

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    watcher.restartMaxWait()
    await vi.advanceTimersByTimeAsync(RESIDENT_APPROVAL_PROCESSING_LIMIT_MS)

    expect(onResolved).toHaveBeenCalledWith('approved-not-opened')
  })

  it('si al vencer la espera ya hubo una aprobación en proceso, no es "sin respuesta"', async () => {
    const statuses: unknown[] = []
    const { watcher, onResolved, onTimeout } = setup(async () => statuses.shift() ?? PENDING)

    watcher.startPolling()
    // Pendiente casi 3 min; la aprobación aparece en la última consulta antes del límite.
    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS - POLL_MS * 2)
    statuses.push(APPROVED_PROCESSING, APPROVED_PROCESSING)
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)

    expect(onTimeout).not.toHaveBeenCalled()
    expect(onResolved).toHaveBeenCalledWith('approved-not-opened')
  })

  it('tras un error definitivo deja de consultar, pero la espera máxima sigue corriendo', async () => {
    const transient = new Error('red caída')
    const fatal = new Error('403')
    const outcomes: unknown[] = [transient, fatal]
    const { watcher, onTimeout, fetchStatus } = setup(
      async () => {
        throw outcomes.shift()
      },
      (error) => error !== fatal,
    )

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('createResidentResponseWatcher: ciclo de vida', () => {
  it('stop() (desmontaje / cambio de sesión) descarta el resultado en vuelo y no deja timers', async () => {
    const pendingPoll = deferred<unknown>()
    const { watcher, onResolved, onTimeout, unsubscribe, fetchStatus } = setup(() => pendingPoll.promise)

    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    watcher.stop()
    pendingPoll.resolve({ residentResponse: 'approved', entryRegistered: true })
    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS)

    expect(onResolved).not.toHaveBeenCalled()
    expect(onTimeout).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(fetchStatus).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sin startPolling no consulta ni arranca la espera máxima (solo escucha el socket)', async () => {
    const { onTimeout, fetchStatus } = setup(async () => PENDING)

    await vi.advanceTimersByTimeAsync(RESIDENT_RESPONSE_MAX_WAIT_MS * 2)

    expect(fetchStatus).not.toHaveBeenCalled()
    expect(onTimeout).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('startPolling es idempotente', async () => {
    const { watcher, fetchStatus } = setup(async () => PENDING)

    watcher.startPolling()
    watcher.startPolling()
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(fetchStatus).toHaveBeenCalledTimes(1)
    watcher.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
