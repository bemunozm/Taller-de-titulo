import React, { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { createUser, updateUser } from '@/api/UserAPI'
import { listRoles } from '@/api/RoleAPI'
import { getFamilies } from '@/api/FamilyAPI'
import type { UserWithFamily, UserAdminFormData, UserUpdateData, Role } from '@/types/index'
import { userAdminFormSchema } from '@/types/index'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field, Label } from '@/components/ui/Fieldset'
import { Select } from '@/components/ui/Select'
import { formatRUT } from '@/helpers/index'
import MultiSelectCombobox from '@/components/ui/MultiSelectCombobox'

interface UserFormProps {
  user?: UserWithFamily
  onSuccess: () => void
}

export function UserForm({ user, onSuccess }: UserFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!user

  // Queries para roles y familias
  const { data: roles = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
  })

  const { data: families = [] } = useQuery({
    queryKey: ['families'],
    queryFn: getFamilies,
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    control,
    reset,
  } = useForm<UserAdminFormData>({
    resolver: zodResolver(userAdminFormSchema),
    defaultValues: {
      name: '',
      email: '',
      rut: '',
      phone: '',
      age: undefined,
      roleIds: [],
      familyId: '',
    },
  })

  // Actualizar valores del formulario cuando cambia el usuario o se cargan las familias
  useEffect(() => {
    if (user && families.length > 0) {
      reset({
        name: user.name,
        email: user.email,
        rut: user.rut,
        phone: user.phone || '',
        age: user.age,
        roleIds: user.roles?.map(r => r.id) || [],
        familyId: user.family?.id || '',
      })
    } else if (!user) {
      reset({
        name: '',
        email: '',
        rut: '',
        phone: '',
        age: undefined,
        roleIds: [],
        familyId: '',
      })
    }
  }, [user, families, reset])

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('✅ Usuario creado exitosamente. Se ha enviado un email con las instrucciones.')
      onSuccess()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear el usuario')
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('✅ Usuario actualizado exitosamente')
      onSuccess()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar el usuario')
    },
  })

  const onSubmit = (data: UserAdminFormData) => {
    // Validar que roleIds esté presente
    if (!data.roleIds || data.roleIds.length === 0) {
      toast.error('Debe seleccionar al menos un rol')
      return
    }

    // Limpiar valores vacíos
    const cleanedData = {
      ...data,
      phone: data.phone || undefined,
      age: data.age || undefined,
      roleIds: data.roleIds && data.roleIds.length > 0 ? data.roleIds : [],
      familyId: data.familyId || undefined, // undefined para remover familia
    }

    if (isEditing) {
      updateMutation.mutate({ id: user.id, formData: cleanedData as UserUpdateData })
    } else {
      // Para crear, roleIds debe ser un array no vacío
      if (cleanedData.roleIds.length === 0) {
        toast.error('Debe seleccionar al menos un rol')
        return
      }
      createMutation.mutate(cleanedData as any)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Información básica */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Información Personal</h3>
        
        {/* Nombre */}
        <Field>
          <Label>Nombre Completo *</Label>
          <Input
            {...register('name')}
            placeholder="Juan Carlos Pérez"
            disabled={isPending}
            invalid={!!errors.name}
          />
          {errors.name && (
            <p className="text-sm text-red-600 mt-1">{errors.name.message}</p>
          )}
        </Field>

      {/* RUT */}
      <Field>
        <Label>RUT *</Label>
        <Input
          {...register('rut', {
            onChange: (e) => {
              const value = e.target.value
              const formatted = formatRUT(value)
              setValue('rut', formatted)
              return formatted
            }
          })}
          placeholder="12345678-9"
          disabled={isPending}
          invalid={!!errors.rut}
        />
        {errors.rut && (
          <p className="text-sm text-red-600 mt-1">{errors.rut.message}</p>
        )}
      </Field>        {/* Email */}
        <Field>
          <Label>Correo Electrónico *</Label>
          <Input
            type="email"
            {...register('email')}
            placeholder="usuario@ejemplo.com"
            disabled={isPending}
            invalid={!!errors.email}
          />
          {errors.email && (
            <p className="text-sm text-red-600 mt-1">{errors.email.message}</p>
          )}
        </Field>

      {/* Teléfono */}
      <Field>
        <Label>Teléfono</Label>
        <Controller
          name="phone"
          control={control}
          render={({ field: { onChange, value, ...fieldProps } }) => {
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
                disabled={isPending}
              />
            )
          }}
        />
        {errors.phone && (
          <p className="text-sm text-red-600 mt-1">{errors.phone.message}</p>
        )}
      </Field>        {/* Edad */}
        <Field>
          <Label>Edad</Label>
          <Input
            type="number"
            {...register('age', { valueAsNumber: true })}
            placeholder="25"
            disabled={isPending}
            invalid={!!errors.age}
          />
          {errors.age && (
            <p className="text-sm text-red-600 mt-1">{errors.age.message}</p>
          )}
        </Field>
      </div>

      {/* Roles y Familia */}
      <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Asignaciones</h3>
        
        {/* Roles */}
        <Field>
          <Label>Roles *</Label>
          <Controller
            control={control}
            name="roleIds"
            render={({ field }) => (
              <MultiSelectCombobox
                options={roles}
                selectedIds={Array.isArray(field.value) ? field.value : []}
                onChange={(ids) => field.onChange(ids)}
                displayValue={(r: Role | null) => (r ? r.name : '')}
                getId={(r: Role) => r.id}
                placeholder="Buscar y seleccionar roles"
              />
            )}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Selecciona uno o más roles para el usuario
          </p>
          {errors.roleIds && (
            <p className="text-sm text-red-600 mt-1">{errors.roleIds.message}</p>
          )}
        </Field>

        {/* Familia */}
        <Field>
          <Label>Familia (opcional)</Label>
          <Select
            {...register('familyId')}
            disabled={isPending}
          >
            <option value="">Sin familia</option>
            {families.map((family) => (
              <option key={family.id} value={family.id}>
                {family.name}
              </option>
            ))}
          </Select>
          {errors.familyId && (
            <p className="text-sm text-red-600 mt-1">{errors.familyId.message}</p>
          )}
        </Field>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 justify-end pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <Button plain onClick={onSuccess} disabled={isPending}>
          Cancelar
        </Button>
        <Button type="submit" color="indigo" disabled={isPending}>
          {isPending ? 'Guardando...' : isEditing ? 'Actualizar Usuario' : 'Crear Usuario'}
        </Button>
      </div>
    </form>
  )
}
