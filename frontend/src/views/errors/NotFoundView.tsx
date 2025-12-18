import { Button } from '@/components/ui/Button'
import { Heading } from '@/components/ui/Heading'
import { Text } from '@/components/ui/Text'
import { useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

/**
 * Vista 404 - Página No Encontrada
 * Diseño inspirado en Vercel y GitHub con mejores prácticas UX/UI
 */
export function NotFoundView() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center bg-zinc-950">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 -z-10 -translate-x-1/2 blur-3xl xl:-top-6" aria-hidden="true">
          <div
            className="aspect-[1155/678] w-[72.1875rem] bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 opacity-30"
            style={{
              clipPath:
                'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
            }}
          />
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 text-center">
        <div>
          {/* Código de error con animación */}
          <div className="mb-6 animate-pulse">
            <p className="text-sm font-semibold leading-7 text-indigo-400">Error 404</p>
          </div>

          {/* Título principal */}
          <Heading className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Página no encontrada
          </Heading>

          {/* Descripción */}
          <Text className="mt-4 text-base leading-7 text-zinc-400">
            Lo sentimos, no pudimos encontrar la página que estás buscando.
          </Text>

          {/* Ruta intentada - con estilo de código */}
          {location.pathname && location.pathname !== '/' && (
            <div className="mt-6 inline-block rounded-lg bg-zinc-900/50 px-4 py-2 ring-1 ring-zinc-800">
              <code className="text-sm text-zinc-300 font-mono">{location.pathname}</code>
            </div>
          )}

          {/* Acciones principales */}
          <div className="mt-8">
            <Button
              onClick={() => navigate(-1)}
              color="white"
            >
              <ArrowLeftIcon className="h-5 w-5" />
              Volver atrás
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}
