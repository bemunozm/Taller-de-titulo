import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Dialog, DialogTitle, DialogDescription, DialogActions, DialogBody } from '@/components/ui/Dialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listCameras, createCamera, updateCamera, deleteCamera, registerCamera, getCameraSourceUrl, getCameraHasSource, getIAHealth, getMediamtxHealth, enableCameraLpr, enableCameraGuardian } from '@/api/CameraAPI'
import { listRoles } from '@/api/RoleAPI'
import type { Role } from '@/types/index'
import MultiSelectCombobox from '@/components/ui/MultiSelectCombobox'
import { useForm, Controller } from 'react-hook-form'
import type { CreateCameraFormData, CreateCameraPayload, UpdateCameraFormData, Camera, OrganizationScoped } from '@/types/index'
import { CONDOMINIUM_REQUIRED_MESSAGE, scopeCreatePayload, withoutOrganizationId } from '@/helpers/condominium'
import { useCondominiumScope } from '@/hooks/useCondominiumScope'
import { CondominiumSelect } from '@/components/condominiums/CondominiumSelect'
import { toast } from 'react-toastify'
import { Switch, SwitchField, SwitchGroup } from '@/components/ui/Switch'
import { Label, Description } from '@/components/ui/Fieldset'
import UrlRevealInput from '@/components/ui/UrlRevealInput'
import { usePermissions } from '@/hooks/usePermissions'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/ui/Dropdown'
import { EllipsisHorizontalIcon } from '@heroicons/react/20/solid'
import { 
  VideoCameraIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  BoltIcon,
  ServerIcon
} from '@heroicons/react/24/outline'
import GuardianZoneEditor from './GuardianZoneEditor'

type CameraFormValues = CreateCameraFormData & OrganizationScoped

interface CamerasPanelProps {
  triggerNew?: boolean
}

export default function CamerasPanel({ triggerNew }: CamerasPanelProps) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Camera | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showDelete, setShowDelete] = useState<Camera | null>(null)
  const [showZoneEditor, setShowZoneEditor] = useState<Camera | null>(null)

  // Responder al trigger para abrir formulario de nueva cámara
  useEffect(() => {
    if (triggerNew) {
      setSelected(null)
      setShowForm(true)
    }
  }, [triggerNew])

  // `GET /cameras/:id/source` revela una credencial (la URL RTSP): exige cameras.update.
  const { hasPermission } = usePermissions()
  const canRevealSource = hasPermission('cameras.update')

  const { data: cameras = [], isLoading } = useQuery<Camera[], Error>({ queryKey: ['cameras'], queryFn: () => listCameras() })
  const { data: iaHealth } = useQuery({ queryKey: ['ia-health'], queryFn: () => getIAHealth(), staleTime: 30_000, refetchOnWindowFocus: false, retry: false })
  const { data: mediamtxHealth } = useQuery({ queryKey: ['mediamtx-health'], queryFn: () => getMediamtxHealth(), staleTime: 30_000, refetchOnWindowFocus: false, retry: false })
  const { data: roles = [] as Role[] } = useQuery<Role[], Error>({ queryKey: ['roles'], queryFn: () => listRoles() })

  const createMut = useMutation<Camera, Error, CreateCameraFormData>({
    mutationFn: (payload) => createCamera(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Cámara creada')
    },
    onError: (err) => toast.error(err.message || 'Error al crear cámara'),
  })

  const updateMut = useMutation<Camera, Error, { id: string; payload: UpdateCameraFormData }>({
    mutationFn: ({ id, payload }) => updateCamera(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Cámara actualizada')
    },
    onError: (err) => toast.error(err.message || 'Error al actualizar cámara'),
  })

  const deleteMut = useMutation<unknown, Error, string>({
    mutationFn: (id) => deleteCamera(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Cámara eliminada')
    },
    onError: (err) => toast.error(err.message || 'Error al eliminar cámara'),
  })

  const registerMut = useMutation<unknown, Error, string>({
    mutationFn: (id) => registerCamera(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Registro enviado a MediaMTX')
    },
    onError: (err) => toast.error(err.message || 'Error al registrar en MediaMTX'),
  })

  const toggleLprMut = useMutation({
    mutationFn: ({ id, enableLpr }: { id: string; enableLpr: boolean }) => enableCameraLpr(id, enableLpr),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success(`LPR ${data.enableLpr ? 'habilitado' : 'deshabilitado'} para ${data.name}`)
    },
    onError: (err: Error) => toast.error(err.message || 'Error al cambiar estado de LPR'),
  })

  const toggleGuardianMut = useMutation({
    mutationFn: ({ id, enableGuardian }: { id: string; enableGuardian: boolean }) =>
      enableCameraGuardian(id, enableGuardian),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success(`Guardián Visual ${data.enableGuardian ? 'activado' : 'desactivado'} para ${data.name}`)
    },
    onError: (err: Error) => toast.error(err.message || 'Error al cambiar estado de Guardián Visual'),
  })

  const { register, handleSubmit, reset, setValue, control, setError, clearErrors, formState: { errors } } =
    useForm<CameraFormValues>({})

  // Super-admin creando una cámara: elige el condominio (obligatorio); nadie más
  // lo envía y nunca va en `PATCH /cameras/:id` (400).
  const { chooseCondominium } = useCondominiumScope(!!selected)


  const [loadingSource, setLoadingSource] = useState(false)
  const [hasSource, setHasSource] = useState(false)
  const [revealedSource, setRevealedSource] = useState<string | null>(null)



  useEffect(() => {
    if (selected) {
      // populate form
      setValue('name', selected.name)
      setValue('location', selected.location || '')
      // do not auto-fetch sourceUrl for privacy; only mark masked if exists
      setValue('sourceUrl', '')
      setRevealedSource(null)
      ;(async () => {
        try {
          const r = await getCameraHasSource(selected.id)
          setHasSource(!!r?.hasSource)
        } catch {
          setHasSource(false)
        }
      })()

      // populate roleIds if roles are attached
      setValue('roleIds', selected.roles?.map((r) => r.id) ?? [])
      // populate enableLpr / enableGuardian flags
      setValue('enableLpr', selected.enableLpr ?? false)
      setValue('enableGuardian', selected.enableGuardian ?? false)
      // populate active flag: backend may treat undefined as active, but for editing we want explicit value
      setValue('active', selected.active === undefined ? true : !!selected.active)
    } else {
      reset()
    }
  }, [selected, setValue, reset])

  const handleShowSource = async () => {
    if (!selected || !canRevealSource) return
    // toggle reveal/hide
    if (revealedSource) {
      // hide: clear visible value but keep hasSource true (masked)
      setRevealedSource(null)
      setValue('sourceUrl', '')
      return
    }

    setLoadingSource(true)
    try {
      const res = await getCameraSourceUrl(selected.id)
      if (res && typeof res.sourceUrl === 'string' && res.sourceUrl) {
        setRevealedSource(res.sourceUrl)
        setValue('sourceUrl', res.sourceUrl)
        setHasSource(true)
      } else {
        toast.info('No hay URL disponible para esta cámara')
        setHasSource(false)
      }
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'No fue posible obtener la URL de la cámara')
    } finally {
      setLoadingSource(false)
    }
  }

  const onSubmit = async (data: CameraFormValues) => {
    try {
      if (selected && selected.id) {
        // Build update payload: remove keys that should not be sent or are empty
        // (`active` se envía explícito para que el backend guarde true/false)
        const payload: UpdateCameraFormData = withoutOrganizationId(data)

        // If sourceUrl provided via revealedSource, prefer that; otherwise if empty remove
        if (revealedSource) {
          payload.sourceUrl = revealedSource
        } else if (!payload.sourceUrl) {
          delete payload.sourceUrl
        }

        // remove empty roleIds
        if (Array.isArray(payload.roleIds) && payload.roleIds.length === 0) delete payload.roleIds

        await updateMut.mutateAsync({ id: selected.id, payload })
      } else {
        // Manual validation for create: require sourceUrl and name
        if (chooseCondominium && !data.organizationId) {
          setError('organizationId', { type: 'required', message: CONDOMINIUM_REQUIRED_MESSAGE })
          return
        }
        clearErrors('organizationId')
        const toCreate: CreateCameraPayload = scopeCreatePayload(data, chooseCondominium)
        if (revealedSource) toCreate.sourceUrl = revealedSource
        // minimal validation
        if (!toCreate.name || typeof toCreate.name !== 'string' || !toCreate.name.trim()) {
          toast.error('El nombre es requerido')
          return
        }
        if (!toCreate.sourceUrl || typeof toCreate.sourceUrl !== 'string' || !toCreate.sourceUrl.trim()) {
          toast.error('La URL de la cámara es requerida')
          return
        }
        await createMut.mutateAsync(toCreate)
      }
      setShowForm(false)
      setSelected(null)
      reset()
    } catch {
      // El onError de la mutación ya avisó con un toast; el formulario sigue abierto.
    }
  }

  const isSubmitting = createMut.isPending || updateMut.isPending

  const onDelete = async (id: string) => {
    try {
      await deleteMut.mutateAsync(id)
      setShowDelete(null)
    } catch {
      // El onError de la mutación ya avisó con un toast.
    }
  }

  // Subcomponent: single camera card that requests events count per camera
  function CameraCard({ cam }: { cam: Camera }) {
    return (
      <div className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 p-4 transition-all hover:border-zinc-700 hover:shadow-lg hover:shadow-zinc-900/50">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <VideoCameraIcon className="h-5 w-5 text-zinc-400 flex-shrink-0" />
              <h4 className="font-semibold text-zinc-100 truncate">{cam.name || '(sin nombre)'}</h4>
            </div>
            <p className="text-sm text-zinc-400 truncate">{cam.location || 'Sin ubicación'}</p>
          </div>
          
          <Dropdown>
            <DropdownButton plain aria-label="Más opciones" as={Button} className="p-2 -mr-2">
              <EllipsisHorizontalIcon className="h-5 w-5 text-zinc-300" />
            </DropdownButton>
            <DropdownMenu>
              <DropdownItem onClick={() => { setSelected(cam); setShowForm(true) }}>Editar</DropdownItem>
              <DropdownItem onClick={() => registerMut.mutate(cam.id)}>Registrar en MediaMTX</DropdownItem>
              {cam.enableLpr ? (
                <DropdownItem onClick={() => toggleLprMut.mutate({ id: cam.id, enableLpr: false })}>Deshabilitar LPR</DropdownItem>
              ) : (
                <DropdownItem onClick={() => toggleLprMut.mutate({ id: cam.id, enableLpr: true })}>Habilitar LPR</DropdownItem>
              )}
              {cam.enableGuardian ? (
                <DropdownItem onClick={() => toggleGuardianMut.mutate({ id: cam.id, enableGuardian: false })}>Deshabilitar Guardián</DropdownItem>
              ) : (
                <DropdownItem onClick={() => toggleGuardianMut.mutate({ id: cam.id, enableGuardian: true })}>Habilitar Guardián</DropdownItem>
              )}
              <DropdownItem onClick={() => setShowZoneEditor(cam)}>Configurar Zonas Alarmas</DropdownItem>
              <DropdownItem onClick={() => setShowDelete(cam)}>Eliminar</DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>

        {/* Status Badges */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {cam.active === false ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20">
              <XCircleIcon className="h-3.5 w-3.5 text-red-400" />
              <span className="text-xs font-medium text-red-400">Inactiva</span>
            </div>
          ) : (
            <>
              {cam.registeredInMediamtx ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-400">MediaMTX</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-700/50 border border-zinc-600/50">
                  <XCircleIcon className="h-3.5 w-3.5 text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-400">No MTX</span>
                </div>
              )}
              
              {cam.enableLpr && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20">
                  <BoltIcon className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-blue-400">LPR</span>
                </div>
              )}
              
              {cam.enableGuardian && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                  <div className="h-2 w-2 bg-indigo-500 rounded-full animate-pulse" />
                  <span className="text-xs font-medium text-indigo-400">Guardián IA</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Mount Path */}
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-2">
            <ServerIcon className="h-4 w-4 text-zinc-500 flex-shrink-0" />
            <code className="text-xs text-zinc-400 font-mono truncate">{cam.mountPath}</code>
          </div>
        </div>
      </div>
    )
  }

  // Calcular estadísticas
  const stats = {
    total: cameras.length,
    active: cameras.filter((c) => c.active !== false).length,
    withLpr: cameras.filter((c) => c.enableLpr === true).length,
    registered: cameras.filter((c) => c.registeredInMediamtx === true).length,
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-400">Cargando cámaras...</span>
      </div>
    )
  }

  return (
    <div>
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Total Cameras */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <VideoCameraIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total de Cámaras
            </div>
          </div>
          <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.total}
          </div>
        </div>

        {/* Active Cameras */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircleIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Cámaras Activas
            </div>
          </div>
          <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
            {stats.active}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {stats.total > 0
              ? `${Math.round((stats.active / stats.total) * 100)}% del total`
              : '0% del total'}
          </div>
        </div>

        {/* LPR Enabled */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <BoltIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Con LPR Habilitado
            </div>
          </div>
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
            {stats.withLpr}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Reconocimiento de patentes activo
          </div>
        </div>

        {/* MediaMTX Registered */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <ServerIcon className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Registradas en MTX
            </div>
          </div>
          <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {stats.registered}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {stats.total > 0
              ? `${Math.round((stats.registered / stats.total) * 100)}% del total`
              : '0% del total'}
          </div>
        </div>
      </div>

      {/* System Health Status */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* IA Health */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-full p-2 ${iaHealth?.ok ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <BoltIcon className={`h-5 w-5 ${iaHealth?.ok ? 'text-emerald-400' : 'text-red-400'}`} />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">Motor IA (Análisis Visual)</div>
                <div className={`text-xs ${iaHealth?.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {iaHealth ? (iaHealth.ok ? 'Activo' : iaHealth.status || 'Inactivo') : 'Desconocido'}
                </div>
              </div>
            </div>
            <div className={`h-2 w-2 rounded-full ${iaHealth?.ok ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`} />
          </div>
        </div>

        {/* MediaMTX Health */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`rounded-full p-2 ${mediamtxHealth?.ok ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <ServerIcon className={`h-5 w-5 ${mediamtxHealth?.ok ? 'text-emerald-400' : 'text-red-400'}`} />
              </div>
              <div>
                <div className="text-sm font-medium text-zinc-300">MediaMTX Server</div>
                <div className={`text-xs ${mediamtxHealth?.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {mediamtxHealth ? (mediamtxHealth.ok ? 'Activo' : mediamtxHealth.message || mediamtxHealth.status || 'Inactivo') : 'Desconocido'}
                </div>
              </div>
            </div>
            <div className={`h-2 w-2 rounded-full ${mediamtxHealth?.ok ? 'bg-emerald-400' : 'bg-red-400'} animate-pulse`} />
          </div>
        </div>
      </div>

      {/* Cameras Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cameras.length === 0 ? (
          <div className="col-span-full text-center py-12 text-zinc-400">
            <VideoCameraIcon className="h-12 w-12 mx-auto mb-3 text-zinc-600" />
            <p className="text-sm">No hay cámaras registradas</p>
            <p className="text-xs mt-1">Comienza agregando tu primera cámara</p>
          </div>
        ) : (
          cameras.map((cam: Camera) => <CameraCard key={cam.id} cam={cam} />)
        )}
      </div>

      {/* Form dialog */}
      {showForm && (
        <Dialog open={showForm} onClose={() => { setShowForm(false); setSelected(null); reset() }} size="2xl">
          <DialogTitle>{selected ? 'Editar Cámara' : 'Nueva Cámara'}</DialogTitle>
          <DialogDescription>
            {selected 
              ? 'Modifica los datos de la cámara RTSP / NVR'
              : 'Completa el formulario para registrar una nueva cámara en el sistema'}
          </DialogDescription>
          <DialogBody>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {chooseCondominium && (
                <CondominiumSelect
                  {...register('organizationId')}
                  errorMessage={errors.organizationId?.message}
                  description="La cámara queda registrada en este condominio."
                />
              )}
              <Input {...register('name')} placeholder="Nombre de la cámara" />
              <Input {...register('location')} placeholder="Ubicación física" />
              <Controller
                control={control}
                name="sourceUrl"
                render={({ field }) => (
                  <UrlRevealInput
                    name={field.name}
                    value={revealedSource ?? (hasSource ? '••••••••' : (field.value || ''))}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    onReveal={selected && canRevealSource ? handleShowSource : undefined}
                    loading={loadingSource}
                    revealed={!!revealedSource}
                  />
                )}
              />
              
              {/* Role selector */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Roles con acceso</label>
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
              </div>

              {/* Switches */}
              <SwitchGroup>
                <SwitchField>
                  <Label>Habilitar análisis LPR</Label>
                  <Description>Activa el reconocimiento automático de patentes para esta cámara</Description>
                  <Controller
                    control={control}
                    name="enableLpr"
                    render={({ field }) => (
                      <Switch
                        checked={!!field.value}
                        onChange={(v: boolean) => field.onChange(!!v)}
                        name={field.name}
                      />
                    )}
                  />
                </SwitchField>
                <SwitchField>
                  <Label>Activar cámara</Label>
                  <Description>Si está desactivada, la cámara no se reproducirá ni se registrará en MediaMTX</Description>
                  <Controller
                    control={control}
                    name="active"
                    render={({ field }) => (
                      <Switch
                        checked={!!field.value}
                        onChange={(v: boolean) => field.onChange(v)}
                        name={field.name}
                      />
                    )}
                  />
                </SwitchField>
                <SwitchField>
                  <Label>Habilitar Guardián IA</Label>
                  <Description>Activa el análisis visual de intrusión y merodeo</Description>
                  <Controller
                    control={control}
                    name="enableGuardian"
                    render={({ field }) => (
                      <Switch
                        checked={!!field.value}
                        onChange={(v: boolean) => field.onChange(!!v)}
                        name={field.name}
                      />
                    )}
                  />
                </SwitchField>
              </SwitchGroup>

              <DialogActions>
                <Button type="submit" color="indigo" disabled={isSubmitting}>
                  {isSubmitting ? 'Guardando...' : (selected ? 'Guardar cambios' : 'Crear cámara')}
                </Button>
                <Button plain type="button" onClick={() => { setShowForm(false); setSelected(null); reset() }} disabled={isSubmitting}>
                  Cancelar
                </Button>
              </DialogActions>
            </form>
          </DialogBody>
        </Dialog>
      )}

      {/* Delete confirmation */}
      {showDelete && (
        <Dialog open={!!showDelete} onClose={() => setShowDelete(null)}>
          <div className="p-6">
            <DialogTitle>Eliminar cámara</DialogTitle>
            <DialogDescription className="mt-2">¿Estás seguro de eliminar <strong>{showDelete.name}</strong>? Esta acción no se puede deshacer.</DialogDescription>
            <DialogActions>
              <Button color="red" onClick={() => onDelete(showDelete.id)}>Eliminar</Button>
              <Button outline onClick={() => setShowDelete(null)}>Cancelar</Button>
            </DialogActions>
          </div>
        </Dialog>
      )}

      {/* Editor de Zonas de Intrusión (Guardián) */}
      {showZoneEditor && (
        <GuardianZoneEditor 
          camera={showZoneEditor} 
          onClose={() => setShowZoneEditor(null)} 
          onSaved={() => {
            setShowZoneEditor(null)
            queryClient.invalidateQueries({ queryKey: ['cameras'] })
          }} 
        />
      )}
    </div>
  )
}
