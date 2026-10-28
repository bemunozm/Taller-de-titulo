import { useEffect, useState } from 'react'

/** Cada cuánto cambia de posición lo que queda fijo en pantalla (desplazamiento de píxeles). */
export const KIOSK_DRIFT_PERIOD_MS = 60_000

export interface ScreenPosition {
  /** Centro del elemento, en % del ancho. */
  x: number
  /** Centro del elemento, en % del alto. */
  y: number
}

/**
 * Posiciones del centro del logo. Siempre dentro de un margen donde cabe
 * entero, y cada una lejos de la anterior para que no se repitan los mismos
 * píxeles encendidos (AMOLED).
 */
const DRIFT_POSITIONS: readonly ScreenPosition[] = [
  { x: 50, y: 42 },
  { x: 36, y: 28 },
  { x: 62, y: 62 },
  { x: 38, y: 70 },
  { x: 64, y: 30 },
  { x: 50, y: 54 },
]

/** Posición que cambia cada `periodMs` mientras `active`. Al reactivarse sigue donde iba. */
export function useScreenDrift(active: boolean, periodMs: number = KIOSK_DRIFT_PERIOD_MS): ScreenPosition {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }
    const interval = setInterval(() => {
      setStep((current) => (current + 1) % DRIFT_POSITIONS.length)
    }, periodMs)
    return () => {
      clearInterval(interval)
    }
  }, [active, periodMs])

  return DRIFT_POSITIONS[step]
}
