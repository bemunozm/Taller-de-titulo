import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Dialog, DialogTitle, DialogDescription, DialogActions } from '@/components/ui/Dialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listCameras, createCamera, updateCamera, deleteCamera, registerCamera, getCameraSourceUrl, getCameraHasSource, getCameraRecentEventsCount, getIAHealth, getMediamtxHealth } from '@/api/CameraAPI'
import { listRoles } from '@/api/RoleAPI'
import type { Role } from '@/types/index'
import MultiSelectCombobox from '@/components/ui/MultiSelectCombobox'
import { useForm, Controller } from 'react-hook-form'
import type { CreateCameraFormData, UpdateCameraFormData, Camera } from '@/types/index'
import { toast } from 'react-toastify'
import { Switch, SwitchField, SwitchGroup } from '@/components/ui/Switch'
import { Label, Description } from '@/components/ui/Fieldset'
import UrlRevealInput from '@/components/ui/UrlRevealInput'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/ui/Dropdown'
import { EllipsisHorizontalIcon } from '@heroicons/react/20/solid'

export default function CamerasPanel() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Camera | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showDelete, setShowDelete] = useState<Camera | null>(null)

  const { data: cameras = [], isLoading } = useQuery<Camera[], Error>({ queryKey: ['cameras'], queryFn: () => listCameras() })
  const { data: iaHealth } = useQuery({ queryKey: ['ia-health'], queryFn: () => getIAHealth(), staleTime: 30_000, refetchOnWindowFocus: false, retry: false })
  const { data: mediamtxHealth } = useQuery({ queryKey: ['mediamtx-health'], queryFn: () => getMediamtxHealth(), staleTime: 30_000, refetchOnWindowFocus: false, retry: false })
  const { data: roles = [] as Role[] } = useQuery<Role[], Error>({ queryKey: ['roles'], queryFn: () => listRoles() })

  const createMut = useMutation<any, Error, CreateCameraFormData>({
    mutationFn: (payload) => createCamera(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Cámara creada')
    },
    onError: (err: any) => toast.error(err?.message || 'Error al crear cámara'),
  })

  const updateMut = useMutation<any, Error, { id: string; payload: UpdateCameraFormData }>({
    mutationFn: ({ id, payload }) => updateCamera(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Cámara actualizada')
    },
    onError: (err: any) => toast.error(err?.message || 'Error al actualizar cámara'),
  })

  const deleteMut = useMutation<any, Error, string>({
    mutationFn: (id) => deleteCamera(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Cámara eliminada')
    },
    onError: (err: any) => toast.error(err?.message || 'Error al eliminar cámara'),
  })

  const registerMut = useMutation<any, Error, string>({
    mutationFn: (id) => registerCamera(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] })
      toast.success('Registro enviado a MediaMTX')
    },
    onError: (err: any) => toast.error(err?.message || 'Error al registrar en MediaMTX'),
  })

  const { register, handleSubmit, reset, setValue, control } = useForm<CreateCameraFormData>({})


  const [loadingSource, setLoadingSource] = useState(false)
  const [hasSource, setHasSource] = useState(false)
  const [revealedSource, setRevealedSource] = useState<string | null>(null)

  

  useEffect(() => {
    if (selected) {
      // populate form
      setValue('name', selected.name)
      setValue('location', (selected as any).location || '')
      // do not auto-fetch sourceUrl for privacy; only mark masked if exists
      setValue('sourceUrl', '')
      setRevealedSource(null)
      ;(async () => {
        try {
          const r = await getCameraHasSource(selected.id)
          setHasSource(!!r?.hasSource)
        } catch (err) {
          setHasSource(false)
        }
      })()
      
      // populate roleIds if roles are attached
      if ((selected as any).roles?.length) {
        const ids = (selected as any).roles.map((r: Role) => r.id)
        setValue('roleIds', ids)
      } else {
        setValue('roleIds', [])
      }
      // populate enableLpr flag
  setValue('enableLpr', (selected as any).enableLpr ?? false)
  // populate active flag: backend may treat undefined as active, but for editing we want explicit value
  setValue('active', (selected as any).active === undefined ? true : !!(selected as any).active)
    } else {
      reset()
    }
  }, [selected, setValue, reset])

  const handleShowSource = async () => {
    if (!selected) return
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
    } catch (err: any) {
      toast.error(err?.message || 'No fue posible obtener la URL de la cámara')
    } finally {
      setLoadingSource(false)
    }
  }

  const onSubmit = async (data: CreateCameraFormData) => {
    try {
      if (selected && selected.id) {
        // Build update payload: remove keys that should not be sent or are empty
        const payload: UpdateCameraFormData = { ...(data as UpdateCameraFormData) }

  // Send `active` explicitly so backend updates the value (true/false)

        // If sourceUrl provided via revealedSource, prefer that; otherwise if empty remove
        if (revealedSource) {
          payload.sourceUrl = revealedSource
        } else if (!payload.sourceUrl) {
          delete (payload as any).sourceUrl
        }

        // remove empty roleIds
        if (Array.isArray(payload.roleIds) && payload.roleIds.length === 0) delete (payload as any).roleIds

        await updateMut.mutateAsync({ id: selected.id, payload })
      } else {
        // Manual validation for create: require sourceUrl and name
        const toCreate: CreateCameraFormData = { ...(data as CreateCameraFormData) }
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
    } catch (err) {
      console.error(err)
      try { toast.error((err as any)?.message || 'Error procesando la solicitud') } catch {}
    }
  }

  const isSubmitting = (createMut as any).isLoading || (updateMut as any).isLoading || createMut.status === 'pending' || updateMut.status === 'pending'

  const onDelete = async (id: string) => {
    try {
      await deleteMut.mutateAsync(id)
      setShowDelete(null)
    } catch (err) {
      console.error(err)
    }
  }

  // Subcomponent: single camera card that requests events count per camera
  function CameraCard({ cam }: { cam: Camera }) {
    // const { data: eventsData } = useQuery<{ recentEvents: number }, Error>({
    //   queryKey: ['camera-events-count', cam.id],
    //   queryFn: () => getCameraRecentEventsCount(cam.id),
    //   staleTime: 30_000,
    //   refetchOnWindowFocus: false,
    //   retry: false,
    // })

    // // We'll use global iaHealth (from parent) to display general worker state elsewhere.

    // const eventsCount = (eventsData as any)?.recentEvents ?? null
    // const eventsBadge = (
    //   <div title="Eventos recientes" className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-200">{eventsCount !== null ? `Eventos: ${eventsCount}` : 'Eventos: —'}</div>
    // )

    return (
      <div className="flex flex-row items-center justify-between gap-3 rounded-md border border-zinc-800 p-3 bg-zinc-900">
        <div className="flex-1 min-w-0">
          <div className="flex flex-col">
            <div className="font-medium text-zinc-100 truncate max-w-full">{cam.name || '(sin nombre)'}</div>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              { (cam as any).active === false ? (
                <div title="Cámara marcada como inactiva" aria-label="Inactiva" className="text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white">Inactiva</div>
              ) : (
                <>
                  { (cam as any).registeredInMediamtx ? (
                    <div title="Registrada en MediaMTX" aria-label="Registrada en MediaMTX" className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">MediaMTX</div>
                  ) : (
                    <div title="No registrada en MediaMTX" aria-label="No registrada en MediaMTX" className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-200">No MTX</div>
                  ) }
                  { (cam as any).enableLpr ? (
                    <div title="LPR habilitado" aria-label="LPR activado" className="text-[11px] px-2 py-0.5 rounded-full bg-blue-600 text-white">LPR</div>
                  ) : null }
                  {/* events count */}
                  {/* {eventsBadge} */}
                </>
              )}
            </div>
            <div className="text-sm text-gray-400 mt-2">{(cam as any).location} — {cam.mountPath}</div>
          </div>
        </div>
        <div className="flex-shrink-0 ml-4">
          <Dropdown>
            <DropdownButton plain aria-label="Más opciones" as={Button} className="p-2">
              <EllipsisHorizontalIcon className="h-5 w-5 text-zinc-300" />
            </DropdownButton>
            <DropdownMenu>
              <DropdownItem onClick={() => { setSelected(cam); setShowForm(true) }}>Editar</DropdownItem>
              <DropdownItem onClick={() => registerMut.mutate(cam.id)}>Registrar</DropdownItem>
              <DropdownItem onClick={() => setShowDelete(cam)}>Eliminar</DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold dark:text-white">Administrar cámaras</h3>
          {/* Global IA worker status badge */}
          {iaHealth ? (
            iaHealth.ok ? (
              <div title={`Motor IA: ${iaHealth.status}`} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">Motor IA: Activo</div>
            ) : (
              <div title={`Motor IA: ${iaHealth.status}`} className="text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white">Motor IA: Inactivo</div>
            )
          ) : (
            <div title="Estado IA desconocido" className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-200">Motor IA: —</div>
          )}
          {/* MediaMTX global status */}
          {mediamtxHealth ? (
            mediamtxHealth.ok ? (
              <div title={`MediaMTX: ${mediamtxHealth.status}`} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">MediaMTX: Activo</div>
            ) : (
              <div title={`MediaMTX: ${mediamtxHealth.message ?? mediamtxHealth.status}`} className="text-[11px] px-2 py-0.5 rounded-full bg-red-600 text-white">MediaMTX: Inactivo</div>
            )
          ) : (
            <div title="Estado MediaMTX desconocido" className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-200">MediaMTX: —</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button color="indigo" onClick={() => { setSelected(null); setShowForm(true) }}>Agregar cámara</Button>
        </div>
      </div>

      <p className="text-sm text-gray-400 mt-2">Registra cámaras RTSP/NVR indicando nombre, ubicación y credenciales.</p>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <div>Cargando cámaras...</div>
        ) : (
          cameras.map((cam: Camera) => (
            <CameraCard key={cam.id} cam={cam} />
          ))
        )}
      </div>

      {/* Form dialog */}
      {showForm && (
        <Dialog open={showForm} onClose={() => { setShowForm(false); setSelected(null); reset() }}>
          <div className="p-4 sm:p-6">
            <DialogTitle>Agregar / editar cámara</DialogTitle>
            <DialogDescription className="mt-2">Completa los datos de la cámara RTSP / NVR.</DialogDescription>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-4 space-y-3">
              <Input {...register('name')} placeholder="Nombre" />
              <Input {...register('location')} placeholder="Ubicación" />
              <Controller
                control={control}
                name="sourceUrl"
                render={({ field }) => (
                  <UrlRevealInput
                    name={field.name}
                    value={revealedSource ?? (hasSource ? '••••••••' : (field.value || ''))}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    onReveal={handleShowSource}
                    loading={loadingSource}
                    revealed={!!revealedSource}
                  />
                )}
              />
              {/* role selector: searchable multi-checkbox list controlled via react-hook-form Controller */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Roles</label>
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

              {/* Switches: LPR and Active (moved to the end of the form) */}
              <SwitchGroup>
                <SwitchField>
                  <Label>Habilitar análisis LPR</Label>
                  <Description>Habilita el análisis LPR (reconocimiento de patentes) para esta cámara.</Description>
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
                  <Description>Si está desactivada, la cámara no se reproducirá ni se registrará en MediaMTX.</Description>
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
              </SwitchGroup>

              <DialogActions>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
                  <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting}>{isSubmitting ? 'Guardando...' : 'Guardar'}</Button>
                  <Button outline type="button" onClick={() => { setShowForm(false); setSelected(null); reset() }} className="w-full sm:w-auto" disabled={isSubmitting}>Cancelar</Button>
                </div>
              </DialogActions>
            </form>
          </div>
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
    </div>
  )
}
