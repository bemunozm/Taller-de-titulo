

import { useForm, Controller } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field, Fieldset, Label } from '@/components/ui/Fieldset'
import { Heading } from '@/components/ui/Heading'
import { Input } from '@/components/ui/Input'
import { Text, TextLink } from '@/components/ui/Text'
import { Divider } from '@/components/ui/Divider'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { type UserLoginForm } from '@/types/index'
import { authenticateUser } from '@/api/AuthAPI'
import { toast } from 'react-toastify'
import { useNavigate } from 'react-router-dom'

export default function LoginView() {
  const navigate = useNavigate()
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    control,
  } = useForm<UserLoginForm>()

  const { mutate, isPending } = useMutation({
    mutationFn: authenticateUser,
    onSuccess: () => {
      toast.success('¡Bienvenido! Has iniciado sesión correctamente')
      reset() // Limpiar el formulario
      navigate('/') // Redirigir al dashboard
    },
    onError: (error) => {
      console.error('Error al iniciar sesión:', error)
      toast.error(error.message || 'Error al iniciar sesión')
    }
  })

  const onSubmit = (data: UserLoginForm) => {
    mutate(data)
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="text-center mb-6 sm:mb-8">
        <Heading level={1} className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Iniciar sesión
        </Heading>
        <Text className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Ingresa tus credenciales para acceder a tu cuenta
        </Text>
      </div>

      {/* Form Section */}
      <form 
        onSubmit={handleSubmit(onSubmit)} 
        className="space-y-4 sm:space-y-6"
        noValidate
        aria-label="Formulario de inicio de sesión"
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

          <Field>
            <Label htmlFor="password" className="block text-sm font-medium">
              Contraseña *
            </Label>
            <Controller
              name="password"
              control={control}
              rules={{
                required: 'La contraseña es requerida',
                minLength: {
                  value: 6,
                  message: 'La contraseña debe tener al menos 6 caracteres'
                }
              }}
              render={({ field }) => (
                <div className="mt-1">
                  <PasswordInput
                    id="password"
                    name="password"
                    placeholder="Ingrese su contraseña"
                    value={field.value || ''}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={!!errors.password}
                    required
                  />
                  {errors.password && (
                    <Text 
                      id="password-error" 
                      className="mt-2 text-xs sm:text-sm text-red-600 dark:text-red-400"
                      role="alert"
                      aria-live="polite"
                    >
                      {errors.password.message}
                    </Text>
                  )}
                </div>
              )}
            />
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
                <span>Iniciando sesión...</span>
              </div>
            ) : (
              'Iniciar sesión'
            )}
          </Button>
          {isPending && (
            <Text 
              id="loading-description" 
              className="sr-only"
            >
              Procesando su solicitud de inicio de sesión, por favor espere
            </Text>
          )}
        </div>

        {/* Forgot Password Link */}
        <div className="text-center">
          <TextLink 
            to="/auth/forgot-password"
            className="text-xs sm:text-sm font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2"
          >
            ¿Olvidaste tu contraseña?
          </TextLink>
        </div>

      </form>
    </div>
  )
}
