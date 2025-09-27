import React from 'react'
import { useForm, Controller } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { Button } from '@/components/ui/Button'
import { Field, Fieldset, Label } from '@/components/ui/Fieldset'
import { Heading } from '@/components/ui/Heading'
import { Input } from '@/components/ui/Input'
import { Text, TextLink } from '@/components/ui/Text'
import { Divider } from '@/components/ui/Divider'
import { Select } from '@/components/ui/Select'
import { PasswordInputWithStrength } from '@/components/ui/PasswordStrengthIndicator'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { type UserRegistrationForm } from '@/types/index'
import { createAccount } from '@/api/AuthAPI'
import { toast } from 'react-toastify'
import { formatRUT, isValidRUT, isValidPassport } from '@/helpers/index'
import { useNavigate } from 'react-router-dom'

export default function RegisterView() {

  const navigate = useNavigate()
  
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setValue,
    control,
    clearErrors,
    watch,
  } = useForm<UserRegistrationForm>()

  const [documentType, setDocumentType] = useState('rut')

  const { mutate, isPending } = useMutation({
    mutationFn: createAccount,
    onSuccess: (data) => {
      toast.success(data)
      reset() // Limpiar el formulario
      navigate('/auth/login')
    },
    onError: (error) => {
      console.error('Error al crear la cuenta:', error)
      toast.error(error.message)
    }
  })

  const onSubmit = (data: UserRegistrationForm) => {
    mutate(data)
  }
  return (
    <div className="mx-auto w-full max-w-md px-4 sm:px-6 lg:px-8">
      {/* Header Section */}
      <div className="text-center mb-6 sm:mb-8">
        <Heading level={1} className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
          Crear cuenta
        </Heading>
        <Text className="mt-2 sm:mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-400">
          Complete la información para crear su cuenta
        </Text>
      </div>

      {/* Form Section */}
      <form 
        onSubmit={handleSubmit(onSubmit)} 
        className="space-y-4 sm:space-y-6"
        noValidate
        aria-label="Formulario de registro"
      >
        <Fieldset className="space-y-4 sm:space-y-6">
          {/* Personal Information Section */}
          <div className="space-y-3 sm:space-y-4">
            <Text className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Información Personal
            </Text>
            
            <Field>
              <Label htmlFor="name" className="block text-sm font-medium">
                Nombre completo *
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="Ingrese su nombre completo"
                autoComplete="name"
                aria-describedby={errors.name ? 'name-error' : undefined}
                {...register('name', {
                  required: 'El nombre es requerido',
                  minLength: {
                    value: 2,
                    message: 'El nombre debe tener al menos 2 caracteres'
                  },
                  pattern: {
                    value: /^[a-zA-ZÀ-ÿ\u00f1\u00d1\s]+$/,
                    message: 'El nombre solo puede contener letras y espacios'
                  }
                })}
                invalid={!!errors.name}
                className="mt-1"
              />
              {errors.name && (
                <Text 
                  id="name-error" 
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {errors.name.message}
                </Text>
              )}
            </Field>

            <Field>
              <Label htmlFor="rut" className="block text-sm font-medium">
                {documentType === 'rut' ? 'RUT Chileno *' : 'Pasaporte/DNI *'}
              </Label>
              <div className="mt-1 flex gap-2">
                <Select
                  value={documentType}
                  onChange={(e) => {
                    setDocumentType(e.target.value)
                    // Limpiar el campo y errores cuando cambie el tipo
                    setValue('rut', '', { shouldValidate: false })
                    clearErrors('rut')
                  }}
                  className="w-20 sm:w-24 flex-shrink-0"
                  aria-label="Tipo de documento"
                >
                  <option value="rut">RUT</option>
                  <option value="passport">DNI</option>
                </Select>
                <Input
                  id="rut"
                  type="text"
                  placeholder={
                    documentType === 'rut' 
                      ? "12345678-9" 
                      : "A1234567"
                  }
                  autoComplete="off"
                  aria-describedby={errors.rut ? 'rut-error' : undefined}
                  {...register('rut', {
                    required: `El ${documentType === 'rut' ? 'RUT' : 'pasaporte/DNI'} es requerido`,
                    validate: (value) => {
                      if (!value) return `El ${documentType === 'rut' ? 'RUT' : 'pasaporte/DNI'} es requerido`
                      
                      if (documentType === 'rut') {
                        return isValidRUT(value) || 'Ingrese un RUT válido'
                      } else {
                        return isValidPassport(value) || 'Ingrese un documento válido'
                      }
                    },
                    onChange: (e) => {
                      const value = e.target.value
                      
                      if (documentType === 'rut') {
                        // Solo formatear como RUT si el tipo seleccionado es RUT
                        const formatted = formatRUT(value)
                        setValue('rut', formatted)
                        return formatted
                      } else {
                        // Para pasaportes, mantener en mayúsculas sin formatear
                        const upperValue = value.toUpperCase()
                        setValue('rut', upperValue)
                        return upperValue
                      }
                    }
                  })}
                  invalid={!!errors.rut}
                  className="flex-1"
                />
              </div>
              {errors.rut && (
                <Text 
                  id="rut-error" 
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {errors.rut.message}
                </Text>
              )}
            </Field>

            <Field>
              <Label htmlFor="phone" className="block text-sm font-medium">
                Teléfono *
              </Label>
              <Controller
                name="phone"
                control={control}
                rules={{
                  required: 'El teléfono es requerido',
                  validate: (value) => {
                    if (!value) return 'El teléfono es requerido'
                    // Validar que sea un número válido (la librería ya hace la validación básica)
                    return value.length >= 10 || 'Ingrese un número de teléfono válido'
                  }
                }}
                render={({ field: { onChange, value, ...fieldProps } }) => {
                  // Crear un componente memoizado para evitar re-renders
                  const PhoneInputComponent = React.useMemo(() => 
                    React.forwardRef<HTMLInputElement, any>((props, ref) => (
                      <Input 
                        {...props} 
                        ref={ref}
                        invalid={!!errors.phone}
                      />
                    )), [errors.phone])

                  return (
                    <PhoneInput
                      {...fieldProps}
                      value={value}
                      onChange={onChange}
                      defaultCountry="CL"
                      placeholder="Ingrese su número de teléfono"
                      international={true}
                      withCountryCallingCode={true}
                      countryCallingCodeEditable={false}
                      inputComponent={PhoneInputComponent}
                      className="mt-1"
                    />
                  )
                }}
              />
              {errors.phone && (
                <Text 
                  id="phone-error" 
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {errors.phone.message}
                </Text>
              )}
            </Field>

            <Field>
              <Label htmlFor="age" className="block text-sm font-medium">
                Edad *
              </Label>
              <Input
                id="age"
                type="number"
                placeholder="Ingrese su edad"
                min="13"
                max="120"
                aria-describedby={errors.age ? 'age-error' : undefined}
                {...register('age', {
                  required: 'La edad es requerida',
                  valueAsNumber: true,
                  min: {
                    value: 13,
                    message: 'Debe ser mayor de 13 años para registrarse'
                  },
                  max: {
                    value: 120,
                    message: 'Ingrese una edad válida'
                  }
                })}
                invalid={!!errors.age}
                className="mt-1"
              />
              {errors.age && (
                <Text 
                  id="age-error" 
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                  role="alert"
                >
                  {errors.age.message}
                </Text>
              )}
            </Field>
          </div>

          {/* Divider */}
          <Divider className="my-6" />

          {/* Account Information Section */}
          <div className="space-y-3 sm:space-y-4">
            <Text className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">
              Información de la Cuenta
            </Text>
            
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
                    message: 'Ingrese un formato de email válido'
                  }
                })}
                invalid={!!errors.email}
                className="mt-1"
              />
              {errors.email && (
                <Text 
                  id="email-error" 
                  className="mt-2 text-sm text-red-600 dark:text-red-400"
                  role="alert"
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
                    value: 8,
                    message: 'La contraseña debe tener al menos 8 caracteres'
                  },
                  validate: {
                    hasUpperCase: (value) => 
                      !value || /[A-Z]/.test(value) || 'Debe contener al menos una letra mayúscula (A-Z)',
                    hasLowerCase: (value) => 
                      !value || /[a-z]/.test(value) || 'Debe contener al menos una letra minúscula (a-z)',
                    hasNumber: (value) => 
                      !value || /\d/.test(value) || 'Debe contener al menos un número (0-9)',
                    hasSpecialChar: (value) => 
                      !value || /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?]/.test(value) || 'Debe contener al menos un carácter especial (!@#$%^&*)',
                    noSpaces: (value) => 
                      !value || !/\s/.test(value) || 'No debe contener espacios en blanco',
                    strongPassword: (value) => {
                      if (!value) return true
                      const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\?])[\S]{8,}$/
                      return strongRegex.test(value) || 'La contraseña no cumple con los requisitos de seguridad'
                    }
                  }
                }}
                render={({ field }) => (
                  <div className="mt-1">
                    <PasswordInputWithStrength
                      id="password"
                      name="password"
                      placeholder="Mínimo 8 caracteres"
                      password={field.value || ''}
                      value={field.value || ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      error={!!errors.password}
                      required
                    />
                    {errors.password && (
                      <Text 
                        id="password-error" 
                        className="mt-2 text-sm text-red-600 dark:text-red-400"
                        role="alert"
                      >
                        {errors.password.message}
                      </Text>
                    )}
                  </div>
                )}
              />
            </Field>

            <Field>
              <Label htmlFor="password_confirmation" className="block text-sm font-medium">
                Confirmar Contraseña *
              </Label>
              <Controller
                name="password_confirmation"
                control={control}
                rules={{
                  required: 'Debe confirmar su contraseña',
                  validate: {
                    matchesPassword: (value) => {
                      const password = watch('password')
                      return !value || !password || value === password || 'Las contraseñas no coinciden'
                    }
                  }
                }}
                render={({ field }) => (
                  <div className="mt-1">
                    <PasswordInput
                      id="password_confirmation"
                      name="password_confirmation"
                      placeholder="Repita su contraseña"
                      value={field.value || ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      error={!!errors.password_confirmation}
                      required
                    />
                    {errors.password_confirmation && (
                      <Text 
                        id="password_confirmation-error" 
                        className="mt-2 text-sm text-red-600 dark:text-red-400"
                        role="alert"
                      >
                        {errors.password_confirmation.message}
                      </Text>
                    )}
                  </div>
                )}
              />
            </Field>
          </div>
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
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                Creando cuenta...
              </>
            ) : (
              'Crear cuenta'
            )}
          </Button>
          {isPending && (
            <Text 
              id="loading-description" 
              className="sr-only"
            >
              Procesando su solicitud de registro, por favor espere
            </Text>
          )}
        </div>

        {/* Footer Link */}
        <Divider className="my-4 sm:my-6" />
        
        <div className="text-center">
          <Text className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            ¿Ya tienes una cuenta?{' '}
            <TextLink 
              to="/auth/login"
              className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 underline-offset-2"
            >
              Iniciar sesión
            </TextLink>
          </Text>
        </div>
      </form>
    </div>
  )
}
