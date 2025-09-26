import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field, Fieldset, Label } from '@/components/ui/Fieldset'
import { Heading } from '@/components/ui/Heading'
import { Input } from '@/components/ui/Input'
import { Text, TextLink } from '@/components/ui/Text'
import { type UserFormData } from '../../types/index'
import { createAccount } from '../../api/AuthAPI'

export default function RegisterView() {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm<UserFormData>()

  const { mutate, isPending, error, isSuccess } = useMutation({
    mutationFn: createAccount,
    onSuccess: () => {
      console.log('Cuenta creada exitosamente')
      reset() // Limpiar el formulario
      // Aquí puedes agregar redirección o mostrar mensaje de éxito
    },
    onError: (error) => {
      console.error('Error al crear la cuenta:', error)
    }
  })

  const onSubmit = (data: UserFormData) => {
    mutate(data)
  }

  return (
      <form 
        onSubmit={handleSubmit(onSubmit)} 
        className="grid w-full max-w-sm grid-cols-1 gap-6"
      >
        <div className="text-center">
          <Heading className="text-2xl font-bold">Crear cuenta</Heading>
          <Text className="mt-2 text-gray-600">
            Complete los datos para registrarse
          </Text>
        </div>

        <Fieldset>
          <Field>
            <Label htmlFor="name">Nombre completo</Label>
            <Input
              id="name"
              type="text"
              {...register('name', {
                required: 'El nombre es requerido',
                minLength: {
                  value: 1,
                  message: 'El nombre es requerido'
                }
              })}
              invalid={!!errors.name}
            />
            {errors.name && (
              <Text className="mt-1 text-sm text-red-600">
                {errors.name.message}
              </Text>
            )}
          </Field>

          <Field>
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              id="email"
              type="email"
              {...register('email', {
                required: 'El correo electrónico es requerido',
                pattern: {
                  value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                  message: 'Formato de email inválido'
                }
              })}
              invalid={!!errors.email}
            />
            {errors.email && (
              <Text className="mt-1 text-sm text-red-600">
                {errors.email.message}
              </Text>
            )}
          </Field>

          <Field>
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register('password', {
                required: 'La contraseña es requerida',
                minLength: {
                  value: 6,
                  message: 'La contraseña debe tener al menos 6 caracteres'
                }
              })}
              invalid={!!errors.password}
            />
            {errors.password && (
              <Text className="mt-1 text-sm text-red-600">
                {errors.password.message}
              </Text>
            )}
          </Field>

          <Field>
            <Label htmlFor="age">Edad</Label>
            <Input
              id="age"
              type="number"
              {...register('age', {
                required: 'La edad es requerida',
                valueAsNumber: true,
                min: {
                  value: 1,
                  message: 'La edad debe ser un número positivo'
                },
                max: {
                  value: 120,
                  message: 'Edad no válida'
                }
              })}
              invalid={!!errors.age}
            />
            {errors.age && (
              <Text className="mt-1 text-sm text-red-600">
                {errors.age.message}
              </Text>
            )}
          </Field>
        </Fieldset>

        {error && (
          <Text className="text-sm text-red-600 text-center">
            {error.message}
          </Text>
        )}

        {isSuccess && (
          <Text className="text-sm text-green-600 text-center">
            Cuenta creada exitosamente. Revisa tu correo para confirmar tu cuenta.
          </Text>
        )}

        <Button 
          type="submit" 
          className="w-full"
          disabled={isPending}
        >
          {isPending ? 'Creando cuenta...' : 'Crear cuenta'}
        </Button>

        <Text className="text-center">
          ¿Ya tienes una cuenta?{' '}
          <TextLink to="/login">
            Iniciar sesión
          </TextLink>
        </Text>
      </form>
  )
}
