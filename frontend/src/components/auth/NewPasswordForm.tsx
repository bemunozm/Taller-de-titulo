import { useForm, Controller } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field, Fieldset, Label } from '@/components/ui/Fieldset'
import { Text } from '@/components/ui/Text'
import { PasswordInputWithStrength } from '@/components/ui/PasswordStrengthIndicator'
import type { NewPasswordForm, ConfirmToken } from '@/types/index'
import { updatePasswordWithToken } from '@/api/AuthAPI'
import { toast } from 'react-toastify'
import { useNavigate } from 'react-router-dom'

interface NewPasswordFormProps {
  token: ConfirmToken['token']
}

export default function NewPasswordForm({ token }: NewPasswordFormProps) {
  const navigate = useNavigate()
  
  const {
    handleSubmit,
    watch,
    control,
    formState: { errors },
    reset,
  } = useForm<NewPasswordForm>()

  const password = watch('password')

  const { mutate, isPending } = useMutation({
    mutationFn: updatePasswordWithToken,
    onSuccess: (data) => {
      toast.success(data)
      reset()
      navigate('/auth/login')
    },
    onError: (error) => {
      console.error('Error al actualizar la contraseña:', error)
      toast.error(error.message || 'Error al actualizar la contraseña')
    }
  })

  const onSubmit = (data: NewPasswordForm) => {
    mutate({ formData: data, token })
  }

  return (
    <form 
      onSubmit={handleSubmit(onSubmit)} 
      className="space-y-4 sm:space-y-6"
      noValidate
      aria-label="Formulario de nueva contraseña"
    >
      <Fieldset className="space-y-4 sm:space-y-6">
        
        {/* New Password Field */}
        <Field>
          <Label htmlFor="password" className="block text-sm font-medium">
            Nueva contraseña *
          </Label>
          <Controller
            name="password"
            control={control}
            rules={{
              required: 'La contraseña es requerida',
              minLength: {
                value: 8,
                message: 'La contraseña debe tener al menos 8 caracteres'
              },
              validate: {
                hasUppercase: (value) => /[A-Z]/.test(value) || 'Debe tener al menos una letra mayúscula',
                hasLowercase: (value) => /[a-z]/.test(value) || 'Debe tener al menos una letra minúscula',
                hasNumber: (value) => /\d/.test(value) || 'Debe tener al menos un número',
                hasSpecial: (value) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(value) || 'Debe tener al menos un carácter especial',
                noSpaces: (value) => !/\s/.test(value) || 'No debe contener espacios'
              }
            }}
            render={({ field }) => (
              <PasswordInputWithStrength
                id="password"
                name={field.name}
                placeholder="Ingresa tu nueva contraseña"
                value={field.value || ''}
                password={field.value || ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={!!errors.password}
                disabled={isPending}
                required
                showStrengthBar={true}
                showRequirementsList={true}
                className=""
              />
            )}
          />
          {errors.password && (
            <Text 
              className="mt-1 text-xs sm:text-sm text-red-600 dark:text-red-400"
              role="alert"
              aria-live="polite"
            >
              {errors.password.message}
            </Text>
          )}
        </Field>

        {/* Confirm Password Field */}
        <Field>
          <Label htmlFor="password_confirmation" className="block text-sm font-medium">
            Confirmar contraseña *
          </Label>
          <Controller
            name="password_confirmation"
            control={control}
            rules={{
              required: 'La confirmación de contraseña es requerida',
              validate: (value) => value === password || 'Las contraseñas no coinciden'
            }}
            render={({ field }) => (
              <PasswordInputWithStrength
                id="password_confirmation"
                name={field.name}
                placeholder="Confirma tu nueva contraseña"
                value={field.value || ''}
                password={field.value || ''}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={!!errors.password_confirmation}
                disabled={isPending}
                required
                showStrengthBar={false}
                showRequirementsList={false}
                className=""
              />
            )}
          />
          {errors.password_confirmation && (
            <Text 
              className="mt-1 text-xs sm:text-sm text-red-600 dark:text-red-400"
              role="alert"
              aria-live="polite"
            >
              {errors.password_confirmation.message}
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
              <span>Actualizando...</span>
            </div>
          ) : (
            'Actualizar contraseña'
          )}
        </Button>
        {isPending && (
          <Text 
            id="loading-description" 
            className="sr-only"
          >
            Actualizando contraseña, por favor espere
          </Text>
        )}
      </div>

      {/* Help Text */}
      <div className="text-center">
        <Text className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400">
          Tu nueva contraseña debe cumplir con todos los requisitos de seguridad mostrados arriba.
        </Text>
      </div>
    </form>
  )
}
