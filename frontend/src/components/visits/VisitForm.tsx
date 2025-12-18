import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import React from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { createVisit, updateVisit } from '@/api/VisitAPI'
import { getUsers } from '@/api/AuthAPI'
import { createVisitSchema, type Visit, type User } from '@/types/index'
import { formatRUT, isValidChileanId } from '@/helpers/index'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field, FieldGroup, Label } from '@/components/ui/Fieldset'
import { Radio, RadioField, RadioGroup } from '@/components/ui/Radio'

interface VisitFormProps {
  visit?: Visit
  onSuccess: (createdVisit?: Visit) => void
}

export function VisitForm({ visit, onSuccess }: VisitFormProps) {
  const queryClient = useQueryClient()
  const isEditing = !!visit

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createVisitSchema),
    defaultValues: visit
      ? {
          type: visit.type,
          visitorName: visit.visitorName,
          visitorRut: visit.visitorRut || '',
          visitorPhone: visit.visitorPhone || '',
          reason: visit.reason || '',
          validFrom: visit.validFrom ? new Date(visit.validFrom).toISOString().slice(0, 16) : '',
          validUntil: visit.validUntil ? new Date(visit.validUntil).toISOString().slice(0, 16) : '',
          hostId: visit.host?.id || '',
          maxUses: visit.maxUses || undefined,
          vehiclePlate: visit.vehicle?.plate || '',
          vehicleBrand: visit.vehicle?.brand || '',
          vehicleModel: visit.vehicle?.model || '',
          vehicleColor: visit.vehicle?.color || '',
        }
      : {
          type: 'pedestrian',
          visitorName: '',
          visitorRut: '',
          visitorPhone: '',
          reason: '',
          validFrom: '',
          validUntil: '',
          hostId: '',
          maxUses: undefined,
          vehiclePlate: '',
          vehicleBrand: '',
          vehicleModel: '',
          vehicleColor: '',
        },
  })

  const visitType = watch('type')

  // Query para usuarios (anfitriones)
  // Backend filtra automáticamente: Admin ve todos, Residente solo se ve a sí mismo
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const createMutation = useMutation({
    mutationFn: createVisit,
    onSuccess: (data) => {
      console.log('Visita creada exitosamente:', data)
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('Visita creada exitosamente')
      onSuccess(data)
    },
    onError: (error: Error) => {
      console.error('Error al crear visita:', error)
      toast.error(error.message || 'Error al crear la visita')
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateVisit,
    onSuccess: () => {
      console.log('Visita actualizada exitosamente')
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('Visita actualizada exitosamente')
      onSuccess()
    },
    onError: (error: Error) => {
      console.error('Error al actualizar visita:', error)
      toast.error(error.message || 'Error al actualizar la visita')
    },
  })

  const onSubmit = (data: any) => {
    console.log('onSubmit llamado con data:', data)
    console.log('Errores actuales:', errors)
    
    // Limpiar datos antes de enviar
    const cleanData = {
      ...data,
      // Convertir fechas de datetime-local a ISO 8601
      validFrom: data.validFrom ? new Date(data.validFrom).toISOString() : undefined,
      validUntil: data.validUntil ? new Date(data.validUntil).toISOString() : undefined,
      entryTime: data.entryTime ? new Date(data.entryTime).toISOString() : undefined,
      exitTime: data.exitTime ? new Date(data.exitTime).toISOString() : undefined,
      // Asegurar que campos opcionales vacíos sean undefined
      visitorRut: data.visitorRut?.trim() === '' ? undefined : data.visitorRut,
      visitorPhone: data.visitorPhone?.trim() === '' ? undefined : data.visitorPhone,
      reason: data.reason?.trim() === '' ? undefined : data.reason,
      // Para visitas peatonales, asegurar que campos de vehículo sean undefined
      vehiclePlate: data.type === 'pedestrian' ? undefined : data.vehiclePlate,
      vehicleBrand: data.type === 'pedestrian' ? undefined : data.vehicleBrand,
      vehicleModel: data.type === 'pedestrian' ? undefined : data.vehicleModel,
      vehicleColor: data.type === 'pedestrian' ? undefined : data.vehicleColor,
    }

    console.log('Datos limpios a enviar:', cleanData)
    console.log('isEditing:', isEditing, 'isPending:', isPending)

    if (isEditing && visit) {
      console.log('Actualizando visita con ID:', visit.id)
      updateMutation.mutate({ id: visit.id, formData: cleanData })
    } else {
      console.log('Creando nueva visita')
      createMutation.mutate(cleanData)
    }
  }

  const onError = (formErrors: any) => {
    console.error('Errores de validación del formulario:', formErrors)
    toast.error('Por favor, corrija los errores del formulario')
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <form 
      onSubmit={(e) => {
        console.log('Form onSubmit event triggered')
        handleSubmit(onSubmit, onError)(e)
      }} 
      className="space-y-6" 
      noValidate
    >
      {/* Tipo de Visita */}
      <Field>
        <Label>Tipo de Visita *</Label>
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <RadioGroup value={field.value} onChange={field.onChange}>
              <RadioField>
                <Radio value="pedestrian" />
                <Label>Peatonal (con código QR)</Label>
              </RadioField>
              <RadioField>
                <Radio value="vehicular" />
                <Label>Vehicular (con patente)</Label>
              </RadioField>
            </RadioGroup>
          )}
        />
        {errors.type && (
          <p className="text-sm text-red-600 mt-1">{errors.type.message}</p>
        )}
      </Field>

      {/* Información del Visitante */}
      <FieldGroup>
        <legend className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Información del Visitante
        </legend>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field>
            <Label htmlFor="visitorName">Nombre Completo *</Label>
            <Input
              id="visitorName"
              {...register('visitorName', {
                validate: (value) => {
                  if (!value || value.trim() === '') {
                    return 'El nombre del visitante es requerido'
                  }
                  if (value.length < 2) {
                    return 'El nombre debe tener al menos 2 caracteres'
                  }
                  if (value.length > 128) {
                    return 'El nombre no puede exceder 128 caracteres'
                  }
                  return true
                }
              })}
              placeholder="Juan Pérez González"
              invalid={!!errors.visitorName}
              autoComplete="name"
            />
            {errors.visitorName && (
              <p className="text-sm text-red-600 mt-1">{errors.visitorName.message}</p>
            )}
          </Field>

          <Field>
            <Label htmlFor="visitorRut">RUT o Pasaporte</Label>
            <Input
              id="visitorRut"
              {...register('visitorRut', {
                onChange: (e) => {
                  const value = e.target.value
                  // Solo formatear si parece ser un RUT chileno
                  if (value.match(/^[\d\.\-kK]+$/)) {
                    const formatted = formatRUT(value)
                    setValue('visitorRut', formatted)
                  } else {
                    // Para pasaportes, solo convertir a mayúsculas
                    setValue('visitorRut', value.toUpperCase())
                  }
                },
                validate: (value) => {
                  if (!value || value.trim() === '') return true // Opcional
                  return isValidChileanId(value) || 'Ingrese un RUT o pasaporte válido'
                }
              })}
              placeholder="12.345.678-9 o AB123456"
              invalid={!!errors.visitorRut}
              autoComplete="off"
            />
            {errors.visitorRut && (
              <p className="text-sm text-red-600 mt-1">{errors.visitorRut.message}</p>
            )}
          </Field>

          <Field>
            <Label htmlFor="visitorPhone">Teléfono</Label>
            <Controller
              name="visitorPhone"
              control={control}
              rules={{
                validate: (value) => {
                  if (!value || value.trim() === '') return true // Opcional
                  // Validar que sea un número válido
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
                      invalid={!!errors.visitorPhone}
                    />
                  )), [errors.visitorPhone])

                return (
                  <PhoneInput
                    {...fieldProps}
                    value={value}
                    onChange={onChange}
                    defaultCountry="CL"
                    placeholder="Ingrese el número de teléfono"
                    international={true}
                    withCountryCallingCode={true}
                    countryCallingCodeEditable={false}
                    inputComponent={PhoneInputComponent}
                    className="mt-1"
                  />
                )
              }}
            />
            {errors.visitorPhone && (
              <p className="text-sm text-red-600 mt-1">{errors.visitorPhone.message}</p>
            )}
          </Field>

          <Field>
            <Label htmlFor="reason">Motivo de la Visita</Label>
            <Input
              id="reason"
              {...register('reason')}
              placeholder="Reunión familiar"
              invalid={!!errors.reason}
            />
            {errors.reason && (
              <p className="text-sm text-red-600 mt-1">{errors.reason.message}</p>
            )}
          </Field>
        </div>
      </FieldGroup>

      {/* Información del Vehículo (solo si es vehicular) */}
      {visitType === 'vehicular' && (
        <FieldGroup>
          <legend className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            Información del Vehículo
          </legend>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field>
              <Label htmlFor="vehiclePlate">Patente *</Label>
              <Input
                id="vehiclePlate"
                {...register('vehiclePlate', {
                  onChange: (e) => {
                    // Convertir a mayúsculas y limpiar caracteres no permitidos
                    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
                    setValue('vehiclePlate', value)
                  },
                  validate: (value) => {
                    if (visitType === 'vehicular' && (!value || value.trim() === '')) {
                      return 'La patente es requerida para visitas vehiculares'
                    }
                    if (value && value.length < 4) {
                      return 'La patente debe tener al menos 4 caracteres'
                    }
                    if (value && value.length > 10) {
                      return 'La patente no puede tener más de 10 caracteres'
                    }
                    return true
                  }
                })}
                placeholder="ABCD12 o AB1234"
                maxLength={10}
                invalid={!!errors.vehiclePlate}
                autoComplete="off"
              />
              {errors.vehiclePlate && (
                <p className="text-sm text-red-600 mt-1">{errors.vehiclePlate.message}</p>
              )}
            </Field>

            <Field>
              <Label htmlFor="vehicleBrand">Marca</Label>
              <Input
                id="vehicleBrand"
                {...register('vehicleBrand')}
                placeholder="Toyota"
                invalid={!!errors.vehicleBrand}
              />
            </Field>

            <Field>
              <Label htmlFor="vehicleModel">Modelo</Label>
              <Input
                id="vehicleModel"
                {...register('vehicleModel')}
                placeholder="Corolla"
                invalid={!!errors.vehicleModel}
              />
            </Field>

            <Field>
              <Label htmlFor="vehicleColor">Color</Label>
              <Input
                id="vehicleColor"
                {...register('vehicleColor')}
                placeholder="Blanco"
                invalid={!!errors.vehicleColor}
              />
            </Field>
          </div>
        </FieldGroup>
      )}

      {/* Fechas de Validez */}
      <FieldGroup>
        <legend className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Período de Validez y Control de Acceso
        </legend>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field>
            <Label htmlFor="validFrom">Válido Desde * (Fecha y Hora)</Label>
            <Input
              id="validFrom"
              type="datetime-local"
              step="60"
              {...register('validFrom', {
                validate: (value) => {
                  if (!value) return 'La fecha y hora de inicio es requerida'
                  const validFrom = new Date(value)
                  const now = new Date()
                  // Permitir fechas pasadas para flexibilidad, pero advertir si es muy antigua
                  if (validFrom < new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)) {
                    return 'La fecha de inicio parece muy antigua'
                  }
                  return true
                }
              })}
              invalid={!!errors.validFrom}
            />
            <p className="text-xs text-zinc-500 mt-1">
              Incluye fecha y hora de inicio
            </p>
            {errors.validFrom && (
              <p className="text-sm text-red-600 mt-1">{errors.validFrom.message}</p>
            )}
          </Field>

          <Field>
            <Label htmlFor="validUntil">Válido Hasta * (Fecha y Hora)</Label>
            <Input
              id="validUntil"
              type="datetime-local"
              step="60"
              {...register('validUntil', {
                validate: (value) => {
                  if (!value) return 'La fecha y hora de fin es requerida'
                  const validFrom = watch('validFrom')
                  if (validFrom) {
                    const dateFrom = new Date(validFrom)
                    const dateUntil = new Date(value)
                    if (dateUntil <= dateFrom) {
                      return 'La fecha de fin debe ser posterior a la fecha de inicio'
                    }
                    // Validar que no sea más de 1 año
                    const oneYearLater = new Date(dateFrom)
                    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1)
                    if (dateUntil > oneYearLater) {
                      return 'La visita no puede durar más de 1 año'
                    }
                  }
                  return true
                }
              })}
              invalid={!!errors.validUntil}
            />
            <p className="text-xs text-zinc-500 mt-1">
              Incluye fecha y hora de finalización
            </p>
            {errors.validUntil && (
              <p className="text-sm text-red-600 mt-1">{errors.validUntil.message}</p>
            )}
          </Field>

          <Field>
            <Label htmlFor="maxUses">Cantidad de Usos</Label>
            <Input
              id="maxUses"
              type="number"
              min="1"
              placeholder="Ilimitado"
              {...register('maxUses', { 
                valueAsNumber: true, 
                setValueAs: v => v === '' || v === null ? undefined : Number(v),
                validate: (value) => {
                  const numValue = value as number | undefined
                  if (numValue !== undefined && numValue !== null) {
                    if (numValue < 1) {
                      return 'Debe ser al menos 1 uso'
                    }
                    if (numValue > 1000) {
                      return 'No puede exceder 1000 usos'
                    }
                    if (!Number.isInteger(numValue)) {
                      return 'Debe ser un número entero'
                    }
                  }
                  return true
                }
              })}
              invalid={!!errors.maxUses}
            />
            <p className="text-xs text-zinc-500 mt-1">
              Dejar vacío para usos ilimitados
            </p>
            {errors.maxUses && (
              <p className="text-sm text-red-600 mt-1">{errors.maxUses.message}</p>
            )}
          </Field>
        </div>
      </FieldGroup>

      {/* Anfitrión */}
      <FieldGroup>
        <legend className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Información del Anfitrión
        </legend>

        <Field>
          <Label htmlFor="hostId">Anfitrión (Residente) *</Label>
          <Controller
            name="hostId"
            control={control}
            rules={{
              required: 'Debe seleccionar un anfitrión',
              validate: (value) => {
                if (!value || value === '') {
                  return 'Debe seleccionar un anfitrión'
                }
                return true
              }
            }}
            render={({ field }) => (
              <Select {...field} invalid={!!errors.hostId}>
                <option value="">Seleccione un residente</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} - {user.email}
                  </option>
                ))}
              </Select>
            )}
          />
          {errors.hostId && (
            <p className="text-sm text-red-600 mt-1">{errors.hostId.message}</p>
          )}
          <p className="text-xs text-zinc-500 mt-1">
            La familia se asignará automáticamente desde el anfitrión seleccionado
          </p>
        </Field>
      </FieldGroup>

      {/* Botones */}
      <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <Button type="button" plain onClick={() => onSuccess()}>
          Cancelar
        </Button>
        <Button 
          type="submit" 
          color="indigo" 
          disabled={isPending}
          onClick={() => console.log('Botón submit clickeado')}
        >
          {isPending ? 'Guardando...' : isEditing ? 'Actualizar Visita' : 'Crear Visita'}
        </Button>
      </div>
    </form>
  )
}
