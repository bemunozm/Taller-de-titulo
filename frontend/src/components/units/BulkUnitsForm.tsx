import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { createBulkUnitsSchema, type CreateBulkUnitsFormData } from '@/types/index'
import { Button } from '@/components/ui/Button'
import { Field, Label } from '@/components/ui/Fieldset'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'

type BulkUnitsFormProps = {
    onSubmit: (formData: CreateBulkUnitsFormData) => void
    onCancel: () => void
}

export default function BulkUnitsForm({ onSubmit, onCancel }: BulkUnitsFormProps) {
    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<CreateBulkUnitsFormData>({
        resolver: zodResolver(createBulkUnitsSchema),
        defaultValues: {
            active: true,
        },
    })

    const formValues = watch()
    const active = watch('active')

    // Calcular preview de unidades que se crearán
    const preview = useMemo(() => {
        const { block, numberFrom, numberTo } = formValues

        if (!numberFrom || !numberTo || numberFrom > numberTo) {
            return { identifiers: [], count: 0, isValid: false }
        }

        const count = numberTo - numberFrom + 1
        if (count > 1000) {
            return { identifiers: [], count, isValid: false }
        }

        // Generar preview de los primeros 10 identificadores
        const identifiers: string[] = []
        const limit = Math.min(count, 10)
        
        for (let i = 0; i < limit; i++) {
            const num = numberFrom + i
            const identifier = block ? `${block.toUpperCase()}-${num}` : `${num}`
            identifiers.push(identifier)
        }

        return { identifiers, count, isValid: true }
    }, [formValues.block, formValues.numberFrom, formValues.numberTo])

    const handleFormSubmit = (data: CreateBulkUnitsFormData) => {
        // Validar que el rango sea válido
        if (data.numberFrom > data.numberTo) {
            return
        }
        
        onSubmit(data)
    }

    return (
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
            {/* Bloque (opcional) */}
            <Field>
                <Label>Bloque (Opcional)</Label>
                <Input
                    {...register('block')}
                    placeholder="Ej: A, B, Torre-1"
                    invalid={!!errors.block}
                />
                {errors.block && (
                    <p className="mt-1 text-sm text-red-600">{errors.block.message}</p>
                )}
                <p className="mt-1 text-sm text-zinc-500">
                    Si especificas un bloque, los identificadores serán BLOQUE-NÚMERO
                </p>
            </Field>

            {/* Rango de números */}
            <div className="grid grid-cols-2 gap-4">
                <Field>
                    <Label>Número Inicial *</Label>
                    <Input
                        type="number"
                        {...register('numberFrom', { valueAsNumber: true })}
                        placeholder="1"
                        invalid={!!errors.numberFrom}
                        min={1}
                        step={1}
                    />
                    {errors.numberFrom && (
                        <p className="mt-1 text-sm text-red-600">{errors.numberFrom.message}</p>
                    )}
                </Field>

                <Field>
                    <Label>Número Final *</Label>
                    <Input
                        type="number"
                        {...register('numberTo', { valueAsNumber: true })}
                        placeholder="100"
                        invalid={!!errors.numberTo}
                        min={1}
                        step={1}
                    />
                    {errors.numberTo && (
                        <p className="mt-1 text-sm text-red-600">{errors.numberTo.message}</p>
                    )}
                </Field>
            </div>

            {/* Piso (opcional) */}
            <Field>
                <Label>Piso (Opcional)</Label>
                <Input
                    type="number"
                    {...register('floor', { 
                        setValueAs: (value) => value === '' || isNaN(value) ? undefined : parseInt(value)
                    })}
                    placeholder="Ej: 1, 2, -1 (subterráneo)"
                    invalid={!!errors.floor}
                    step={1}
                />
                {errors.floor && (
                    <p className="mt-1 text-sm text-red-600">{errors.floor.message}</p>
                )}
                <p className="mt-1 text-sm text-zinc-500">
                    Números negativos para pisos subterráneos
                </p>
            </Field>

            {/* Tipo (opcional) */}
            <Field>
                <Label>Tipo (Opcional)</Label>
                <Select {...register('type')} invalid={!!errors.type}>
                    <option value="">Sin especificar</option>
                    <option value="Departamento">Departamento</option>
                    <option value="Casa">Casa</option>
                    <option value="Local Comercial">Local Comercial</option>
                    <option value="Bodega">Bodega</option>
                    <option value="Estacionamiento">Estacionamiento</option>
                    <option value="Oficina">Oficina</option>
                </Select>
                {errors.type && (
                    <p className="mt-1 text-sm text-red-600">{errors.type.message}</p>
                )}
            </Field>

            {/* Estado activo */}
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
                            {active ? 'Las unidades estarán activas' : 'Las unidades estarán inactivas'}
                        </p>
                    </div>
                </div>
            </Field>

            {/* Preview */}

            {/* Preview */}
            {preview.count > 0 && (
                <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4">
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-white mb-2">
                        Vista Previa
                    </h4>
                    {!preview.isValid && preview.count > 1000 && (
                        <p className="text-sm text-red-600 mb-2">
                            ⚠️ El rango es demasiado grande (máximo 1000 unidades)
                        </p>
                    )}
                    {!preview.isValid && formValues.numberFrom > formValues.numberTo && (
                        <p className="text-sm text-red-600 mb-2">
                            ⚠️ El número inicial debe ser menor o igual al número final
                        </p>
                    )}
                    {preview.isValid && (
                        <>
                            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                                Se crearán <span className="font-semibold text-zinc-900 dark:text-white">{preview.count}</span> unidades
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {preview.identifiers.map((id) => (
                                    <span
                                        key={id}
                                        className="inline-flex items-center rounded-md bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-400 ring-1 ring-inset ring-indigo-700/10 dark:ring-indigo-400/30"
                                    >
                                        {id}
                                    </span>
                                ))}
                                {preview.count > 10 && (
                                    <span className="inline-flex items-center rounded-md bg-zinc-50 dark:bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-400 ring-1 ring-inset ring-zinc-500/10">
                                        ... y {preview.count - 10} más
                                    </span>
                                )}
                            </div>
                            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
                                💡 Las unidades duplicadas serán omitidas automáticamente
                            </p>
                        </>
                    )}
                </div>
            )}

            {/* Botones de acción */}
            <div className="flex justify-end gap-4 mt-6">
                <Button type="button" plain onClick={onCancel}>
                    Cancelar
                </Button>
                <Button
                    type="submit"
                    disabled={isSubmitting || !preview.isValid}
                    className="bg-indigo-600 hover:bg-indigo-500"
                >
                    {isSubmitting ? 'Creando...' : `Crear ${preview.count} Unidades`}
                </Button>
            </div>
        </form>
    )
}
