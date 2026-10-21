import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PrivacyPolicyContent } from '@/components/privacy/PrivacyPolicyContent'
import {
  PRIVACY_POLICY_EFFECTIVE_DATE,
  PRIVACY_POLICY_EFFECTIVE_DATE_LABEL,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  RETENTION_DAYS,
  formatRetention,
  getPrivacyController,
  getPrivacySection,
} from '@/helpers/privacyPolicy'

const KEY_FACTS: readonly { value: string; label: string }[] = [
  { value: formatRetention(RETENTION_DAYS.images), label: 'se guardan las imágenes de cámaras y patentes' },
  { value: formatRetention(RETENTION_DAYS.visits), label: 'se guardan los datos de visitas y llamadas' },
  { value: 'Sin audio', label: 'la voz se procesa en vivo y no se graba' },
  { value: 'Sin biometría', label: 'no hay reconocimiento facial ni de voz' },
]

/** Lleva al ancla del hash al llegar (p. ej. `/privacy-policy#derechos` desde el perfil). */
function useScrollToHash(hash: string): void {
  useEffect(() => {
    if (hash.length <= 1) {
      return
    }
    const target = document.getElementById(decodeURIComponent(hash.slice(1)))
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView()
    }
  }, [hash])
}

/**
 * Política de privacidad pública (art. 14 ter, Ley 21.719): sin sesión ni
 * layout autenticado. Enlazada desde la landing, el login y el kiosko.
 */
export function PrivacyPolicyView() {
  const { hash } = useLocation()
  const controller = getPrivacyController()
  useScrollToHash(hash)

  return (
    <div className="min-h-dvh bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <title>Política de privacidad · Vigilia</title>

      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:ring-2 focus:ring-indigo-500 dark:focus:bg-zinc-900"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-zinc-950/5 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link to="/" aria-label="Vigilia, ir al inicio" className="rounded-md">
            {/* El PNG trae mucho margen transparente: se agranda sin engrosar el header. */}
            <img src="/logo-fondo-oscuro.png" alt="" className="-my-5 h-24 w-auto" />
          </Link>
          <Link
            to="/"
            className="rounded-md text-sm font-medium text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
          >
            Volver al inicio
          </Link>
        </div>
      </header>

      <main id="contenido">
        {/* Portada */}
        <div className="relative isolate overflow-hidden border-b border-zinc-950/5 dark:border-white/10">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_28rem_at_15%_-10%,--theme(--color-indigo-500/12%),transparent)] dark:bg-[radial-gradient(60rem_28rem_at_15%_-10%,--theme(--color-indigo-500/20%),transparent)]"
          />
          <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
            <p className="font-mono text-xs font-medium tracking-[0.2em] text-indigo-600 uppercase dark:text-indigo-400">
              Ley 21.719 · Transparencia
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Política de privacidad</h1>
            <p className="mt-5 max-w-2xl text-lg/8 text-pretty text-zinc-600 dark:text-zinc-300">
              Cómo se tratan tus datos en el control de acceso del condominio: la asistente de voz del citófono y del
              kiosko, las cámaras y el lector de patentes.
            </p>
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 text-sm">
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Versión</dt>
                <dd className="mt-0.5 font-medium">{PRIVACY_POLICY_VERSION}</dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Vigente desde</dt>
                <dd className="mt-0.5 font-medium">
                  <time dateTime={PRIVACY_POLICY_EFFECTIVE_DATE}>{PRIVACY_POLICY_EFFECTIVE_DATE_LABEL}</time>
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500 dark:text-zinc-400">Responsable</dt>
                <dd className="mt-0.5 font-medium">{controller.name}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* En breve */}
        <section aria-labelledby="en-breve" className="border-b border-zinc-950/5 dark:border-white/10">
          <div className="mx-auto max-w-6xl px-6 py-10">
            <h2 id="en-breve" className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              En breve
            </h2>
            <ul role="list" className="mt-5 grid gap-px overflow-hidden rounded-2xl bg-zinc-950/5 ring-1 ring-zinc-950/5 sm:grid-cols-2 lg:grid-cols-4 dark:bg-white/10 dark:ring-white/10">
              {KEY_FACTS.map((fact) => (
                <li key={fact.value} className="bg-white p-6 dark:bg-zinc-950">
                  <p className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{fact.value}</p>
                  <p className="mt-1 text-sm/6 text-zinc-600 dark:text-zinc-400">{fact.label}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Índice + contenido */}
        <div className="mx-auto max-w-6xl px-6 py-12 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16 lg:py-16">
          <nav aria-label="Índice de la política" className="mb-12 lg:sticky lg:top-8 lg:mb-0 lg:self-start">
            <p className="text-sm font-semibold text-zinc-950 dark:text-white">Contenido</p>
            <ol className="mt-4 space-y-1 border-l border-zinc-950/10 dark:border-white/10">
              {PRIVACY_POLICY_SECTIONS.map(({ id }) => {
                const section = getPrivacySection(id)
                return (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="-ml-px flex gap-3 border-l border-transparent py-1 pl-4 text-sm/6 text-zinc-600 hover:border-indigo-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                    >
                      <span aria-hidden="true" className="font-mono text-xs/6 text-zinc-400 tabular-nums dark:text-zinc-500">
                        {section.number}
                      </span>
                      {section.title}
                    </a>
                  </li>
                )
              })}
            </ol>
          </nav>

          <article className="max-w-3xl">
            <PrivacyPolicyContent />
          </article>
        </div>
      </main>

      <footer className="border-t border-zinc-950/5 dark:border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 text-sm text-zinc-500 sm:flex-row sm:justify-between dark:text-zinc-400">
          <p>
            Vigilia · Política de privacidad, versión {PRIVACY_POLICY_VERSION}
          </p>
          <a href="#contenido" className="hover:text-zinc-950 dark:hover:text-white">
            Volver arriba
          </a>
        </div>
      </footer>
    </div>
  )
}
