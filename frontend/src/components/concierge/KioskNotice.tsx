import type { ComponentType, ReactNode, SVGProps } from 'react'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import type { KioskNoticeTone } from '@/helpers/kioskQr'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

const TONES: Record<KioskNoticeTone, { icon: Icon; ring: string; iconColor: string }> = {
  success: { icon: CheckCircleIcon, ring: 'bg-emerald-400/10 ring-emerald-400/40', iconColor: 'text-emerald-300' },
  warning: { icon: ExclamationTriangleIcon, ring: 'bg-amber-400/10 ring-amber-400/40', iconColor: 'text-amber-300' },
  danger: { icon: XCircleIcon, ring: 'bg-rose-400/10 ring-rose-400/40', iconColor: 'text-rose-300' },
  neutral: { icon: InformationCircleIcon, ring: 'bg-cyan-400/10 ring-cyan-400/40', iconColor: 'text-cyan-300' },
}

interface KioskNoticeProps {
  tone: KioskNoticeTone
  title: string
  detail: string
  /** Botón u otra acción bajo el mensaje. */
  children?: ReactNode
}

/**
 * Mensaje a pantalla completa para el visitante (resultado del QR, "se perdió
 * la conexión"): un ícono grande, un título corto y una frase. Se lee de pie y
 * a un brazo de distancia, sin nada más en pantalla.
 */
export function KioskNotice({ tone, title, detail, children }: KioskNoticeProps) {
  const { icon: ToneIcon, ring, iconColor } = TONES[tone]

  return (
    <section
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center text-center"
    >
      <div className={`flex size-32 items-center justify-center rounded-full ring-2 ${ring}`}>
        <ToneIcon aria-hidden="true" className={`size-20 ${iconColor}`} />
      </div>
      <h2 className="mt-10 font-[Outfit,ui-sans-serif,system-ui,sans-serif] text-4xl/10 font-semibold tracking-tight text-white">
        {title}
      </h2>
      <p className="mt-4 text-xl/8 text-pretty text-zinc-300">{detail}</p>
      {children}
    </section>
  )
}
