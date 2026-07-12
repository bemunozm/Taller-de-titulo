import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Heading } from '@/components/ui/Heading'
import { Text, TextLink } from '@/components/ui/Text'
import { Divider } from '@/components/ui/Divider'
import { confirmAccount } from '@/api/AuthAPI'
import { toast } from 'react-toastify'

/**
 * Tarea #20: better-auth confirma la cuenta con un token opaco de un solo uso
 * que viaja como query param en el link del email (`/auth/confirm-account?token=...`),
 * ya no con un código de 6 dígitos que el usuario tipeaba a mano. Esta vista
 * solo lee el token de la URL y confirma automáticamente.
 */
export default function ConfirmAccountView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const hasSubmitted = useRef(false)

  const { mutate, isPending, isError } = useMutation({
    mutationFn: confirmAccount,
    onSuccess: (data) => {
      toast.success(data)
      navigate('/auth/login')
    },
    onError: (error) => {
      console.error('Error al confirmar la cuenta:', error)
      toast.error(error.message || 'El enlace de confirmación es inválido o expiró')
    }
  })

  useEffect(() => {
    if (token && !hasSubmitted.current) {
      hasSubmitted.current = true
      mutate({ token })
    }
  }, [token, mutate])

  const showRetryHelp = !token || isError

  return (
    <div className="mx-auto w-full max-w-md px-4 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="text-center mb-6 sm:mb-8">
        <Heading level={1} className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Confirmar cuenta
        </Heading>
        <Text className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400">
          {!token && 'Revisa tu correo y haz clic en el enlace de confirmación que te enviamos.'}
          {token && isPending && 'Confirmando tu cuenta...'}
          {token && isError && 'No pudimos confirmar tu cuenta con este enlace.'}
          {token && !isPending && !isError && 'Haz clic en el enlace de tu correo para confirmar tu cuenta.'}
        </Text>
      </div>

      {isPending && (
        <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="sr-only">Confirmando cuenta, por favor espere</span>
        </div>
      )}

      {showRetryHelp && (
        <div className="text-center space-y-3">
          <Text className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
            ¿El enlace no funciona o ya expiró?{' '}
            <TextLink
              to="/auth/request-code"
              className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Solicitar un nuevo enlace
            </TextLink>
          </Text>
        </div>
      )}

      {/* Footer Links */}
      <Divider className="my-4 sm:my-6" />

      <div className="text-center">
        <Text className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
          ¿Ya confirmaste tu cuenta?{' '}
          <TextLink
            to="/auth/login"
            className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2"
          >
            Iniciar sesión
          </TextLink>
        </Text>
      </div>
    </div>
  )
}
