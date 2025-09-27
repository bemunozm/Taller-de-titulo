import NewPasswordToken from "@/components/auth/NewPasswordToken"
import NewPasswordForm from "@/components/auth/NewPasswordForm"
import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import type { ConfirmToken } from "@/types/index"
import { Heading } from '@/components/ui/Heading'
import { Text } from '@/components/ui/Text'

export default function NewPasswordView() {
    const [searchParams] = useSearchParams()
    const [token, setToken] = useState<ConfirmToken['token']>('')
    const [isValidToken, setIsValidToken] = useState(false)

    // Efecto para auto-completar el token desde la URL
    useEffect(() => {
        const tokenFromUrl = searchParams.get('token')
        if (tokenFromUrl && tokenFromUrl.length === 6) {
            setToken(tokenFromUrl)
            // No auto-validamos aquí, dejamos que el componente NewPasswordToken maneje la validación
        }
    }, [searchParams])

    return (
        <div className="mx-auto w-full max-w-md px-4 sm:px-6 lg:px-8">
            {/* Header Section */}
            <div className="text-center mb-6 sm:mb-8">
                <Heading level={1} className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
                    Reestablecer Password
                </Heading>
                <Text className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400">
                    Ingresa el código que recibiste{' '}
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">por email</span>
                </Text>
            </div>

            {/* Conditional Content */}
            {!isValidToken ? 
                <NewPasswordToken 
                    setToken={setToken} 
                    setIsValidToken={setIsValidToken}
                    initialToken={token}
                /> : 
                <NewPasswordForm token={token} />
            }
        </div>
    )
}
