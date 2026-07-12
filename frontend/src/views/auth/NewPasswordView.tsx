import { useEffect, useRef } from "react"
import { useMutation } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import NewPasswordForm from "@/components/auth/NewPasswordForm"
import { validateToken } from "@/api/AuthAPI"
import { Heading } from '@/components/ui/Heading'
import { Text, TextLink } from '@/components/ui/Text'

/**
 * Tarea #20: el token de recuperación ahora es opaco (better-auth) y llega
 * como query param en el link del email (`/auth/new-password?token=...`), ya
 * no es un código de 6 dígitos que el usuario ingresaba a mano. Se valida el
 * token de la URL contra el backend antes de mostrar el formulario de nueva
 * contraseña.
 */
export default function NewPasswordView() {
    const [searchParams] = useSearchParams()
    const token = searchParams.get('token') ?? ''
    const hasValidated = useRef(false)

    const { mutate, isPending, isSuccess, isError, error } = useMutation({
        mutationFn: validateToken,
    })

    useEffect(() => {
        if (token && !hasValidated.current) {
            hasValidated.current = true
            mutate({ token })
        }
    }, [token, mutate])

    const showRetryHelp = !token || isError

    return (
        <div className="mx-auto w-full max-w-md px-4 sm:px-6 lg:px-8">
            {/* Header Section */}
            <div className="text-center mb-6 sm:mb-8">
                <Heading level={1} className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                    Restablecer contraseña
                </Heading>
                <Text className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400">
                    {!token && 'Este enlace no incluye un token de recuperación válido.'}
                    {token && isPending && 'Verificando tu enlace de recuperación...'}
                    {token && isError && (error?.message || 'El enlace de recuperación es inválido o expiró.')}
                    {isSuccess && 'Ingresa tu nueva contraseña.'}
                </Text>
            </div>

            {isPending && (
                <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <span className="sr-only">Verificando enlace, por favor espere</span>
                </div>
            )}

            {isSuccess && <NewPasswordForm token={token} />}

            {showRetryHelp && (
                <div className="text-center">
                    <Text className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
                        <TextLink
                            to="/auth/forgot-password"
                            className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                            Solicitar un nuevo enlace de recuperación
                        </TextLink>
                    </Text>
                </div>
            )}
        </div>
    )
}
