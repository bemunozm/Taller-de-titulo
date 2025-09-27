import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Field, Fieldset } from '@/components/ui/Fieldset'
import { Heading } from '@/components/ui/Heading'
import { Text, TextLink } from '@/components/ui/Text'
import { Divider } from '@/components/ui/Divider'
import PinCode from '@/components/PinCode'
import { type ConfirmToken } from '@/types/index'
import { confirmAccount } from '@/api/AuthAPI'
import { toast } from 'react-toastify'

export default function ConfirmAccountView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [pinValues, setPinValues] = useState<string[]>(['', '', '', '', '', ''])
  const [autoSubmitted, setAutoSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const {
    handleSubmit,
    setValue,
    formState: { errors },
    reset,
  } = useForm<ConfirmToken>()

  const { mutate, isPending } = useMutation({
    mutationFn: confirmAccount,
    onSuccess: (data) => {
      toast.success(data)
      reset()
      setIsSubmitting(false)
      navigate('/auth/login')
    },
    onError: (error) => {
      console.error('Error al confirmar la cuenta:', error)
      toast.error(error.message || 'Código inválido o expirado')
      // Limpiar los campos al fallar
      setPinValues(['', '', '', '', '', ''])
      setAutoSubmitted(false)
      setIsSubmitting(false)
    }
  })

  // Efecto para auto-completar el token desde la URL
  useEffect(() => {
    const tokenFromUrl = searchParams.get('token')
    if (tokenFromUrl && tokenFromUrl.length === 6 && !autoSubmitted && !isSubmitting && !isPending) {
      // Convertir el token en array de dígitos
      const tokenArray = tokenFromUrl.split('')
      setPinValues(tokenArray)
      setValue('token', tokenFromUrl)
      
      // Auto-submit después de un pequeño delay para que el usuario vea el código
      setTimeout(() => {
        if (!isSubmitting && !isPending) {
          setAutoSubmitted(true)
          setIsSubmitting(true)
          mutate({ token: tokenFromUrl })
        }
      }, 1000)
    }
  }, [searchParams, setValue, mutate, autoSubmitted, isSubmitting, isPending])

  const handlePinChange = (values: string[], fullValue: string) => {
    setPinValues(values)
    setValue('token', fullValue)
  }

  const handlePinComplete = (fullValue: string) => {
    // Solo auto-submit si NO vino desde URL y no se está procesando ya
    if (fullValue.length === 6 && !isPending && !autoSubmitted && !isSubmitting) {
      const tokenFromUrl = searchParams.get('token')
      // Si no hay token en URL o es diferente al completado manualmente
      if (!tokenFromUrl || tokenFromUrl !== fullValue) {
        setIsSubmitting(true)
        handleSubmit(onSubmit)()
      }
    }
  }

  const onSubmit = (data: ConfirmToken) => {
    if (data.token.length === 6 && !isPending && !isSubmitting) {
      setIsSubmitting(true)
      mutate(data)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="text-center mb-6 sm:mb-8">
        <Heading level={1} className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Confirmar cuenta
        </Heading>
        <Text className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Ingresa el código de 6 dígitos que enviamos a tu correo electrónico
        </Text>
      </div>

      {/* Form Section */}
      <form 
        onSubmit={handleSubmit(onSubmit)} 
        className="space-y-4 sm:space-y-6"
        noValidate
        aria-label="Formulario de confirmación de cuenta"
      >
        <Fieldset className="space-y-4 sm:space-y-6">
          
          <Field>
            {/* PIN Code Component */}
            <PinCode
              length={6}
              value={pinValues}
              onChange={handlePinChange}
              onComplete={handlePinComplete}
              disabled={isPending || isSubmitting}
              loading={isPending || isSubmitting}
              error={!!errors.token}
              autoSubmit={!autoSubmitted} // Solo auto-submit si no vino de URL
              autoSubmitDelay={1000}
              className="w-full"
            />
            
            {/* Mensaje de error */}
            {errors.token && (
              <Text 
                className="mt-2 text-center text-sm text-red-600 dark:text-red-400"
                role="alert"
                aria-live="polite"
              >
                {errors.token.message}
              </Text>
            )}
          </Field>

        </Fieldset>

        {/* Resend Code Section */}
        <div className="text-center space-y-3">
          <Text className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
            ¿No recibiste el código?{' '}
            <TextLink 
              to="/auth/request-code"
              className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Solicitar nuevo código
            </TextLink>
          </Text>
        </div>

        {/* Footer Links */}
        <Divider className="my-4 sm:my-6" />
        
        <div className="text-center space-y-2">
          <div>
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
          <div>
            <Text className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400">
              ¿No tienes una cuenta?{' '}
              <TextLink 
                to="/auth/register"
                className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2"
              >
                Crear cuenta
              </TextLink>
            </Text>
          </div>
        </div>
      </form>
    </div>
  )
}
