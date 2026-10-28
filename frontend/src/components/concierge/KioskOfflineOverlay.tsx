import { SignalSlashIcon } from '@heroicons/react/24/outline'
import { useScreenDrift } from '@/hooks/kiosk/useScreenDrift'
import type { KioskConnectivityStatus } from '@/hooks/kiosk/useKioskConnectivity'

interface KioskOfflineOverlayProps {
  status: Exclude<KioskConnectivityStatus, 'online'>
}

const DETAIL: Record<KioskOfflineOverlayProps['status'], string> = {
  offline: 'Este equipo no tiene internet.',
  'backend-down': 'El sistema no responde por ahora.',
}

/**
 * Pantalla propia de Vigilia cuando no hay conexión: tapa todo el kiosko (el
 * contenido de debajo queda inerte) y se retira sola cuando el backend vuelve
 * a responder. Fondo negro y el texto se desplaza cada 60 s: puede quedar horas
 * encendida en un AMOLED sin marcarlo.
 */
export function KioskOfflineOverlay({ status }: KioskOfflineOverlayProps) {
  const { x, y } = useScreenDrift(true)

  return (
    <div role="alert" className="fixed inset-0 z-50 overflow-hidden bg-black text-white">
      <div
        className="absolute w-[min(88vw,26rem)] -translate-x-1/2 -translate-y-1/2 text-center"
        style={{ left: `${x}%`, top: `${y}%` }}
      >
        <SignalSlashIcon aria-hidden="true" className="mx-auto size-16 text-amber-300" />
        <h2 className="mt-6 font-[Outfit,ui-sans-serif,system-ui,sans-serif] text-4xl font-semibold tracking-tight">
          Sin conexión
        </h2>
        <p className="mt-3 text-2xl/8 font-medium text-zinc-100">Use el citófono</p>
        <p className="mt-8 text-base text-zinc-400">{DETAIL[status]} Se restablece sola.</p>
      </div>
    </div>
  )
}
