import { useEffect, useId, useRef, useState, type ComponentType, type SVGProps } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ClockIcon, MicrophoneIcon, ShieldCheckIcon, SparklesIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/Button'
import { PrivacyPolicyDialog } from '@/components/privacy/PrivacyPolicyDialog'
import {
  KIOSK_PRIVACY_NOTICE_PARTS,
  getPrivacyPolicyDisplayUrl,
  getPrivacyPolicyUrl,
} from '@/helpers/privacyPolicy'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

/** Un ícono por oración del aviso (§5.2), en el mismo orden. */
const NOTICE_ICONS: readonly [Icon, Icon, Icon] = [SparklesIcon, MicrophoneIcon, ClockIcon]

interface KioskPrivacyNoticeProps {
  /** Casa o departamento que marcó el visitante. */
  houseNumber: string
  /** Tras "Continuar", mientras se pide el micrófono y se abre la sesión. */
  isStarting: boolean
  onContinue: () => void
  onCancel: () => void
}

/**
 * Aviso previo al micrófono del kiosko (Ley 21.719, art. 14 ter;
 * `docs/modulos/privacidad-ley-21719.md` §5.2). `getUserMedia` se pide recién
 * con "Continuar"; "Cancelar" (o Escape) vuelve al teclado sin crear sesión.
 */
export function KioskPrivacyNotice({ houseNumber, isStarting, onContinue, onCancel }: KioskPrivacyNoticeProps) {
  const titleId = useId()
  const descriptionId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [isPolicyOpen, setIsPolicyOpen] = useState(false)

  const policyUrl = getPrivacyPolicyUrl()
  const displayUrl = getPrivacyPolicyDisplayUrl()

  // El foco llega al aviso: un lector de pantalla lo lee antes que los botones.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Escape = Cancelar, salvo con la política abierta (ahí Escape cierra el diálogo).
  useEffect(() => {
    if (isPolicyOpen) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPolicyOpen, onCancel])

  return (
    <section aria-labelledby={titleId} aria-describedby={descriptionId} className="mx-auto w-full max-w-2xl">
      {/* Encabezado */}
      <div className="mb-8 text-center">
        <div className="mb-4 flex justify-center">
          <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 p-4 shadow-lg">
            <ShieldCheckIcon aria-hidden="true" className="h-10 w-10 text-white" />
          </div>
        </div>
        <p className="font-mono text-xs font-medium tracking-[0.2em] text-blue-600 uppercase dark:text-blue-400">
          Casa/Depto. {houseNumber}
        </p>
        <h2
          ref={headingRef}
          id={titleId}
          tabIndex={-1}
          className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 focus:outline-none dark:text-white"
        >
          Antes de hablar con Sofía
        </h2>
      </div>

      {/* Aviso (§5.2) */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <ul id={descriptionId} role="list" className="space-y-5">
          {KIOSK_PRIVACY_NOTICE_PARTS.map((part, position) => {
            const PartIcon = NOTICE_ICONS[position]
            return (
              <li key={part} className="flex gap-4">
                <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400">
                  <PartIcon aria-hidden="true" className="size-6" />
                </span>
                <p className="pt-1.5 text-lg/7 text-pretty text-zinc-800 dark:text-zinc-100">{part}</p>
              </li>
            )
          })}
        </ul>

        {/* Política: QR para el teléfono del visitante o lectura en el kiosko */}
        <div className="mt-8 grid gap-5 rounded-xl bg-zinc-50 p-5 sm:grid-cols-[auto_1fr] sm:items-center dark:bg-white/5">
          {/* Fondo blanco fijo: el QR debe leerse también en modo oscuro. */}
          <div className="mx-auto w-fit rounded-xl bg-white p-2 ring-1 ring-zinc-950/10">
            <QRCodeSVG
              value={policyUrl}
              size={128}
              level="M"
              role="img"
              title="Código QR del aviso de privacidad"
              aria-label="Código QR del aviso de privacidad"
            />
          </div>
          <div className="text-center sm:text-left">
            <p className="font-semibold text-zinc-950 dark:text-white">Aviso de privacidad</p>
            <p className="mt-1 text-sm/6 text-zinc-600 dark:text-zinc-400">
              Escanea el código con tu teléfono para leerlo completo, o entra a:
            </p>
            <p className="mt-1 font-mono text-sm font-medium break-all text-zinc-950 dark:text-white">{displayUrl}</p>
            <Button outline onClick={() => setIsPolicyOpen(true)} className="mt-4 min-h-11 items-center!">
              Ver aviso de privacidad
            </Button>
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div className="mt-8 flex flex-col-reverse gap-4 sm:flex-row sm:justify-center">
        <Button outline onClick={onCancel} className="min-h-14 items-center! sm:min-w-44">
          Cancelar
        </Button>
        <Button color="blue" onClick={onContinue} disabled={isStarting} className="min-h-14 items-center! sm:min-w-44">
          {isStarting ? 'Conectando…' : 'Continuar'}
        </Button>
      </div>
      <p aria-live="polite" className="mt-4 min-h-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {isStarting ? 'Pidiendo acceso al micrófono…' : ''}
      </p>

      <PrivacyPolicyDialog open={isPolicyOpen} onClose={() => setIsPolicyOpen(false)} />
    </section>
  )
}
