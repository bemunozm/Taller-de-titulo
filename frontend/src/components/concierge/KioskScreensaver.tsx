import { useScreenDrift } from '@/hooks/kiosk/useScreenDrift'
import { VigiliaMark } from '@/components/concierge/VigiliaMark'

/** Inactividad en el inicio tras la que se apaga la interfaz. */
export const KIOSK_SCREENSAVER_AFTER_MS = 90_000

interface KioskScreensaverProps {
  /** Un toque (o una tecla) despierta el kiosko. */
  onWake: () => void
}

/**
 * Salvapantallas del inicio: negro puro con el logo tenue, que cambia de lugar
 * cada 60 s (desplazamiento de píxeles) para no marcar el AMOLED. Nunca se
 * monta durante una llamada ni durante la espera del residente.
 *
 * Despierta con `click` y no con `pointerdown`: así el mismo toque no atraviesa
 * la capa y aprieta una tecla del teclado que queda debajo.
 */
export function KioskScreensaver({ onWake }: KioskScreensaverProps) {
  const { x, y } = useScreenDrift(true)

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Toque la pantalla para continuar"
      onClick={onWake}
      onKeyDown={onWake}
      className="fixed inset-0 z-40 cursor-pointer bg-black focus:outline-none"
    >
      <div
        data-testid="screensaver-mark"
        className="absolute w-52 -translate-x-1/2 -translate-y-1/2 text-white opacity-25"
        style={{ left: `${x}%`, top: `${y}%` }}
      >
        <VigiliaMark className="w-full" />
      </div>
    </div>
  )
}
