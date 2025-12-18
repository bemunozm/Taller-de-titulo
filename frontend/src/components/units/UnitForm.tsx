import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { createUnit, updateUnit } from '@/api/UnitAPI'
import { type CreateUnitFormData, type Unit } from '@/types/index'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field, Label } from '@/components/ui/Fieldset'
import { Switch } from '@/components/ui/Switch'
import { Select } from '@/components/ui/Select'

interface UnitFormProps {
  unit?: Unit
  onSuccess?: () => void
}

const UNIT_TYPES = [
  { value: 'Departamento', label: 'Departamento' },
  { value: 'Casa', label: 'Casa' },
  { value: 'Local Comercial', label: 'Local Comercial' },
  { value: 'Bodega', label: 'Bodega' },
  { value: 'Estacionamiento', label: 'Estacionamiento' },
  { value: 'Oficina', label: 'Oficina' },
]

export function UnitForm({ unit, onSuccess }: UnitFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!unit

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<CreateUnitFormData>({
    defaultValues: {
      block: unit?.block || undefined,
      number: unit?.number || '',
      floor: unit?.floor || undefined,
      type: unit?.type || undefined,
      active: unit?.active ?? true,
    },
  })

  const active = watch('active')

  const createMutation = useMutation({
    mutationFn: createUnit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] })
      queryClient.invalidateQueries({ queryKey: ['availableUnits'] })
      queryClient.invalidateQueries({ queryKey: ['unitStats'] })
      toast.success('Unidad creada exitosamente')
      onSuccess?.()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al crear la unidad')
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateUnit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] })
      queryClient.invalidateQueries({ queryKey: ['availableUnits'] })
      queryClient.invalidateQueries({ queryKey: ['unitStats'] })
      queryClient.invalidateQueries({ queryKey: ['unit', unit?.id] })
      toast.success('Unidad actualizada exitosamente')
      onSuccess?.()
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar la unidad')
    },
  })

  const onSubmit = (data: CreateUnitFormData) => {
    // Convertir strings vacíos y valores inválidos a undefined
    const formData = {
      ...data,
      block: data.block && data.block.trim() !== '' ? data.block : undefined,
      type: data.type && data.type.trim() !== '' ? data.type : undefined,
      floor: data.floor !== undefined && data.floor !== null && !isNaN(data.floor) ? data.floor : undefined,
    }

    if (isEditing) {
      updateMutation.mutate({ id: unit.id, formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field>
          <Label>Bloque (Opcional)</Label>
          <Input
            {...register('block')}
            placeholder="Ej: A, B, Torre 1"
            invalid={!!errors.block}
            maxLength={16}
          />
          {errors.block && (
            <p className="text-sm text-red-600 mt-1">{errors.block.message}</p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Deja vacío si no aplica
          </p>
        </Field>

        <Field>
          <Label>Número *</Label>
          <Input
            {...register('number')}
            placeholder="Ej: 303, 5, 101"
            invalid={!!errors.number}
            maxLength={16}
          />
          {errors.number && (
            <p className="text-sm text-red-600 mt-1">{errors.number.message}</p>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field>
          <Label>Piso (Opcional)</Label>
          <Input
            type="number"
            {...register('floor', { valueAsNumber: true })}
            placeholder="Ej: 3, 10, -1"
            invalid={!!errors.floor}
          />
          {errors.floor && (
            <p className="text-sm text-red-600 mt-1">{errors.floor.message}</p>
          )}
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Usa números negativos para subterráneos
          </p>
        </Field>

        <Field>
          <Label>Tipo de Unidad</Label>
          <Select
            {...register('type')}
            invalid={!!errors.type}
          >
            <option value="">Selecciona un tipo</option>
            {UNIT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </Select>
          {errors.type && (
            <p className="text-sm text-red-600 mt-1">{errors.type.message}</p>
          )}
        </Field>
      </div>

      {isEditing && (
        <div className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
            Identificador generado:
          </div>
          <div className="text-lg font-mono font-semibold text-zinc-900 dark:text-zinc-100">
            {unit.identifier}
          </div>
        </div>
      )}

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
              {active ? 'La unidad está activa' : 'La unidad está inactiva'}
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
          {isLoading ? 'Guardando...' : isEditing ? 'Actualizar Unidad' : 'Crear Unidad'}
        </Button>
      </div>
    </form>
  )
}
