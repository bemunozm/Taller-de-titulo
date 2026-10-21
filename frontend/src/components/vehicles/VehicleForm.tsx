import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { createVehicle, updateVehicle } from '@/api/VehicleAPI'
import {
  createVehicleSchema,
  type CreateVehicleFormData,
  type Vehicle,
  type VehicleFormValues,
} from '@/types/index'
import {
  ACCESS_LEVEL_OPTIONS,
  VEHICLE_TYPE_OPTIONS,
  PLATE_LOCKED_HINT,
  VEHICLE_ESCALATION_FORBIDDEN_MESSAGE,
  getAccessLevelGateBehavior,
  isVehicleEscalation,
  toAccessLevelFieldValue,
  toVehiclePayload,
  toVehicleTypeFieldValue,
} from '@/helpers/vehicleAccess'
import { formatUserOptionLabel, useUserOptions, withAssignedUser } from '@/hooks/useUserOptions'
import { useCondominiumScope } from '@/hooks/useCondominiumScope'
import { usePermissions } from '@/hooks/usePermissions'
import { getApiErrorStatus } from '@/helpers/httpErrors'
import { CONDOMINIUM_REQUIRED_MESSAGE, scopeCreatePayload } from '@/helpers/condominium'
import { CondominiumSelect } from '@/components/condominiums/CondominiumSelect'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Description, Field, Label } from '@/components/ui/Fieldset'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'

interface VehicleFormProps {
  vehicle?: Vehicle
  onSuccess?: () => void
}

function toFormValues(vehicle: Vehicle | undefined): VehicleFormValues {
  return {
    plate: vehicle?.plate ?? '',
    brand: vehicle?.brand ?? '',
    model: vehicle?.model ?? '',
    color: vehicle?.color ?? '',
    year: vehicle?.year ?? undefined,
    vehicleType: toVehicleTypeFieldValue(vehicle?.vehicleType),
    accessLevel: toAccessLevelFieldValue(vehicle?.accessLevel),
    ownerId: vehicle?.owner?.id ?? '',
    active: vehicle?.active ?? true,
    organizationId: '',
  }
}

// La patente se valida en mayúsculas: se normaliza al escribirla.
function toPlate(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value
}

// Un <input type="number"> vacío llega como '' (con valueAsNumber sería NaN y
// zod lo rechazaría aunque el año es opcional).
function toOptionalYear(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const year = Number(value)
  return Number.isNaN(year) ? undefined : year
}

export function VehicleForm({ vehicle, onSuccess }: VehicleFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!vehicle

  // Super-admin creando: elige el condominio (obligatorio); nadie más lo envía.
  const { chooseCondominium, isSuperAdmin } = useCondominiumScope(isEditing)
  // Quitar el propietario (`ownerId: null`) y cambiar la patente al editar son
  // solo de quien ve todo el condominio (el Residente → 403).
  const { hasPermission } = usePermissions()
  const canViewWholeCondominium = isSuperAdmin || hasPermission('condominium.view-all')
  const plateLocked = isEditing && !canViewWholeCondominium

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    setError,
  } = useForm<VehicleFormValues, unknown, CreateVehicleFormData>({
    resolver: zodResolver(createVehicleSchema),
    // VehiclesView monta el formulario con `key` por vehículo: basta el valor inicial.
    defaultValues: toFormValues(vehicle),
  })

  const active = watch('active')
  const accessLevel = watch('accessLevel')
  const selectedOrganizationId = watch('organizationId')

  // Con users.read: GET /users (proyección mínima `{ id, name, family }` sin
  // users.update); sin ese permiso (Residente), solo el propio usuario. El
  // super-admin ve a toda la plataforma: solo se ofrecen los usuarios cuya
  // familia es del condominio elegido (un dueño ajeno sería un 403).
  const { options: userOptions } = useUserOptions()
  const scopedUserOptions = chooseCondominium
    ? userOptions.filter(
        (option) => !!selectedOrganizationId && option.family?.organizationId === selectedOrganizationId,
      )
    : userOptions
  const ownerOptions = withAssignedUser(scopedUserOptions, vehicle?.owner)

  const createMutation = useMutation({
    mutationFn: createVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success('Vehículo creado exitosamente')
      onSuccess?.()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      toast.success('Vehículo actualizado exitosamente')
      onSuccess?.()
    },
    onError: (error: Error, variables) => {
      // Un residente no puede reactivar su vehículo ni subirle el acceso (403).
      if (vehicle && getApiErrorStatus(error) === 403 && isVehicleEscalation(vehicle, variables.formData)) {
        toast.error(VEHICLE_ESCALATION_FORBIDDEN_MESSAGE)
        return
      }
      toast.error(error.message)
    },
  })

  const onSubmit = (data: CreateVehicleFormData) => {
    if (vehicle) {
      updateMutation.mutate({
        id: vehicle.id,
        formData: toVehiclePayload(data, 'update', {
          allowOwnerRemoval: canViewWholeCondominium,
          omitPlate: plateLocked,
        }),
      })
      return
    }
    if (chooseCondominium && !data.organizationId) {
      setError('organizationId', { type: 'required', message: CONDOMINIUM_REQUIRED_MESSAGE })
      return
    }
    createMutation.mutate(
      scopeCreatePayload({ ...toVehiclePayload(data, 'create'), organizationId: data.organizationId }, chooseCondominium),
    )
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {chooseCondominium && (
        <CondominiumSelect
          {...register('organizationId', {
            // El propietario elegido era del condominio anterior.
            onChange: () => setValue('ownerId', ''),
          })}
          errorMessage={errors.organizationId?.message}
          description="El vehículo queda registrado en este condominio."
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field>
          <Label>Patente *</Label>
          <Input
            {...register('plate', { setValueAs: toPlate })}
            placeholder="ABC123"
            invalid={!!errors.plate}
            className="uppercase"
            readOnly={plateLocked}
          />
          {/* Headless Field enlaza la Description al input (aria-describedby). */}
          {plateLocked && <Description>{PLATE_LOCKED_HINT}</Description>}
          {errors.plate && <p className="text-sm text-red-600 mt-1">{errors.plate.message}</p>}
        </Field>

        <Field>
          <Label>Propietario</Label>
          <Select {...register('ownerId')}>
            <option value="">Sin propietario</option>
            {ownerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {formatUserOptionLabel(option)}
              </option>
            ))}
          </Select>
        </Field>

        <Field>
          <Label>Marca</Label>
          <Input {...register('brand')} placeholder="Toyota" />
        </Field>

        <Field>
          <Label>Modelo</Label>
          <Input {...register('model')} placeholder="Corolla" />
        </Field>

        <Field>
          <Label>Color</Label>
          <Input {...register('color')} placeholder="Blanco" />
        </Field>

        <Field>
          <Label>Año</Label>
          <Input
            {...register('year', { setValueAs: toOptionalYear })}
            type="number"
            placeholder="2024"
            invalid={!!errors.year}
          />
          {errors.year && <p className="text-sm text-red-600 mt-1">Ingresa un año válido</p>}
        </Field>

        <Field>
          <Label>Tipo de vehículo</Label>
          <Select {...register('vehicleType')} invalid={!!errors.vehicleType}>
            <option value="">Sin especificar</option>
            {VEHICLE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Description>Solo describe la carrocería; no decide el acceso.</Description>
        </Field>

        <Field>
          <Label>Nivel de acceso</Label>
          <Select {...register('accessLevel')} invalid={!!errors.accessLevel}>
            <option value="">Sin nivel</option>
            {ACCESS_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Description aria-live="polite">{getAccessLevelGateBehavior(accessLevel)}</Description>
        </Field>
      </div>

      <Field>
        <div className="flex items-center gap-3">
          <Switch checked={!!active} onChange={(checked) => setValue('active', checked)} color="lime" />
          <Label>{active ? 'Vehículo activo' : 'Vehículo inactivo'}</Label>
        </div>
      </Field>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="submit" color="indigo" disabled={isLoading}>
          {isLoading ? 'Guardando...' : isEditing ? 'Actualizar' : 'Crear Vehículo'}
        </Button>
      </div>
    </form>
  )
}
