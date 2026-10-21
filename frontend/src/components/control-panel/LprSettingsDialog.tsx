import { useState, type ReactNode } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  getCameraLprSettings,
  resetCameraLprSettings,
  updateCameraLprSettings,
} from '@/api/CameraAPI'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { Description, ErrorMessage, Field, Fieldset, Label } from '@/components/ui/Fieldset'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import {
  LPR_ACTION_LABELS,
  LPR_DIRECTION_LABELS,
  LPR_RECOMMENDED_MIN_CONFIRM_READS,
  LPR_WORKER_DEFAULTS,
  describeZone,
  lprSettingsQueryKey,
  lprFormSchema,
  toLprFormValues,
  toLprSettingsPayload,
  type LprFormOutput,
  type LprFormValues,
} from '@/helpers/lprSettings'
import {
  LPR_ACTIONS,
  LPR_DETECTOR_IMGSZ_VALUES,
  LPR_DIRECTIONS,
  type Camera,
  type LprSettings,
  type ZonePoint,
} from '@/types/index'
import { ZoneEditor } from './ZoneEditor'

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-base/6 font-semibold text-zinc-950 sm:text-sm/6 dark:text-white">{children}</h3>
}

type LprCamera = Pick<Camera, 'id' | 'name' | 'mountPath'>

interface LprSettingsDialogProps {
  camera: LprCamera
  /** Con `cameras.enable-ia`; sin él el diálogo es solo de lectura. */
  canEdit: boolean
  onClose: () => void
}

export function LprSettingsDialog({ camera, canEdit, onClose }: LprSettingsDialogProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: lprSettingsQueryKey(camera.id),
    queryFn: () => getCameraLprSettings(camera.id),
    // La configuración la cambia el propio diálogo; no hace falta refrescarla al enfocar.
    refetchOnWindowFocus: false,
  })

  return (
    <Dialog open onClose={onClose} size="3xl">
      <DialogTitle>Visión LPR · {camera.name}</DialogTitle>
      <DialogDescription>
        Ajustes del reconocimiento de patentes para esta cámara. Los campos vacíos usan el valor por defecto del
        worker.
      </DialogDescription>
      <DialogBody>
        {isLoading && <p className="text-sm text-zinc-500">Cargando configuración...</p>}
        {error && (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-red-600 dark:text-red-500">{error.message}</p>
            <Button outline onClick={() => refetch()}>
              Reintentar
            </Button>
          </div>
        )}
        {data && (
          <LprSettingsForm
            camera={camera}
            initial={data.lprSettings}
            canEdit={canEdit}
            onClose={onClose}
          />
        )}
        {!data && (
          <DialogActions>
            <Button plain onClick={onClose}>
              Cerrar
            </Button>
          </DialogActions>
        )}
      </DialogBody>
    </Dialog>
  )
}

interface LprSettingsFormProps {
  camera: LprCamera
  initial: LprSettings | null
  canEdit: boolean
  onClose: () => void
}

function LprSettingsForm({ camera, initial, canEdit, onClose }: LprSettingsFormProps) {
  const queryClient = useQueryClient()
  const [showZoneEditor, setShowZoneEditor] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<LprFormValues, unknown, LprFormOutput>({
    resolver: zodResolver(lprFormSchema),
    defaultValues: toLprFormValues(initial),
  })

  const action = watch('action')
  const zone = watch('zone')
  const unlimitedMaxWidth = watch('unlimitedMaxWidth')
  const confirmReads = watch('confirmReads')
  // En control de acceso es un error de validación; en solo registrar queda como aviso.
  const lowConfirmReads =
    action === 'register' && confirmReads.trim() !== '' && Number(confirmReads) < LPR_RECOMMENDED_MIN_CONFIRM_READS
  const [submitInvalid, setSubmitInvalid] = useState(false)

  const afterChange = () => {
    queryClient.invalidateQueries({ queryKey: lprSettingsQueryKey(camera.id) })
    queryClient.invalidateQueries({ queryKey: ['cameras'] })
    onClose()
  }

  const saveMutation = useMutation({
    mutationFn: (settings: LprSettings) => updateCameraLprSettings(camera.id, settings),
    onSuccess: () => {
      toast.success(`Configuración LPR guardada para ${camera.name}`)
      afterChange()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const resetMutation = useMutation({
    mutationFn: () => resetCameraLprSettings(camera.id),
    onSuccess: () => {
      toast.success(`Configuración LPR restablecida para ${camera.name}`)
      afterChange()
    },
    onError: (err: Error) => {
      setConfirmingReset(false)
      toast.error(err.message)
    },
  })

  const isBusy = saveMutation.isPending || resetMutation.isPending

  const onSubmit = (values: LprFormOutput) => {
    setSubmitInvalid(false)
    saveMutation.mutate(toLprSettingsPayload(values))
  }
  const onInvalid = () => {
    setSubmitInvalid(true)
    toast.error('Revisa los campos marcados: la configuración no se guardó')
  }

  // La zona se aplica al formulario y se persiste junto con el resto al guardar:
  // el PATCH reemplaza toda la configuración, así no se pisan ajustes sin guardar.
  const applyZone = async (zones: ZonePoint[][]) => {
    setValue('zone', zones, { shouldDirty: true, shouldValidate: true })
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-6">
        {submitInvalid && (
          <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
            La configuración no se guardó: corrige los campos marcados.
          </p>
        )}

        {!canEdit && (
          <p role="status" className="rounded-lg bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-white/5 dark:text-zinc-400">
            Solo lectura: modificar la visión LPR requiere el permiso de habilitar IA en cámaras.
          </p>
        )}

        <Fieldset disabled={!canEdit || isBusy} className="space-y-6">
          <SectionTitle>Política</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <Label>Modo</Label>
              <Select {...register('action')} invalid={!!errors.action}>
                {LPR_ACTIONS.map((value) => (
                  <option key={value} value={value}>
                    {LPR_ACTION_LABELS[value]}
                  </option>
                ))}
              </Select>
              <Description>
                {action === 'register'
                  ? '"Solo registrar" nunca abre el portón ni escala al conserje: solo guarda la lectura.'
                  : '"Control de acceso" decide según el vehículo: puede abrir el portón o consultar al conserje.'}
              </Description>
            </Field>

            <Field>
              <Label>Dirección</Label>
              <Select {...register('direction')}>
                <option value="">Sin definir</option>
                {LPR_DIRECTIONS.map((value) => (
                  <option key={value} value={value}>
                    {LPR_DIRECTION_LABELS[value]}
                  </option>
                ))}
              </Select>
              <Description>Sentido de paso que registra esta cámara. "Ambas" lo infiere por el movimiento.</Description>
            </Field>
          </div>

          <SectionTitle>Detección</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <Label>Resolución del detector</Label>
              <Select {...register('detectorImgsz')}>
                <option value="">Por defecto ({LPR_WORKER_DEFAULTS.detectorImgsz})</option>
                {LPR_DETECTOR_IMGSZ_VALUES.map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </Select>
              <Description>
                Más alta = detecta patentes más pequeñas, a mayor costo de cómputo. 1920 se recomienda solo con GPU.
              </Description>
            </Field>

            <Field>
              <Label>FPS de muestreo</Label>
              <Input
                {...register('sampleFps')}
                type="number"
                step="any"
                inputMode="decimal"
                placeholder={String(LPR_WORKER_DEFAULTS.sampleFps)}
                invalid={!!errors.sampleFps}
              />
              <Description>Cuadros por segundo que analiza el worker (1 a 15).</Description>
              {errors.sampleFps && <ErrorMessage>{errors.sampleFps.message}</ErrorMessage>}
            </Field>
          </div>

          <SectionTitle>Recorte de la patente</SectionTitle>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Descarta detecciones que no calzan con una patente: por ancho en píxeles y por relación ancho/alto.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field>
              <Label>Ancho mínimo (px)</Label>
              <Input
                {...register('minWidth')}
                type="number"
                step="1"
                inputMode="numeric"
                placeholder={String(LPR_WORKER_DEFAULTS.minWidth)}
                invalid={!!errors.minWidth}
              />
              {errors.minWidth && <ErrorMessage>{errors.minWidth.message}</ErrorMessage>}
            </Field>

            <div>
              <Field>
                <Label>Ancho máximo (px)</Label>
                <Input
                  {...register('maxWidth')}
                  type="number"
                  step="1"
                  inputMode="numeric"
                  placeholder={unlimitedMaxWidth ? 'Sin tope' : 'Por defecto'}
                  disabled={unlimitedMaxWidth}
                  invalid={!!errors.maxWidth}
                />
                {errors.maxWidth && <ErrorMessage>{errors.maxWidth.message}</ErrorMessage>}
              </Field>
              <Field className="mt-2 flex items-center gap-3">
                <Controller
                  control={control}
                  name="unlimitedMaxWidth"
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onChange={(checked: boolean) => {
                        field.onChange(checked)
                        if (checked) setValue('maxWidth', '')
                      }}
                      name={field.name}
                    />
                  )}
                />
                <Label>Sin tope de ancho máximo</Label>
              </Field>
            </div>

            <Field>
              <Label>Relación mínima (ancho/alto)</Label>
              <Input
                {...register('minRatio')}
                type="number"
                step="any"
                inputMode="decimal"
                placeholder={String(LPR_WORKER_DEFAULTS.minRatio)}
                invalid={!!errors.minRatio}
              />
              {errors.minRatio && <ErrorMessage>{errors.minRatio.message}</ErrorMessage>}
            </Field>

            <Field>
              <Label>Relación máxima (ancho/alto)</Label>
              <Input
                {...register('maxRatio')}
                type="number"
                step="any"
                inputMode="decimal"
                placeholder={String(LPR_WORKER_DEFAULTS.maxRatio)}
                invalid={!!errors.maxRatio}
              />
              {errors.maxRatio && <ErrorMessage>{errors.maxRatio.message}</ErrorMessage>}
            </Field>
          </div>

          <SectionTitle>Confirmación</SectionTitle>
          <Field>
            <Label>Lecturas para confirmar</Label>
            <Input
              {...register('confirmReads')}
              type="number"
              step="1"
              inputMode="numeric"
              placeholder={String(LPR_WORKER_DEFAULTS.confirmReads)}
              invalid={!!errors.confirmReads}
              className="md:max-w-xs"
            />
            <Description>
              Lecturas concordantes del mismo vehículo antes de emitir la patente (1 a 10). Con control de acceso el mínimo es{' '}
              {LPR_RECOMMENDED_MIN_CONFIRM_READS}; en solo registrar puede ser menor, a costa de lecturas erróneas.
            </Description>
            {lowConfirmReads && !errors.confirmReads && (
              <p role="status" className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                Con menos de {LPR_RECOMMENDED_MIN_CONFIRM_READS} lecturas se pueden registrar patentes mal leídas.
              </p>
            )}
            {errors.confirmReads && <ErrorMessage>{errors.confirmReads.message}</ErrorMessage>}
          </Field>
        </Fieldset>

        <section aria-labelledby="lpr-zone-heading" className="space-y-2">
          <h3 id="lpr-zone-heading" className="text-base/6 font-semibold text-zinc-950 sm:text-sm/6 dark:text-white">
            Zona de detección
          </h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {describeZone(zone)} Solo se leen las patentes cuyo centro cae dentro de la zona.
          </p>
          {errors.zone && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-500">
              La zona no es válida: {errors.zone.message ?? errors.zone.root?.message ?? 'revisa sus puntos (cada zona necesita de 3 a 100 puntos, hasta 20 zonas) y vuelve a dibujarla.'}
            </p>
          )}
          {canEdit && (
            <div className="flex flex-wrap items-center gap-3">
              <Button outline type="button" disabled={isBusy} onClick={() => setShowZoneEditor(true)}>
                {zone.length > 0 ? 'Editar zona de detección' : 'Dibujar zona de detección'}
              </Button>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                La zona se guarda junto con el resto al pulsar "Guardar".
              </p>
            </div>
          )}
        </section>

        {confirmingReset ? (
          <div role="alertdialog" aria-label="Confirmar restablecimiento" className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              Se borrarán todos los ajustes de esta cámara, incluida la zona, y volverá a los valores por defecto del
              worker (control de acceso). ¿Continuar?
            </p>
            <div className="flex gap-3">
              <Button color="red" type="button" disabled={isBusy} onClick={() => resetMutation.mutate()}>
                {resetMutation.isPending ? 'Restableciendo...' : 'Sí, restablecer'}
              </Button>
              <Button plain type="button" disabled={isBusy} onClick={() => setConfirmingReset(false)}>
                No, volver
              </Button>
            </div>
          </div>
        ) : (
          <DialogActions>
            {canEdit && (
              <Button
                plain
                type="button"
                disabled={isBusy}
                onClick={() => setConfirmingReset(true)}
                className="mr-auto"
              >
                Restablecer valores por defecto
              </Button>
            )}
            <Button plain type="button" onClick={onClose} disabled={isBusy}>
              {canEdit ? 'Cancelar' : 'Cerrar'}
            </Button>
            {canEdit && (
              <Button type="submit" color="indigo" disabled={isBusy}>
                {saveMutation.isPending ? 'Guardando...' : 'Guardar'}
              </Button>
            )}
          </DialogActions>
        )}
      </form>

      {showZoneEditor && (
        <ZoneEditor
          camera={camera}
          initialZones={zone}
          tone="lpr"
          title={
            <>
              Zona de detección <span className="ml-2 font-black text-emerald-500">LPR</span>
            </>
          }
          description={
            <>
              Delimita dónde se leen patentes en <span className="font-bold text-emerald-400">{camera.name}</span>
            </>
          }
          saveLabel="Aplicar zona"
          successMessage='Zona aplicada. Pulsa "Guardar" para conservarla'
          onSave={applyZone}
          onClose={() => setShowZoneEditor(false)}
        />
      )}
    </>
  )
}
