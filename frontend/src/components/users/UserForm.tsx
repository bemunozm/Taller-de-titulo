import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { createUser, updateUser } from '@/api/UserAPI'
import { listRoles } from '@/api/RoleAPI'
import { getFamilies } from '@/api/FamilyAPI'
import type {
  CreateUserByAdminPayload,
  Family,
  Role,
  UserAdminFormData,
  UserUpdateData,
  UserWithFamily,
} from '@/types/index'
import { userAdminFormSchema } from '@/types/index'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PhoneTextInput } from '@/components/ui/PhoneTextInput'
import { Field, Label } from '@/components/ui/Fieldset'
import { CondominiumSelect } from '@/components/condominiums/CondominiumSelect'
import { Select } from '@/components/ui/Select'
import { formatRUT } from '@/helpers/index'
import { getAssignableRoles, includesSuperAdminRole } from '@/helpers/roles'
import { filterByOrganization } from '@/helpers/condominium'
import { getDuplicateUserFieldsFromError } from '@/helpers/userDisplay'
import { useCondominiumScope } from '@/hooks/useCondominiumScope'
import { usePermissions } from '@/hooks/usePermissions'
import { Badge } from '@/components/ui/Badge'
import MultiSelectCombobox from '@/components/ui/MultiSelectCombobox'

interface UserFormProps {
  user?: UserWithFamily
  onSuccess: () => void
}

const EMPTY_VALUES: UserAdminFormData = {
  name: '',
  email: '',
  rut: '',
  phone: '',
  age: undefined,
  roleIds: [],
  familyId: '',
  organizationId: '',
}

const NO_FAMILIES: Family[] = []
const NO_ROLES: Role[] = []

function sameIds(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

// Un <input type="number"> vacío llega como '': la edad es opcional (con
// valueAsNumber sería NaN y zod la rechazaría).
function toOptionalAge(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const age = Number(value)
  return Number.isNaN(age) ? undefined : age
}

export function UserForm({ user, onSuccess }: UserFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!user
  // Solo el super-admin elige el condominio, y solo al crear: el backend
  // responde 403 si otro actor envía `organizationId`.
  const { chooseCondominium: showCondominium } = useCondominiumScope(isEditing)
  const { isSuperAdmin, userPermissions, user: currentUser } = usePermissions()

  // Queries para roles y familias (los condominios los pide CondominiumSelect)
  const { data: roles = NO_ROLES } = useQuery({
    queryKey: ['roles'],
    queryFn: listRoles,
  })

  // Solo los roles que el actor puede asignar (RoleAssignmentPolicy): el
  // super-admin, todos; el resto, subconjuntos de sus permisos y nunca
  // "Super Administrador". Al editar se conservan visibles los que ya tiene.
  const initialRoleIds = user?.roles?.map((role) => role.id) ?? []
  const assignableRoles = getAssignableRoles(roles, { isSuperAdmin, permissions: userPermissions ?? [] })
  const roleOptions = [
    ...assignableRoles,
    ...roles.filter(
      (role) => initialRoleIds.includes(role.id) && !assignableRoles.some((assignable) => assignable.id === role.id),
    ),
  ]
  // Fuera del super-admin nadie edita sus propios roles (403).
  const editingOwnRoles = isEditing && !isSuperAdmin && !!currentUser && currentUser.id === user.id
  // El email de otro usuario solo lo cambia el super-admin (403); el propio se
  // cambia desde el perfil. Al editar, para el resto es de solo lectura.
  const emailReadOnly = isEditing && !isSuperAdmin

  const { data: families = NO_FAMILIES, isSuccess: familiesLoaded } = useQuery({
    queryKey: ['families'],
    queryFn: getFamilies,
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    setError,
    control,
    reset,
    watch,
  } = useForm<UserAdminFormData>({
    resolver: zodResolver(userAdminFormSchema),
    defaultValues: EMPTY_VALUES,
  })

  // Actualizar valores del formulario cuando cambia el usuario o terminan de
  // cargar las familias (para que el <select> ya tenga la opción de su familia).
  // Depende de booleanos/identidades estables: un `[]` nuevo por render como
  // dependencia haría que el reset se repita sin fin.
  useEffect(() => {
    if (user && familiesLoaded) {
      reset({
        name: user.name,
        email: user.email,
        rut: user.rut ?? '',
        phone: user.phone || '',
        age: user.age ?? undefined,
        roleIds: user.roles?.map(r => r.id) || [],
        familyId: user.family?.id || '',
        organizationId: '',
      })
    } else if (!user) {
      reset(EMPTY_VALUES)
    }
  }, [user, familiesLoaded, reset])

  // Una cuenta "Super Administrador" es de plataforma: el condominio es opcional.
  const selectedRoleIds = watch('roleIds')
  const assignsSuperAdmin = includesSuperAdminRole(roles, selectedRoleIds ?? [])
  const condominiumRequired = showCondominium && !assignsSuperAdmin

  // El super-admin ve todas las familias de la plataforma: solo se ofrecen las
  // del condominio elegido (una de otro condominio sería un 403).
  const selectedOrganizationId = watch('organizationId')
  const familyOptions = showCondominium ? filterByOrganization(families, selectedOrganizationId) : families

  // 409: email, RUT o teléfono ya usados. El backend indica `field`; si no,
  // se deduce del mensaje. El campo se marca en el formulario.
  function handleSaveError(error: Error, fallback: string) {
    for (const field of getDuplicateUserFieldsFromError(error)) {
      setError(field, { type: 'duplicate', message: error.message })
    }
    toast.error(error.message || fallback)
  }

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Usuario creado exitosamente. Se envió un email con las instrucciones.')
      onSuccess()
    },
    onError: (error: Error) => handleSaveError(error, 'Error al crear el usuario'),
  })

  const updateMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('Usuario actualizado exitosamente')
      onSuccess()
    },
    onError: (error: Error) => handleSaveError(error, 'Error al actualizar el usuario'),
  })

  const onSubmit = (data: UserAdminFormData) => {
    if (data.roleIds.length === 0) {
      toast.error('Debe seleccionar al menos un rol')
      return
    }

    if (condominiumRequired && !data.organizationId) {
      setError('organizationId', { type: 'required', message: 'Selecciona el condominio del usuario' })
      return
    }

    if (isEditing) {
      const formData: UserUpdateData = {
        name: data.name,
        rut: data.rut,
        phone: data.phone || undefined,
        age: data.age,
        familyId: data.familyId || undefined,
      }
      // El email solo viaja si lo cambia el super-admin (para otro actor → 403).
      if (!emailReadOnly && data.email !== user.email) {
        formData.email = data.email
      }
      // Los roles solo viajan si cambiaron: reenviar uno que el actor no puede
      // asignar (o los propios) sería un 403 aunque no se toquen.
      if (!editingOwnRoles && !sameIds(data.roleIds, initialRoleIds)) {
        formData.roleIds = data.roleIds
      }
      updateMutation.mutate({ id: user.id, formData })
      return
    }

    const payload: CreateUserByAdminPayload = {
      name: data.name,
      email: data.email,
      rut: data.rut,
      roleIds: data.roleIds,
    }
    if (data.phone) payload.phone = data.phone
    if (data.age !== undefined) payload.age = data.age
    if (data.familyId) payload.familyId = data.familyId
    // Nunca se envía si no es super-admin (sería un 403).
    if (showCondominium && data.organizationId) payload.organizationId = data.organizationId

    createMutation.mutate(payload)
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
                const formatted = formatRUT(e.target.value)
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
        </Field>

        {/* Email */}
        <Field>
          <Label>Correo Electrónico *</Label>
          <Input
            type="email"
            {...register('email')}
            placeholder="usuario@ejemplo.com"
            disabled={isPending}
            readOnly={emailReadOnly}
            invalid={!!errors.email}
          />
          {emailReadOnly && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Solo el Super Administrador puede cambiar el correo desde aquí.
            </p>
          )}
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
            render={({ field: { onChange, value, ...fieldProps } }) => (
              <PhoneInput
                {...fieldProps}
                value={value}
                onChange={onChange}
                defaultCountry="CL"
                placeholder="Ingrese su número de teléfono"
                international={true}
                withCountryCallingCode={true}
                countryCallingCodeEditable={false}
                inputComponent={PhoneTextInput}
                invalid={!!errors.phone}
                disabled={isPending}
              />
            )}
          />
          {errors.phone && (
            <p className="text-sm text-red-600 mt-1">{errors.phone.message}</p>
          )}
        </Field>

        {/* Edad */}
        <Field>
          <Label>Edad</Label>
          <Input
            type="number"
            {...register('age', { setValueAs: toOptionalAge })}
            placeholder="25"
            disabled={isPending}
            invalid={!!errors.age}
          />
          {errors.age && (
            <p className="text-sm text-red-600 mt-1">{errors.age.message}</p>
          )}
        </Field>
      </div>

      {/* Roles, condominio y familia */}
      <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Asignaciones</h3>

        {/* Roles */}
        <Field>
          <Label>Roles *</Label>
          {editingOwnRoles ? (
            <>
              <div className="flex flex-wrap gap-1 mt-1">
                {(user?.roles ?? []).map((role) => (
                  <Badge key={role.id} color="sky">{role.name}</Badge>
                ))}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                No puedes cambiar tus propios roles; pídeselo a otro administrador.
              </p>
            </>
          ) : (
            <>
              <Controller
                control={control}
                name="roleIds"
                render={({ field }) => (
                  <MultiSelectCombobox
                    options={roleOptions}
                    selectedIds={Array.isArray(field.value) ? field.value : []}
                    onChange={(ids) => field.onChange(ids)}
                    displayValue={(r: Role | null) => (r ? r.name : '')}
                    getId={(r: Role) => r.id}
                    placeholder="Buscar y seleccionar roles"
                  />
                )}
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Selecciona uno o más roles. Solo aparecen los que puedes asignar.
              </p>
            </>
          )}
          {errors.roleIds && (
            <p className="text-sm text-red-600 mt-1">{errors.roleIds.message}</p>
          )}
        </Field>

        {/* Condominio (solo super-admin al crear) */}
        {showCondominium && (
          <CondominiumSelect
            {...register('organizationId', {
              // La familia elegida era del condominio anterior.
              onChange: () => setValue('familyId', ''),
            })}
            label={condominiumRequired ? 'Condominio *' : 'Condominio (opcional)'}
            disabled={isPending}
            errorMessage={errors.organizationId?.message}
            description={
              assignsSuperAdmin
                ? 'Una cuenta Super Administrador es de plataforma: el condominio es opcional.'
                : 'El usuario queda como miembro de este condominio.'
            }
          />
        )}

        {/* Familia */}
        <Field>
          <Label>Familia (opcional)</Label>
          <Select
            {...register('familyId')}
            disabled={isPending}
          >
            <option value="">
              {showCondominium && !selectedOrganizationId ? 'Elige primero un condominio' : 'Sin familia'}
            </option>
            {familyOptions.map((family) => (
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
