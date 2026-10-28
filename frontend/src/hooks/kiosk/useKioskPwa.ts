import { useEffect } from 'react'
import { KIOSK_ROUTE } from '@/helpers/kiosk'

export const KIOSK_MANIFEST_URL = '/kiosk.webmanifest'
export const KIOSK_SERVICE_WORKER_URL = '/kiosk-sw.js'

interface UseKioskPwaOptions {
  /**
   * Registrar el service worker. Por defecto solo en producción: en
   * desarrollo no hay `/assets/*` con hash y un SW activo solo estorbaría.
   */
  registerServiceWorker?: boolean
}

/**
 * PWA mínima del kiosko, solo mientras la vista del kiosko está montada:
 * - inyecta `<link rel="manifest">` (así la app de administración no queda
 *   instalable como kiosko);
 * - registra `kiosk-sw.js` con alcance `/digital-concierge`, para que el
 *   kiosko recargue incluso sin red y muestre su pantalla "sin conexión".
 */
export function useKioskPwa({ registerServiceWorker = import.meta.env.PROD }: UseKioskPwaOptions = {}): void {
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = KIOSK_MANIFEST_URL
    document.head.appendChild(link)

    return () => {
      link.remove()
    }
  }, [])

  useEffect(() => {
    if (!registerServiceWorker || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    // Un fallo de registro (HTTP sin TLS, navegador sin soporte) no debe romper el kiosko.
    navigator.serviceWorker.register(KIOSK_SERVICE_WORKER_URL, { scope: KIOSK_ROUTE }).catch(() => undefined)
  }, [registerServiceWorker])
}
