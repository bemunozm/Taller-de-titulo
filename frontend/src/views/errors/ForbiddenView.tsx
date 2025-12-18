import { Button } from '@/components/ui/Button'
import { Heading } from '@/components/ui/Heading'
import { Text } from '@/components/ui/Text'
import { useNavigate } from 'react-router-dom'
import { ArrowLeftIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline'
import { useAuth } from '@/hooks/useAuth'

/**
 * Vista 403 - Acceso Prohibido
 * Diseño inspirado en Stripe y GitHub con contexto del usuario
 */
export function ForbiddenView() {
  const navigate = useNavigate()
  const { data: user } = useAuth()

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center bg-zinc-950">
      {/* Efectos de fondo */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 -z-10 -translate-x-1/2 blur-3xl xl:-top-6" aria-hidden="true">
          <div
            className="aspect-[1155/678] w-[72.1875rem] bg-gradient-to-tr from-red-500/20 to-orange-500/20 opacity-30"
            style={{
              clipPath:
                'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)',
            }}
          />
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 text-center">
        <div>
          {/* Icono de seguridad */}
          <div className="mb-6 flex justify-center">
            <div className="rounded-2xl bg-red-500/10 p-3 ring-1 ring-red-500/20">
              <ShieldExclamationIcon className="h-10 w-10 text-red-400" />
            </div>
          </div>

          {/* Código de error */}
          <div className="mb-6">
            <p className="text-sm font-semibold leading-7 text-red-400">Error 403</p>
          </div>

          {/* Título principal */}
          <Heading className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Acceso denegado
          </Heading>

          {/* Descripción contextual */}
          <Text className="mt-4 text-base leading-7 text-zinc-400">
            No tienes los permisos necesarios para acceder a este recurso.
            {user && (
              <span className="block mt-2 text-sm text-zinc-500">
                Sesión iniciada como: <span className="font-medium text-zinc-400">{user.email}</span>
              </span>
            )}
          </Text>

          {/* Card informativa */}
          <div className="mt-8 rounded-xl bg-zinc-900/50 p-5 ring-1 ring-zinc-800">
            <div className="flex items-start gap-4 text-left">
              <div className="flex-shrink-0">
                <div className="rounded-lg bg-amber-500/10 p-2">
                  <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-white">¿Por qué veo esto?</h3>
                <Text className="mt-2 text-sm text-zinc-400">
                  Tu cuenta no tiene los permisos requeridos para ver esta página. Si crees que deberías tener acceso, contacta al administrador del sistema.
                </Text>
              </div>
            </div>
          </div>

          {/* Acciones principales */}
          <div className="mt-8">
            <Button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-zinc-900 shadow-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white transition-all"
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
