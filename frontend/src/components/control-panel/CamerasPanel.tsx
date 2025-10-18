import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Dialog, DialogTitle, DialogDescription, DialogActions } from '@/components/ui/Dialog'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listCameras, createCamera, updateCamera, deleteCamera, registerCamera, getCameraSourceUrl, getCameraHasSource } from '@/api/CameraAPI'
import { listRoles } from '@/api/RoleAPI'
import type { Role } from '@/types/index'
import MultiSelectCombobox from '@/components/ui/MultiSelectCombobox'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createCameraSchema } from '@/types/index'
import type { CreateCameraFormData, UpdateCameraFormData, Camera } from '@/types/index'
import { toast } from 'react-toastify'
import UrlRevealInput from '@/components/ui/UrlRevealInput'

export default function CamerasPanel() {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Camera | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showDelete, setShowDelete] = useState<Camera | null>(null)

  const { data: cameras = [], isLoading } = useQuery<Camera[], Error>({ queryKey: ['cameras'], queryFn: () => listCameras() })
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

  const { register, handleSubmit, reset, setValue, control } = useForm<CreateCameraFormData>({
    resolver: zodResolver(createCameraSchema),
  })

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
        await updateMut.mutateAsync({ id: selected.id, payload: data as UpdateCameraFormData })
      } else {
        await createMut.mutateAsync(data)
      }
      setShowForm(false)
      setSelected(null)
      reset()
    } catch (err) {
      console.error(err)
    }
  }

  const onDelete = async (id: string) => {
    try {
      await deleteMut.mutateAsync(id)
      setShowDelete(null)
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold dark:text-white">Administrar cámaras</h3>
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
            <div key={cam.id} className="flex items-center justify-between rounded-md border border-zinc-800 p-3 bg-zinc-900">
              <div>
                <div className="font-medium text-zinc-100">{cam.name || '(sin nombre)'}</div>
                <div className="text-sm text-gray-400">{(cam as any).location} — {cam.mountPath}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button outline className="text-white" onClick={() => { setSelected(cam); setShowForm(true) }}>Editar</Button>
                <Button outline onClick={() => registerMut.mutate(cam.id)}>Registrar</Button>
                <Button color="red" onClick={() => setShowDelete(cam)}>Eliminar</Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Form dialog */}
      {showForm && (
        <Dialog open={showForm} onClose={() => { setShowForm(false); setSelected(null); reset() }}>
          <div className="p-6">
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

              <DialogActions>
                <Button type="submit">Guardar</Button>
                <Button outline type="button" onClick={() => { setShowForm(false); setSelected(null); reset() }}>Cancelar</Button>
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
