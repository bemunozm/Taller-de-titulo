import {
  interpretKioskSessionStatus,
  interpretResidentResponsePayload,
  type ResidentOutcome,
} from '@/helpers/kioskResidentResponse'

export const RESIDENT_RESPONSE_POLL_INTERVAL_MS = 3_000
/**
 * `approved` + `entryRegistered: null` (el backend no persistió el resultado
 * del ingreso) por más de esto, desde la primera lectura `approved`, se
 * resuelve como "acceso no abierto" (fail-closed: no pase, conserjería avisada).
 */
export const RESIDENT_APPROVAL_PROCESSING_LIMIT_MS = 30_000
/** Espera máxima de una respuesta desde que se notificó al residente. */
export const RESIDENT_RESPONSE_MAX_WAIT_MS = 3 * 60_000

export interface ResidentResponseWatcherOptions {
  sessionId: string
  /** Suscribe al evento de socket de la sesión; devuelve la función para desuscribir. */
  subscribe: (handler: (payload: unknown) => void) => () => void
  /** `POST /concierge/session/:id/status` del kiosko. */
  fetchStatus: () => Promise<unknown>
  /** Llegó una respuesta del residente (socket o polling). */
  onResolved: (outcome: ResidentOutcome) => void
  /** La sesión terminó sin respuesta (`/status` con `active: false` y sin decisión). */
  onClosed: () => void
  /** Venció la espera máxima sin respuesta. */
  onTimeout: () => void
  /** Si un error del polling es transitorio (se reintenta) o definitivo (se deja de consultar). */
  shouldRetry?: (error: unknown) => boolean
  pollIntervalMs?: number
  processingLimitMs?: number
  maxWaitMs?: number
}

export interface ResidentResponseWatcher {
  /** Empieza la espera activa: polling + espera máxima (idempotente). */
  startPolling: () => void
  /**
   * Reinicia la espera máxima desde ahora (p. ej. tras reenviar la
   * notificación al residente). No hace nada si la espera no está corriendo.
   * No toca el límite de `approved` sin resultado del ingreso.
   */
  restartMaxWait: () => void
  /** Detiene socket, polling y timers; un resultado en vuelo se descarta. */
  stop: () => void
  /** La espera terminó (respuesta, sesión cerrada, tiempo agotado o `stop()`). */
  isSettled: () => boolean
}

/**
 * Espera la respuesta del residente por dos caminos —el socket del kiosko y
 * el polling de `/status`— y termina UNA sola vez, con lo primero que pase:
 * una respuesta (`onResolved`), la sesión cerrada sin respuesta (`onClosed`)
 * o la espera máxima vencida (`onTimeout`). Al terminar (o al detenerse) se
 * desuscribe del socket y cancela todos los timers.
 *
 * La espera nunca es indefinida: `approved` sin resultado del ingreso se
 * acota a `processingLimitMs` y toda la espera a `maxWaitMs`.
 *
 * El polling encadena `setTimeout` en vez de `setInterval`: nunca hay dos
 * consultas en vuelo y no quedan timers huérfanos tras `stop()`.
 */
export function createResidentResponseWatcher({
  sessionId,
  subscribe,
  fetchStatus,
  onResolved,
  onClosed,
  onTimeout,
  shouldRetry = () => true,
  pollIntervalMs = RESIDENT_RESPONSE_POLL_INTERVAL_MS,
  processingLimitMs = RESIDENT_APPROVAL_PROCESSING_LIMIT_MS,
  maxWaitMs = RESIDENT_RESPONSE_MAX_WAIT_MS,
}: ResidentResponseWatcherOptions): ResidentResponseWatcher {
  let finished = false
  let polling = false
  let sawApproval = false
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let processingTimer: ReturnType<typeof setTimeout> | null = null
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribe: (() => void) | null = null

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }

  const stopPolling = () => {
    polling = false
    clearTimer(pollTimer)
    pollTimer = null
  }

  const stop = () => {
    finished = true
    stopPolling()
    clearTimer(processingTimer)
    processingTimer = null
    clearTimer(maxWaitTimer)
    maxWaitTimer = null
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  /** Termina la espera una sola vez. */
  const settle = (notify: () => void) => {
    if (finished) {
      return
    }
    stop()
    notify()
  }

  const resolve = (outcome: ResidentOutcome) => settle(() => onResolved(outcome))

  const scheduleNextPoll = () => {
    if (finished || !polling) {
      return
    }
    pollTimer = setTimeout(() => {
      pollTimer = null
      void poll()
    }, pollIntervalMs)
  }

  const startProcessingLimit = () => {
    if (sawApproval) {
      return
    }
    sawApproval = true
    processingTimer = setTimeout(() => {
      processingTimer = null
      resolve('approved-not-opened')
    }, processingLimitMs)
  }

  const poll = async () => {
    if (finished || !polling) {
      return
    }

    let status: unknown
    try {
      status = await fetchStatus()
    } catch (error) {
      if (shouldRetry(error)) {
        scheduleNextPoll()
      } else {
        stopPolling()
      }
      return
    }

    if (finished) {
      return
    }

    const reading = interpretKioskSessionStatus(status)
    switch (reading.kind) {
      case 'resolved':
        resolve(reading.outcome)
        break
      case 'processing':
        startProcessingLimit()
        scheduleNextPoll()
        break
      case 'closed':
        settle(onClosed)
        break
      case 'waiting':
        scheduleNextPoll()
        break
    }
  }

  const unsubscribeSocket = subscribe((payload) => {
    const outcome = interpretResidentResponsePayload(payload, sessionId)
    if (outcome) {
      resolve(outcome)
    }
  })
  if (finished) {
    unsubscribeSocket()
  } else {
    unsubscribe = unsubscribeSocket
  }

  const startMaxWait = () => {
    clearTimer(maxWaitTimer)
    maxWaitTimer = setTimeout(() => {
      maxWaitTimer = null
      // Ya hubo una aprobación sin resultado del ingreso: no es "sin respuesta".
      if (sawApproval) {
        resolve('approved-not-opened')
      } else {
        settle(onTimeout)
      }
    }, maxWaitMs)
  }

  return {
    startPolling: () => {
      if (finished || polling) {
        return
      }
      polling = true
      scheduleNextPoll()
      if (maxWaitTimer === null) {
        startMaxWait()
      }
    },
    restartMaxWait: () => {
      if (finished || maxWaitTimer === null) {
        return
      }
      startMaxWait()
    },
    stop,
    isSettled: () => finished,
  }
}
