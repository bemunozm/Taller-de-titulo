import { useQuery } from '@tanstack/react-query'
import CameraPlayer from '@/components/CameraPlayer'
import { listCameras } from '@/api/CameraAPI'

export default function ConserjeView() {
  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: () => listCameras() })

  // Show all cameras; render live player only for those active and registered, otherwise show placeholder with reason
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold dark:text-white">Conserje — Mosaico de cámaras</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cameras.map((cam: any) => {
          const mountOrId = cam.mountPath ?? cam.id
          const isActive = cam.active === undefined || cam.active === true
          const registered = !!cam.registeredInMediamtx

          return (
            <div key={cam.id} className="rounded-lg overflow-hidden bg-zinc-900/5 dark:bg-zinc-800">
              <div className="p-2 text-sm text-zinc-700 dark:text-zinc-300">{mountOrId}</div>
              <div className="h-48 bg-black relative">
                {isActive && registered ? (
                  <CameraPlayer cameraId={mountOrId} />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center text-zinc-400 p-4 space-y-2 text-center">
                    <div className="text-base font-medium">Cámara no disponible</div>
                    <div className="text-sm text-zinc-500">
                      {!registered ? 'No registrada en el gateway de medios' : 'Marcada como inactiva'}
                    </div>
                    <div className="mt-1 text-[10px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-300">{!registered ? 'No registrada' : 'Inactiva'}</div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
