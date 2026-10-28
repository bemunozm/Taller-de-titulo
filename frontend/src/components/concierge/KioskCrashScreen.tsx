import { useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'

/** Tiempo que se muestra la pantalla de error antes de recargar la página. */
export const KIOSK_CRASH_RELOAD_MS = 10_000

export function KioskCrashScreen({ onReload }: { onReload: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onReload, KIOSK_CRASH_RELOAD_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [onReload])

  return (
    <div
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center bg-black px-8 text-center text-white"
    >
      <ArrowPathIcon aria-hidden="true" className="size-16 animate-spin text-cyan-300 motion-reduce:animate-none" />
      <h1 className="mt-8 font-[Outfit,ui-sans-serif,system-ui,sans-serif] text-4xl font-semibold tracking-tight">
        Reiniciando
      </h1>
      <p className="mt-3 text-xl/8 text-zinc-300">Algo salió mal. Si necesita ingresar, use el citófono.</p>
    </div>
  )
}
