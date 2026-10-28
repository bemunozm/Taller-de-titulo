import { useEffect, useState } from 'react'
import { isAxiosError } from 'axios'
import { ConciergeAPI, KioskNotPairedError } from '@/api/ConciergeAPI'

/**
 * - `online`: el backend respondió al último latido.
 * - `offline`: el dispositivo no tiene red (`navigator.onLine` / evento `offline`).
 * - `backend-down`: hay red, pero el backend no responde (timeout, 5xx).
 */
export type KioskConnectivityStatus = 'online' | 'offline' | 'backend-down'

/** Latido con todo bien. */
export const KIOSK_PING_INTERVAL_MS = 30_000
/** Tras un fallo se confirma pronto: un solo timeout no tapa el kiosko con el aviso. */
export const KIOSK_PING_RECHECK_MS = 5_000
/** Ya caído (o sin red) se reintenta más seguido para recuperarse sola. */
export const KIOSK_PING_RECOVERY_MS = 10_000
/** Fallos seguidos del latido (con red) antes de declarar `backend-down`. */
export const KIOSK_PING_FAILURES_BEFORE_DOWN = 2

export interface KioskConnectivity {
  status: KioskConnectivityStatus
}

function browserIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Cualquier respuesta HTTP (< 500) prueba que el backend está vivo: un 403 o un
 * 429 del latido no son una caída. Un 401 ya borró la credencial en
 * `kioskRequest` y la vista vuelve al emparejamiento.
 */
function backendAnswered(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return false
  }
  const status = error.response?.status
  return status !== undefined && status < 500
}

/**
 * Conectividad del kiosko: eventos `online`/`offline` del navegador más un
 * latido `GET /concierge/device` cada 30 s (con timeout de 10 s en la request).
 * Solo un 401 desempareja; un error de red o un timeout NUNCA borran la
 * credencial, solo cambian el estado.
 */
export function useKioskConnectivity(): KioskConnectivity {
  const [status, setStatus] = useState<KioskConnectivityStatus>(() => (browserIsOnline() ? 'online' : 'offline'))

  useEffect(() => {
    let disposed = false
    let inFlight = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = (delayMs: number) => {
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        void ping()
      }, delayMs)
    }

    const markOnline = () => {
      failures = 0
      setStatus('online')
      schedule(KIOSK_PING_INTERVAL_MS)
    }

    const markFailure = () => {
      failures += 1
      if (!browserIsOnline()) {
        setStatus('offline')
        schedule(KIOSK_PING_RECOVERY_MS)
      } else if (failures >= KIOSK_PING_FAILURES_BEFORE_DOWN) {
        setStatus('backend-down')
        schedule(KIOSK_PING_RECOVERY_MS)
      } else {
        schedule(KIOSK_PING_RECHECK_MS)
      }
    }

    async function ping(): Promise<void> {
      if (inFlight || disposed) {
        return
      }
      inFlight = true
      try {
        await ConciergeAPI.pingDevice()
        if (!disposed) {
          markOnline()
        }
      } catch (error) {
        if (disposed || error instanceof KioskNotPairedError) {
          // Sin credencial (p. ej. tras un 401) no hay nada que vigilar.
          return
        }
        if (backendAnswered(error)) {
          markOnline()
        } else {
          markFailure()
        }
      } finally {
        inFlight = false
      }
    }

    const handleOffline = () => {
      setStatus('offline')
      schedule(KIOSK_PING_RECOVERY_MS)
    }
    // Volver la red no basta: el aviso se va cuando el backend responde de verdad.
    const handleOnline = () => {
      void ping()
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void ping()
      }
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    window.addEventListener('pageshow', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)

    // El estado inicial ya refleja `navigator.onLine`; sin red se revisa más seguido.
    schedule(browserIsOnline() ? KIOSK_PING_INTERVAL_MS : KIOSK_PING_RECOVERY_MS)

    return () => {
      disposed = true
      clearTimer()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pageshow', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return { status }
}
