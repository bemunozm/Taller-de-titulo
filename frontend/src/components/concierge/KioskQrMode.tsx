import { useRef } from 'react'
import { ArrowLeftIcon, QrCodeIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/Button'
import { KioskNotice } from '@/components/concierge/KioskNotice'
import { describeQrOutcome } from '@/helpers/kioskQr'
import { useKioskQrRedeem, type KioskQrPhase } from '@/hooks/kiosk/useKioskQrRedeem'

interface KioskQrModeProps {
  /** Volver al inicio (cancelar, timeout o fin del resultado). */
  onExit: () => void
}

const STATUS_TEXT: Record<Exclude<KioskQrPhase, 'result'>, string> = {
  starting: 'Iniciando la cámara…',
  scanning: 'Buscando el código…',
  redeeming: 'Revisando el código…',
}

/**
 * Camino "Tengo un código QR" del kiosko: el visitante acerca el QR de su
 * visita a la cámara frontal y, si es válido, se abre la puerta. Sin agente
 * ni llamada: el canje es una sola consulta al backend (ver `useKioskQrRedeem`).
 */
export function KioskQrMode({ onExit }: KioskQrModeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { phase, outcome } = useKioskQrRedeem({ containerRef, onExit })
  const isResult = phase === 'result' && outcome !== null

  return (
    <div className="mx-auto w-full max-w-md">
      {isResult && (
        <KioskNotice {...describeQrOutcome(outcome)}>
          <Button color="cyan" onClick={onExit} className="mt-10 min-h-16 w-full items-center! text-lg!">
            Volver al inicio
          </Button>
        </KioskNotice>
      )}

      {/* La cámara sigue montada tras el resultado (oculta) para que el contenedor no cambie bajo el escáner. */}
      <section aria-labelledby="kiosk-qr-title" hidden={isResult}>
        <div className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-cyan-400/10 ring-1 ring-cyan-400/40">
            <QrCodeIcon aria-hidden="true" className="size-8 text-cyan-300" />
          </div>
          <h2
            id="kiosk-qr-title"
            className="mt-4 font-[Outfit,ui-sans-serif,system-ui,sans-serif] text-3xl font-semibold tracking-tight text-white"
          >
            Acerque su código QR
          </h2>
          <p className="mt-2 text-lg/7 text-zinc-300">Muestre a la cámara el código que le enviaron.</p>
        </div>

        {/* Vista previa en espejo (cámara frontal): así se ajusta el teléfono como en un selfie. */}
        <div className="mt-6 aspect-square w-full overflow-hidden rounded-3xl bg-zinc-950 ring-2 ring-cyan-400/50 [&_video]:-scale-x-100 [&_video]:object-cover">
          <div ref={containerRef} className="size-full" />
        </div>

        <p aria-live="polite" className="mt-5 min-h-7 text-center text-lg font-medium text-cyan-200">
          {phase === 'result' ? '' : STATUS_TEXT[phase]}
        </p>

        <p className="mt-2 text-center text-base text-zinc-400">
          La cámara solo lee el código; no se guardan imágenes.
        </p>

        <Button outline onClick={onExit} className="mt-8 min-h-16 w-full items-center! text-lg!">
          <ArrowLeftIcon data-slot="icon" />
          Volver
        </Button>
      </section>
    </div>
  )
}
