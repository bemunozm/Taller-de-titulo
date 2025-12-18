import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field, Fieldset, Label } from '@/components/ui/Fieldset'
import { Heading } from '@/components/ui/Heading'
import { Input } from '@/components/ui/Input'
import { Text, TextLink } from '@/components/ui/Text'
import { Divider } from '@/components/ui/Divider'
import { type RequestConfirmationCodeForm } from '@/types/index'
import { requestConfirmationCode } from '@/api/AuthAPI'
import { toast } from 'react-toastify'
import { useNavigate } from 'react-router-dom'

export default function RequestCodeView() {
  const navigate = useNavigate()
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<RequestConfirmationCodeForm>()

  const { mutate, isPending } = useMutation({
    mutationFn: requestConfirmationCode,
    onSuccess: (data) => {
      toast.success(data)
      reset() // Limpiar el formulario
      // Navegar a la página de confirmación para ingresar el código
      navigate('/auth/confirm-account')
    },
    onError: (error) => {
      console.error('Error al solicitar código de confirmación:', error)
      toast.error(error.message || 'Error al enviar el código de confirmación')
    }
  })

  const onSubmit = (data: RequestConfirmationCodeForm) => {
    mutate(data)
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="text-center mb-6 sm:mb-8">
        <Heading level={1} className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Solicitar código de confirmación
        </Heading>
        <Text className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Ingresa tu correo electrónico y te enviaremos un nuevo código para confirmar tu cuenta
        </Text>
      </div>

      {/* Form Section */}
      <form 
        onSubmit={handleSubmit(onSubmit)} 
        className="space-y-4 sm:space-y-6"
        noValidate
        aria-label="Formulario de solicitud de código de confirmación"
      >
        <Fieldset className="space-y-4 sm:space-y-6">
          
          <Field>
            <Label htmlFor="email" className="block text-sm font-medium">
              Correo electrónico *
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="correo@ejemplo.com"
              autoComplete="email"
              aria-describedby={errors.email ? 'email-error' : undefined}
              {...register('email', {
                required: 'El correo electrónico es requerido',
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: 'Ingrese un correo electrónico válido'
                }
              })}
              invalid={!!errors.email}
              className="mt-1"
            />
            {errors.email && (
              <Text 
                id="email-error" 
                className="mt-1 text-xs sm:text-sm text-red-600 dark:text-red-400"
                role="alert"
                aria-live="polite"
              >
                {errors.email.message}
              </Text>
            )}
          </Field>

        </Fieldset>

        {/* Submit Button */}
        <div className="pt-2 sm:pt-4">
          <Button 
            type="submit" 
            className="w-full py-2.5 sm:py-3 text-sm sm:text-base font-medium"
            disabled={isPending}
            aria-describedby={isPending ? 'loading-description' : undefined}
          >
            {isPending ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Enviando...</span>
              </div>
            ) : (
              'Enviar código'
            )}
          </Button>
          {isPending && (
            <Text 
              id="loading-description" 
              className="sr-only"
            >
              Enviando código de confirmación, por favor espere
            </Text>
          )}
        </div>

        {/* Help Text */}
        <div className="text-center">
          <Text className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
            Revisa tu bandeja de entrada y la carpeta de spam. El código tiene una validez de 10 minutos.
          </Text>
        </div>

        {/* Footer Links */}
        <Divider className="my-4 sm:my-6" />
        
        <div className="text-center space-y-2">
          <div>
            <Text className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
              ¿Ya tienes un código?{' '}
              <TextLink 
                to="/auth/confirm-account"
                className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2"
              >
                Confirmar cuenta
              </TextLink>
            </Text>
          </div>
          <div>
            <Text className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
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
      </form>
    </div>
  )
}
