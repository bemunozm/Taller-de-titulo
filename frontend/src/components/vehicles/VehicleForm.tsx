import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { useEffect } from 'react'
import { createVehicle, updateVehicle } from '@/api/VehicleAPI'
import { getUsers } from '@/api/AuthAPI'
import { createVehicleSchema, type CreateVehicleFormData, type Vehicle } from '@/types/index'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field, Label } from '@/components/ui/Fieldset'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'

interface VehicleFormProps {
  vehicle?: Vehicle
  onSuccess?: () => void
}

export function VehicleForm({ vehicle, onSuccess }: VehicleFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!vehicle

  // Backend filtra automáticamente por rol (admin ve todos, residente solo el suyo)
  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    reset,
  } = useForm<CreateVehicleFormData>({
    resolver: zodResolver(createVehicleSchema),
    defaultValues: {
      plate: '',
      brand: '',
      model: '',
      color: '',
      year: undefined,
      vehicleType: '',
      accessLevel: '',
      ownerId: '',
      active: true,
    },
  })

  // Cargar datos del vehículo cuando cambia o cuando los usuarios se cargan
  useEffect(() => {
    if (vehicle && !isLoadingUsers) {
      console.log('Loading vehicle data into form:', vehicle);
      console.log('Owner ID:', vehicle.owner?.id);
      
      reset({
        plate: vehicle.plate || '',
        brand: vehicle.brand || '',
        model: vehicle.model || '',
        color: vehicle.color || '',
        year: vehicle.year || undefined,
        vehicleType: vehicle.vehicleType || '',
        accessLevel: vehicle.accessLevel || '',
        ownerId: vehicle.owner?.id || '',
        active: vehicle.active ?? true,
      });
    }
  }, [vehicle, isLoadingUsers, reset]);

  const active = watch('active')

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
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const onSubmit = (data: CreateVehicleFormData) => {
    console.log('=== FORM SUBMIT ===');
    console.log('Data from form:', data);
    console.log('Is editing:', isEditing);
    
    // Convertir string vacío a undefined para ownerId
    const cleanedData = {
      ...data,
      ownerId: data.ownerId === '' ? undefined : data.ownerId,
    };
    
    console.log('Cleaned data:', cleanedData);
    
    if (isEditing) {
      console.log('Updating vehicle with ID:', vehicle.id);
      updateMutation.mutate({ id: vehicle.id, formData: cleanedData })
    } else {
      console.log('Creating new vehicle');
      createMutation.mutate(cleanedData)
    }
  }

  const isLoading = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field>
          <Label>Patente *</Label>
          <Input
            {...register('plate')}
            placeholder="ABC123"
            invalid={!!errors.plate}
            className="uppercase"
          />
          {errors.plate && <p className="text-sm text-red-600 mt-1">{errors.plate.message}</p>}
        </Field>

        <Field>
          <Label>Propietario</Label>
          <Select {...register('ownerId')}>
            <option value="">Sin propietario</option>
            {users.map((user: any) => (
              <option key={user.id} value={user.id}>
                {user.name}
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
          <Input {...register('year', { valueAsNumber: true })} type="number" placeholder="2024" />
        </Field>

        <Field>
          <Label>Tipo de Vehículo</Label>
          <Select {...register('vehicleType')}>
            <option value="">Seleccionar</option>
            <option value="auto">Auto</option>
            <option value="camioneta">Camioneta</option>
            <option value="moto">Moto</option>
            <option value="camion">Camión</option>
          </Select>
        </Field>

        <Field>
          <Label>Nivel de Acceso</Label>
          <Select {...register('accessLevel')}>
            <option value="">Seleccionar</option>
            <option value="residente">Residente</option>
            <option value="visitante">Visitante</option>
            <option value="servicio">Servicio</option>
          </Select>
        </Field>
      </div>

      <Field>
        <div className="flex items-center gap-3">
          <Switch checked={active} onChange={(checked) => setValue('active', checked)} color="lime" />
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
