import { useEffect } from 'react'

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

function getWakeLock(): WakeLockLike | null {
  if (typeof navigator === 'undefined') {
    return null
  }
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
  return candidate && typeof candidate.request === 'function' ? candidate : null
}

/**
 * Mantiene la pantalla encendida mientras la página está visible. El navegador
 * suelta el bloqueo al ocultar la pestaña (o al apagar la pantalla), así que se
 * vuelve a pedir en `visibilitychange`. Sin la API (o si la rechaza, p. ej. por
 * ahorro de batería) no hace nada: Fully Kiosk ya mantiene la pantalla por su
 * cuenta y esto es un refuerzo.
 */
export function useWakeLock(): void {
  useEffect(() => {
    const wakeLock = getWakeLock()
    if (!wakeLock) {
      return
    }

    let disposed = false
    let sentinel: WakeLockSentinelLike | null = null

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) {
        return
      }
      try {
        const acquired = await wakeLock.request('screen')
        if (disposed) {
          void acquired.release().catch(() => undefined)
          return
        }
        sentinel = acquired
        acquired.addEventListener('release', () => {
          if (sentinel === acquired) {
            sentinel = null
          }
        })
      } catch {
        // Rechazado (batería baja, página oculta): se reintenta en el próximo cambio de visibilidad.
      }
    }

    const handleVisibility = () => {
      void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibility)
      void sentinel?.release().catch(() => undefined)
      sentinel = null
    }
  }, [])
}
