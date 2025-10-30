import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import CameraPlayer from '@/components/CameraPlayer'
import { listCameras } from '@/api/CameraAPI'

export default function ConserjeView() {
  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: () => listCameras() })

  // Search state (debounced + persisted)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    try {
      const last = localStorage.getItem('conserje_search') ?? ''
      if (last) setQuery(last)
    } catch {}
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      const v = query.trim().toLowerCase()
      setDebouncedQuery(v)
      try { localStorage.setItem('conserje_search', query) } catch {}
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const filtered = useMemo(() => {
    if (!debouncedQuery) return cameras
    return cameras.filter((c: any) => {
      const hay = `${c.name ?? ''} ${c.location ?? ''}`.toLowerCase()
      return hay.includes(debouncedQuery)
    })
  }, [cameras, debouncedQuery])

  // Show all cameras; render live player only for those active and registered, otherwise show placeholder with reason
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold dark:text-white">Conserje — Mosaico de cámaras</h1>

      {/* Search row aligned to the right inside the container */}
      <div className="flex justify-end mb-2">
        <div className="relative w-full sm:w-56">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M21 21l-4.35-4.35" />
            <path fill="currentColor" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
          </svg>
          <input
            aria-label="Buscar cámaras por nombre o ubicación"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o ubicación (ej: Entrada, Pasillo)"
            className="w-full rounded-md border border-zinc-700 bg-black/60 px-10 py-2 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="ml-3 text-sm text-zinc-400 hidden sm:flex items-center">{filtered.length} resultados</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {filtered.map((cam: any) => {
          const mountOrId = cam.mountPath ?? cam.id
          const isActive = cam.active === undefined || cam.active === true
          const registered = !!cam.registeredInMediamtx

          const displayName = cam.name ?? mountOrId
          const displayLocation = cam.location ?? ''
          return (
            <div key={cam.id} className="rounded-lg overflow-hidden bg-zinc-900/5 dark:bg-zinc-800">
              <div className="p-2 text-sm text-zinc-700 dark:text-zinc-300">
                <div className="font-medium truncate">{displayName}</div>
                {displayLocation ? <div className="text-xs text-zinc-500 truncate">{displayLocation}</div> : null}
              </div>
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
