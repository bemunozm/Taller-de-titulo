import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { createFamily, updateFamily } from '@/api/FamilyAPI'
import { getAvailableUnits } from '@/api/UnitAPI'
import { createFamilySchema, type CreateFamilyFormData, type Family } from '@/types/index'
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

  // Obtener unidades disponibles
  const { data: availableUnits = [], isLoading: isLoadingUnits } = useQuery({
    queryKey: ['availableUnits'],
    queryFn: getAvailableUnits,
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<CreateFamilyFormData>({
    resolver: zodResolver(createFamilySchema),
    defaultValues: {
      name: family?.name || '',
      description: family?.description || '',
      unitId: family?.unit?.id || undefined,
      active: family?.active ?? true,
    },
  })

  const active = watch('active')

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
    if (isEditing) {
      updateMutation.mutate({ id: family.id, formData: data })
    } else {
      createMutation.mutate(data)
    }
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
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
          disabled={isLoadingUnits}
        >
          <option value="">Sin unidad asignada</option>
          {isEditing && family?.unit && !availableUnits.find(u => u.id === family.unit?.id) && (
            <option value={family.unit.id}>
              {family.unit.identifier} (Actual)
            </option>
          )}
          {availableUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.identifier}
              {unit.type && ` - ${unit.type}`}
              {unit.floor !== null && ` (Piso ${unit.floor})`}
            </option>
          ))}
        </Select>
        {errors.unitId && (
          <p className="text-sm text-red-600 mt-1">{errors.unitId.message}</p>
        )}
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          Solo se muestran unidades disponibles sin familia activa asignada
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
