import { isAxiosError } from 'axios'
import { ConciergeAPI } from '@/api/ConciergeAPI'

export type KioskFinalStatus = 'completed' | 'cancelled' | 'timeout'

interface PendingEnd {
  sessionId: string
  finalStatus: KioskFinalStatus
  queuedAt: number
  attempts: number
}

/** Cada cuánto se reintenta el vaciado mientras queden cierres pendientes. */
export const KIOSK_END_QUEUE_RETRY_MS = 15_000
/** El backend ya expira solo una sesión abandonada: pasado esto, el cierre no aporta. */
export const KIOSK_END_QUEUE_MAX_AGE_MS = 30 * 60_000
export const KIOSK_END_QUEUE_MAX_ATTEMPTS = 20
/** Tope de la cola: un kiosko sin red por horas no acumula sin límite. */
const MAX_QUEUED = 10

/**
 * ¿Vale la pena reintentar? Sin respuesta (red caída, timeout), 5xx y 429 sí;
 * cualquier otro HTTP (401/403/404/409...) es una respuesta definitiva del
 * backend y repetir la misma llamada no la cambia.
 */
export function isRetryableEndError(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return false
  }
  const status = error.response?.status
  return status === undefined || status >= 500 || status === 429
}

/**
 * Cola best-effort de `POST /concierge/session/:id/end`. Si el cierre falla
 * por la red (corte a mitad de llamada), la sesión del backend no debe quedar
 * ACTIVE para siempre: se reintenta al volver la conexión. Vive en memoria
 * (un reinicio de la página la pierde y el backend expira la sesión solo) y
 * solo guarda ids de sesión, nunca la credencial.
 */
export class KioskEndSessionQueue {
  private items: PendingEnd[] = []
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private flushing = false

  get size(): number {
    return this.items.length
  }

  /**
   * Cierra la sesión ya. Si falla por algo reintentable la deja en cola y NO
   * lanza; cualquier otro error se propaga como antes.
   */
  async endOrQueue(sessionId: string, finalStatus: KioskFinalStatus): Promise<void> {
    try {
      await ConciergeAPI.endSession(sessionId, finalStatus)
    } catch (error) {
      if (!isRetryableEndError(error)) {
        throw error
      }
      this.enqueue(sessionId, finalStatus)
    }
  }

  /** Deja un cierre pendiente (y programa su reintento). */
  enqueue(sessionId: string, finalStatus: KioskFinalStatus): void {
    if (this.items.some((item) => item.sessionId === sessionId)) {
      return
    }
    this.items.push({ sessionId, finalStatus, queuedAt: Date.now(), attempts: 0 })
    if (this.items.length > MAX_QUEUED) {
      this.items.shift()
    }
    this.scheduleRetry()
  }

  /** Reintenta todos los cierres pendientes; los que vuelven a fallar por la red siguen en cola. */
  async flush(): Promise<void> {
    if (this.flushing || this.items.length === 0) {
      return
    }
    this.flushing = true
    try {
      const pending = this.items
      this.items = []
      const stillPending: PendingEnd[] = []
      const now = Date.now()

      for (const item of pending) {
        if (now - item.queuedAt > KIOSK_END_QUEUE_MAX_AGE_MS) {
          continue
        }
        try {
          await ConciergeAPI.endSession(item.sessionId, item.finalStatus)
        } catch (error) {
          const attempts = item.attempts + 1
          if (isRetryableEndError(error) && attempts < KIOSK_END_QUEUE_MAX_ATTEMPTS) {
            stillPending.push({ ...item, attempts })
          }
        }
      }

      // Lo encolado mientras se vaciaba va detrás de lo que quedó pendiente.
      this.items = [...stillPending, ...this.items]
    } finally {
      this.flushing = false
    }
    this.scheduleRetry()
  }

  /** Descarta todo (y el timer). Para tests y para desemparejar. */
  clear(): void {
    this.items = []
    this.flushing = false
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || this.items.length === 0) {
      return
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, KIOSK_END_QUEUE_RETRY_MS)
  }
}

export const kioskEndSessionQueue = new KioskEndSessionQueue()
