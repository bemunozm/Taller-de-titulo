import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { createFamily, updateFamily } from '@/api/FamilyAPI'
import { getAvailableUnits } from '@/api/UnitAPI'
import { usePermissions } from '@/hooks/usePermissions'
import { useCondominiumScope } from '@/hooks/useCondominiumScope'
import { CONDOMINIUM_REQUIRED_MESSAGE, filterByOrganization, scopeCreatePayload } from '@/helpers/condominium'
import { CondominiumSelect } from '@/components/condominiums/CondominiumSelect'
import {
  createFamilySchema,
  type CreateFamilyFormData,
  type CreateFamilyPayload,
  type Family,
  type UpdateFamilyFormData,
} from '@/types/index'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/TextArea'
import { Field, Label } from '@/components/ui/Fieldset'
import { Switch } from '@/components/ui/Switch'
import { Select } from '@/components/ui/Select'

interface FamilyFormProps {
  family?: Family
  onSuccess?: () => void
}

export function FamilyForm({ family, onSuccess }: FamilyFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!family

  // Unidades disponibles: `GET /units/available` exige units.view-available;
  // sin él no se pide (sería un 403) y solo queda la unidad actual.
  const { hasPermission } = usePermissions()
  const canViewAvailableUnits = hasPermission('units.view-available')
  // El Conserje Digital (IA del citófono) se activa al editar y con families.update.
  const canToggleDigitalConcierge = isEditing && hasPermission('families.update')
  const { data: availableUnits = [], isLoading: isLoadingUnits } = useQuery({
    queryKey: ['availableUnits'],
    queryFn: getAvailableUnits,
    enabled: canViewAvailableUnits,
  })

  // Super-admin creando: elige el condominio (obligatorio); nadie más lo envía.
  const { chooseCondominium, isSuperAdmin } = useCondominiumScope(isEditing)

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    setError,
  } = useForm<CreateFamilyFormData>({
    resolver: zodResolver(createFamilySchema),
    defaultValues: {
      name: family?.name || '',
      description: family?.description || '',
      unitId: family?.unit?.id || '',
      active: family?.active ?? true,
      organizationId: '',
      digitalConciergeEnabled: family?.digitalConciergeEnabled ?? false,
    },
  })

  const active = watch('active')
  const digitalConciergeEnabled = watch('digitalConciergeEnabled')
  const selectedOrganizationId = watch('organizationId')

  // El super-admin recibe las unidades de toda la plataforma: solo se ofrecen
  // las del condominio de la familia (el elegido al crear, el suyo al editar).
  const unitOptions = isSuperAdmin
    ? filterByOrganization(availableUnits, chooseCondominium ? selectedOrganizationId : family?.organizationId)
    : availableUnits

  const createMutation = useMutation({
    mutationFn: createFamily,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['families'] })
      toast.success('Familia creada exitosamente')
      onSuccess?.()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear la familia')
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateFamily,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['families'] })
      queryClient.invalidateQueries({ queryKey: ['family', family?.id] })
      toast.success('Familia actualizada exitosamente')
      onSuccess?.()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar la familia')
    },
  })

  const onSubmit = (data: CreateFamilyFormData) => {
    // '' = "Sin unidad asignada": el backend espera un UUID o nada.
    const base: CreateFamilyPayload = {
      name: data.name,
      description: data.description,
      unitId: data.unitId || undefined,
      active: data.active,
    }

    if (isEditing) {
      // `organizationId` nunca viaja en una edición.
      const formData: UpdateFamilyFormData = { ...base }
      if (canToggleDigitalConcierge) {
        formData.digitalConciergeEnabled = !!data.digitalConciergeEnabled
      }
      updateMutation.mutate({ id: family.id, formData })
      return
    }
    if (chooseCondominium && !data.organizationId) {
      setError('organizationId', { type: 'required', message: CONDOMINIUM_REQUIRED_MESSAGE })
      return
    }
    createMutation.mutate(scopeCreatePayload({ ...base, organizationId: data.organizationId }, chooseCondominium))
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {chooseCondominium && (
        <CondominiumSelect
          {...register('organizationId', {
            // La unidad elegida era del condominio anterior.
            onChange: () => setValue('unitId', ''),
          })}
          errorMessage={errors.organizationId?.message}
          description="La familia se crea en este condominio."
        />
      )}

      <Field>
        <Label>Nombre de la Familia *</Label>
        <Input
          {...register('name')}
          placeholder="Ej: Familia González"
          invalid={!!errors.name}
        />
        {errors.name && (
          <p className="text-sm text-red-600 mt-1">{errors.name.message}</p>
        )}
      </Field>

      <Field>
        <Label>Unidad / Departamento</Label>
        <Select
          {...register('unitId')}
          invalid={!!errors.unitId}
          disabled={canViewAvailableUnits && isLoadingUnits}
        >
          <option value="">Sin unidad asignada</option>
          {isEditing && family?.unit && !unitOptions.find(u => u.id === family.unit?.id) && (
            <option value={family.unit.id}>
              {family.unit.identifier} (Actual)
            </option>
          )}
          {unitOptions.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.identifier}
              {unit.type && ` - ${unit.type}`}
              {unit.floor !== null && unit.floor !== undefined && ` (Piso ${unit.floor})`}
            </option>
          ))}
        </Select>
        {errors.unitId && (
          <p className="text-sm text-red-600 mt-1">{errors.unitId.message}</p>
        )}
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          {canViewAvailableUnits
            ? 'Solo se muestran unidades disponibles sin familia activa asignada'
            : 'No tienes permiso para ver las unidades disponibles; se conserva la unidad actual'}
        </p>
      </Field>

      <Field>
        <Label>Descripción</Label>
        <Textarea
          {...register('description')}
          placeholder="Información adicional sobre la familia"
          rows={3}
          invalid={!!errors.description}
        />
        {errors.description && (
          <p className="text-sm text-red-600 mt-1">{errors.description.message}</p>
        )}
      </Field>

      <Field>
        <div className="flex items-center gap-3">
          <Switch
            checked={active}
            onChange={(checked) => setValue('active', checked)}
            color="lime"
          />
          <div>
            <Label>Estado Activo</Label>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {active ? 'La familia está activa' : 'La familia está inactiva'}
            </p>
          </div>
        </div>
      </Field>

      {canToggleDigitalConcierge && (
        <Field>
          <div className="flex items-center gap-3">
            <Switch
              checked={!!digitalConciergeEnabled}
              onChange={(checked) => setValue('digitalConciergeEnabled', checked)}
              color="lime"
            />
            <div>
              <Label>Conserje digital (IA en el citófono)</Label>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {digitalConciergeEnabled
                  ? 'El citófono atiende a las visitas de esta familia con IA'
                  : 'Las visitas de esta familia no pasan por el conserje digital'}
              </p>
            </div>
          </div>
        </Field>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <Button
          type="submit"
          color="indigo"
          disabled={isLoading}
        >
          {isLoading ? 'Guardando...' : isEditing ? 'Actualizar Familia' : 'Crear Familia'}
        </Button>
      </div>
    </form>
  )
}
