/** Sin toques en el teclado o el aviso de privacidad: vuelve al inicio y limpia lo escrito. */
export const KIOSK_IDLE_RESET_MS = 60_000
/**
 * Vigía: tiempo máximo fuera del inicio sin actividad (toques del visitante o
 * eventos de la llamada) antes de reiniciar la vista. Cubre cualquier estado
 * pegado que los demás timers no vean.
 */
export const KIOSK_WATCHDOG_MS = 6 * 60_000
/** Cuánto se muestra "Se perdió la conexión" antes de volver solo al inicio. */
export const KIOSK_CONNECTION_LOST_NOTICE_MS = 8_000
/** Sin conexión por más de esto en plena llamada: se da por cortada. */
export const KIOSK_CALL_OFFLINE_GRACE_MS = 10_000
/** Un error del transporte sin señales de vida en este tiempo corta la llamada. */
export const KIOSK_TRANSPORT_ERROR_GRACE_MS = 8_000
/** Tope para abrir la conexión de voz (el SDK no trae uno propio). */
export const KIOSK_VOICE_CONNECT_TIMEOUT_MS = 20_000

/** Rechaza con `message` si `promise` no termina en `timeoutMs` (la original sigue su curso). */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(message))
      },
    )
  })
}
