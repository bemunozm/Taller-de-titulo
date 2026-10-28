import type { ComponentType, SVGProps } from 'react'
import { HashtagIcon, QrCodeIcon } from '@heroicons/react/24/outline'

export type KioskHomePath = 'dial' | 'qr'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

const PATHS: ReadonlyArray<{ id: KioskHomePath; label: string; icon: Icon }> = [
  { id: 'dial', label: 'Marcar departamento', icon: HashtagIcon },
  { id: 'qr', label: 'Tengo un código QR', icon: QrCodeIcon },
]

interface KioskHomePathsProps {
  selected: KioskHomePath
  onSelect: (path: KioskHomePath) => void
}

/**
 * Los dos caminos del inicio. Siempre a la vista y de un toque: quien no tiene
 * código marca el departamento (lo de siempre), quien lo tiene va directo a la
 * cámara. Dos botones grandes en vez de una pestaña pequeña.
 */
export function KioskHomePaths({ selected, onSelect }: KioskHomePathsProps) {
  return (
    <div role="group" aria-label="¿Cómo desea ingresar?" className="mb-6 grid w-full max-w-md grid-cols-2 gap-3">
      {PATHS.map(({ id, label, icon: PathIcon }) => {
        const isSelected = id === selected
        return (
          <button
            key={id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(id)}
            className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border-2 px-3 py-3 text-center text-lg/6 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 active:scale-[0.98] ${
              isSelected
                ? 'border-cyan-400 bg-cyan-400/15 text-white'
                : 'border-zinc-700 bg-zinc-900 text-zinc-200 active:bg-zinc-800'
            }`}
          >
            <PathIcon aria-hidden="true" className={`size-8 ${isSelected ? 'text-cyan-300' : 'text-zinc-400'}`} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
