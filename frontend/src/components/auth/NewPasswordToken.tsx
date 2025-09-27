import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { Field, Fieldset } from '@/components/ui/Fieldset'
import { Text } from '@/components/ui/Text'
import PinCode from '@/components/PinCode'
import type { ConfirmToken } from '@/types/index'
import { validateToken } from '@/api/AuthAPI'
import { toast } from 'react-toastify'
import { useState, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

interface NewPasswordTokenProps {
  setToken: Dispatch<SetStateAction<string>>
  setIsValidToken: Dispatch<SetStateAction<boolean>>
  initialToken?: string
}

export default function NewPasswordToken({ setToken, setIsValidToken, initialToken }: NewPasswordTokenProps) {
  const [pinValues, setPinValues] = useState<string[]>(['', '', '', '', '', ''])
  const [autoSubmitted, setAutoSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ConfirmToken>()

  const { mutate, isPending } = useMutation({
    mutationFn: validateToken,
    onSuccess: (data) => {
      toast.success(data)
      setIsValidToken(true)
      setIsSubmitting(false)
    },
    onError: (error) => {
      console.error('Error al validar el token:', error)
      toast.error(error.message || 'Token inválido o expirado')
      // Limpiar los campos al fallar
      setPinValues(['', '', '', '', '', ''])
      setValue('token', '')
      setToken('')
      setAutoSubmitted(false)
      setIsSubmitting(false)
    }
  })

  // Efecto para inicializar con el token de la URL
  useEffect(() => {
    if (initialToken && initialToken.length === 6 && !autoSubmitted && !isSubmitting && !isPending) {
      const tokenArray = initialToken.split('')
      setPinValues(tokenArray)
      setValue('token', initialToken)
      setToken(initialToken)
      
      // Auto-validar después de un pequeño delay
      setTimeout(() => {
        if (!isSubmitting && !isPending) {
          setAutoSubmitted(true)
          setIsSubmitting(true)
          mutate({ token: initialToken })
        }
      }, 1000)
    }
  }, [initialToken, setValue, setToken, mutate, autoSubmitted, isSubmitting, isPending])

  const handlePinChange = (values: string[], fullValue: string) => {
    setPinValues(values)
    setValue('token', fullValue)
    setToken(fullValue)
  }

  const handlePinComplete = (fullValue: string) => {
    // Solo auto-submit si NO vino desde URL y no se está procesando
    if (!autoSubmitted && !isSubmitting && !isPending) {
      setIsSubmitting(true)
      mutate({ token: fullValue })
    }
  }

  const onSubmit = (data: ConfirmToken) => {
    if (!isSubmitting && !isPending) {
      setIsSubmitting(true)
      mutate(data)
    }
  }

  return (
    <form 
      onSubmit={handleSubmit(onSubmit)} 
      className="space-y-4 sm:space-y-6"
      noValidate
      aria-label="Formulario de validación de token"
    >
      <Fieldset className="space-y-4 sm:space-y-6">
        
        <Field>
          <div className="text-center space-y-4 sm:space-y-6">
            <Text className="text-sm sm:text-base text-gray-600 dark:text-gray-400">
              Ingresa el código de 6 dígitos que recibiste por correo electrónico
            </Text>
            
            <PinCode
              length={6}
              value={pinValues}
              onChange={handlePinChange}
              onComplete={handlePinComplete}
              disabled={isPending || isSubmitting}
              loading={isPending || isSubmitting}
              error={!!errors.token}
              autoSubmit={true}
              autoSubmitDelay={800}
              className="mx-auto"
            />
            
            {errors.token && (
              <Text 
                className="text-xs sm:text-sm text-red-600 dark:text-red-400"
                role="alert"
                aria-live="polite"
              >
                {errors.token.message}
              </Text>
            )}
          </div>
        </Field>

      </Fieldset>

      {/* Instructions */}
      <div className="text-center">
        <Text className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
          El código se verificará automáticamente al completar los 6 dígitos
        </Text>
      </div>

      {/* Help Text */}
      <div className="text-center">
        <Text className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
          Si no recibiste el código, revisa tu carpeta de spam o solicita uno nuevo.
        </Text>
      </div>
    </form>
  )
}
