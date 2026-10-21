import { useState, type FormEvent } from 'react'
import { ExclamationTriangleIcon, LinkIcon } from '@heroicons/react/24/outline'
import { Description, Field, Label } from '@/components/ui/Fieldset'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { kioskCredentialStore } from '@/services/kioskCredentialStore'
import { pairKiosk } from '@/services/kioskPairing'

// Outfit si está disponible; si no (kiosko sin acceso a Google Fonts), la sans del sistema.
const DISPLAY_FONT = 'font-[Outfit,ui-sans-serif,system-ui,sans-serif]'

const PAIRING_STEPS = [
  { code: '01', label: 'Se valida la credencial con el servidor' },
  { code: '02', label: 'Se exige un dispositivo tipo web-kiosk' },
  { code: '03', label: 'Se guarda solo en este equipo' },
] as const

/**
 * Emparejamiento del kiosko web: se muestra en `/digital-concierge` mientras
 * el dispositivo no tenga credencial. Al emparejar, el store avisa y la vista
 * pasa sola al conserje (este componente se desmonta).
 */
export function KioskPairingScreen() {
  const [hubId, setHubId] = useState('')
  const [hubSecret, setHubSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Se lee una vez: explica por qué el kiosko volvió a esta pantalla.
  const [wasRejected] = useState(() => kioskCredentialStore.getLastClearReason() === 'unauthorized')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await pairKiosk({ hubId, hubSecret })
      if (result.status === 'error') {
        setError(result.message)
        setIsSubmitting(false)
      }
      // 'paired': el store avisa y la vista cambia sola al conserje.
    } catch {
      setError('No se pudo emparejar el kiosko. Intenta nuevamente.')
      setIsSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-100 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle,rgb(24_24_27/0.09)_1px,transparent_1px)] [background-size:22px_22px] dark:bg-[radial-gradient(circle,rgb(255_255_255/0.06)_1px,transparent_1px)]"
      />
      <div aria-hidden="true" className="noise-bg absolute inset-0" />

      <div className="relative mx-auto flex min-h-screen max-w-5xl items-center px-4 py-10 sm:px-8">
        <div className="grid w-full overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-zinc-950/10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] dark:bg-zinc-900 dark:ring-white/10">
          {/* Placa del dispositivo */}
          <aside className="relative flex flex-col justify-between gap-12 overflow-hidden bg-zinc-950 p-8 text-zinc-100 sm:p-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-24 -bottom-24 size-72 rounded-full border border-white/5"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-12 -bottom-12 size-48 rounded-full border border-white/10"
            />

            <p className="font-mono text-[0.68rem] tracking-[0.32em] text-zinc-400 uppercase">
              Vigilia · Conserje digital
            </p>

            <div>
              <p className={`${DISPLAY_FONT} text-4xl leading-[1.05] font-light tracking-tight text-white sm:text-5xl`}>
                Kiosko
                <br />
                de portería
              </p>
              <p className="mt-6 flex items-center gap-3 font-mono text-xs tracking-[0.2em] text-amber-300 uppercase">
                <span className="relative flex size-2.5" aria-hidden="true">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
                </span>
                Sin emparejar
              </p>
            </div>

            <ol className="relative space-y-3 border-t border-white/10 pt-6">
              {PAIRING_STEPS.map((step) => (
                <li key={step.code} className="flex items-baseline gap-4 text-sm text-zinc-400">
                  <span className="font-mono text-xs text-zinc-500">{step.code}</span>
                  {step.label}
                </li>
              ))}
            </ol>
          </aside>

          {/* Formulario */}
          <section className="p-8 sm:p-10 lg:p-12">
            <h1 className={`${DISPLAY_FONT} text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white`}>
              Emparejar este kiosko
            </h1>
            <p className="mt-3 max-w-prose text-sm/6 text-zinc-600 dark:text-zinc-400">
              Ingresa la credencial que entregó la administración al registrar este equipo como
              dispositivo <span className="font-mono text-zinc-900 dark:text-zinc-200">web-kiosk</span>.
              El secreto se muestra una sola vez, al crearlo.
            </p>

            {wasRejected && (
              <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <p>
                  El servidor rechazó la credencial guardada (secreto rotado o dispositivo desactivado).
                  Vuelve a emparejar el kiosko.
                </p>
              </div>
            )}

            <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate aria-busy={isSubmitting}>
              <Field disabled={isSubmitting}>
                <Label>ID del dispositivo</Label>
                <Description>El identificador del hub registrado para este kiosko.</Description>
                <Input
                  name="hubId"
                  value={hubId}
                  onChange={(event) => setHubId(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="font-mono"
                  required
                />
              </Field>

              <Field disabled={isSubmitting}>
                <Label>Secreto del dispositivo</Label>
                <Input
                  name="hubSecret"
                  type="password"
                  value={hubSecret}
                  onChange={(event) => setHubSecret(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="font-mono"
                  required
                />
              </Field>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
                >
                  <ExclamationTriangleIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <p>{error}</p>
                </div>
              )}

              <Button type="submit" color="dark/zinc" className="w-full" disabled={isSubmitting}>
                <LinkIcon data-slot="icon" />
                {isSubmitting ? 'Validando credencial…' : 'Emparejar kiosko'}
              </Button>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
