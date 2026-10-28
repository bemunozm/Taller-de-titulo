import { useCallback, useEffect, useRef } from 'react'

/** Gestos del visitante que cuentan como actividad (en captura: ningún `stopPropagation` los tapa). */
const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'click', 'keydown', 'scroll'] as const

interface UseIdleTimeoutOptions {
  /** Inactividad (ms) tras la cual se llama a `onIdle`. */
  timeoutMs: number
  /** Con `false` no hay timer ni escucha; al volver a `true` la cuenta empieza de cero. */
  enabled: boolean
  /** Se llama una vez por período de inactividad (no se repite hasta que haya actividad). */
  onIdle: () => void
  /**
   * `false` = los toques NO reinician la cuenta; solo `reset()` lo hace.
   * Por defecto (`true`) los toques también cuentan: así lo usa hoy el vigía de
   * la sesión, que se reinicia con la actividad de la llamada y con los toques.
   */
  resetOnUserActivity?: boolean
}

interface UseIdleTimeoutResult {
  /** Reinicia la cuenta (actividad que no es un gesto, p. ej. un evento de la llamada). Estable. */
  reset: () => void
}

/**
 * Timer de inactividad del kiosko. Un solo `setTimeout` que se rearma con cada
 * gesto, así que el costo en un dispositivo siempre encendido es despreciable.
 */
export function useIdleTimeout({
  timeoutMs,
  enabled,
  onIdle,
  resetOnUserActivity = true,
}: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const onIdleRef = useRef(onIdle)
  const armRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    onIdleRef.current = onIdle
  })

  useEffect(() => {
    if (!enabled) {
      armRef.current = () => undefined
      return
    }

    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        onIdleRef.current()
      }, timeoutMs)
    }
    armRef.current = arm
    arm()

    if (resetOnUserActivity) {
      for (const eventName of ACTIVITY_EVENTS) {
        document.addEventListener(eventName, arm, { capture: true, passive: true })
      }
    }

    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      armRef.current = () => undefined
      if (resetOnUserActivity) {
        for (const eventName of ACTIVITY_EVENTS) {
          document.removeEventListener(eventName, arm, { capture: true })
        }
      }
    }
  }, [enabled, timeoutMs, resetOnUserActivity])

  const reset = useCallback(() => {
    armRef.current()
  }, [])

  return { reset }
}
