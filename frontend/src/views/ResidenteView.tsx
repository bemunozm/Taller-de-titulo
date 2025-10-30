import { useCallback, useEffect, useMemo, useState } from 'react'
import CameraPlayer from '@/components/CameraPlayer'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import { useQuery } from '@tanstack/react-query'
import { listCameras } from '@/api/CameraAPI'

export default function ResidenteView() {
  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: () => listCameras() })

  // Include all cameras in navigation/search, but only play those active+registered
  const [index, setIndex] = useState(0)
  const currentCamera = cameras[index]
  // Prefer mountPath (the path registered in MediaMTX) when available; fall back to id
  const current = currentCamera?.mountPath ?? currentCamera?.id ?? ''

  // search
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  // load last query from localStorage
  useEffect(() => {
    try {
      const last = localStorage.getItem('resident_search') ?? ''
      if (last) setQuery(last)
    } catch {}
  }, [])
  useEffect(() => {
    const t = setTimeout(() => {
      const v = query.trim().toLowerCase()
      setDebouncedQuery(v)
      try { localStorage.setItem('resident_search', query) } catch {}
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const filtered = useMemo(() => {
    // search across all cameras (we'll render placeholders for unavailable ones)
    if (!debouncedQuery) return cameras
    return cameras.filter((c) => {
      const hay = `${c.name} ${c.location}`.toLowerCase()
      return hay.includes(debouncedQuery)
    })
  }, [cameras, debouncedQuery])

  const prev = useCallback(() => setIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length)), [filtered.length])
  const next = useCallback(() => setIndex((i) => (i + 1) % Math.max(1, filtered.length)), [filtered.length])

  // navigation keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold dark:text-white">Residente — Cámara</h1>

      <div className="max-w-5xl mx-auto">
        {/* Search row aligned to the right inside the centered container */}
        <div className="flex justify-end mb-4">
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

        <div className="relative rounded-lg overflow-hidden bg-black shadow-lg">
          {/* etiqueta de cámara */}
          {currentCamera ? (
            (() => {
              const mountOrId = currentCamera.mountPath ?? currentCamera.id
              const displayName = currentCamera.name ?? mountOrId
              const displayLocation = currentCamera.location ?? ''
              return (
                <div className="absolute left-4 top-4 z-20 px-3 py-1 rounded bg-black/50 text-white text-sm max-w-[60%]">
                  <div className="truncate font-medium">{displayName}</div>
                  {displayLocation ? <div className="text-xs text-zinc-300 truncate">{displayLocation}</div> : null}
                </div>
              )
            })()
          ) : (
            <div className="absolute left-4 top-4 z-20 px-3 py-1 rounded bg-black/50 text-white text-sm">{current}</div>
          )}

          {/* botón anterior */}
          <button
            aria-label="Anterior"
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-40 rounded-full bg-black/40 p-2 hover:bg-black/60 focus:outline-none"
          >
            <ChevronLeftIcon className="h-7 w-7 text-white" />
          </button>

          {/* botón siguiente */}
          <button
            aria-label="Siguiente"
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-40 rounded-full bg-black/40 p-2 hover:bg-black/60 focus:outline-none"
          >
            <ChevronRightIcon className="h-7 w-7 text-white" />
          </button>

          {/* área de video */}
          <div className="w-full h-[60vh]">
          <div className="h-full">
            {currentCamera ? (
              (() => {
                const mountOrId = currentCamera.mountPath ?? currentCamera.id
                const isActive = currentCamera.active === undefined || currentCamera.active === true
                const registered = !!currentCamera.registeredInMediamtx
                if (isActive && registered) {
                  return <CameraPlayer key={mountOrId} cameraId={mountOrId} />
                }
                return (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 p-4 space-y-2 text-center">
                    <div className="text-lg font-medium">Cámara no disponible</div>
                    <div className="text-sm text-zinc-500">{!registered ? 'No registrada en el gateway de medios' : 'Marcada como inactiva'}</div>
                  </div>
                )
              })()
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-400">No hay cámaras disponibles</div>
            )}
          </div>
          </div>
        </div>

        {/* indicadores */}
        <div className="flex flex-col items-center gap-3 mt-4">
          <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden px-2 py-1 sm:px-0 sm:flex-wrap">
            {filtered.map((c) => {
              const i = filtered.findIndex((a) => a.id === c.id)
              const active = i === index
              return (
                <button
                  key={c.id}
                  onClick={() => setIndex(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIndex(i); } }}
                  aria-label={`Ir a ${c.name}`}
                  role="tab"
                  aria-selected={active}
                  title={`${c.name} — ${c.location}`}
                  className={`flex-shrink-0 max-w-[220px] truncate rounded-full px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${active ? 'bg-blue-600 text-white' : 'bg-zinc-700 text-zinc-200'}`}
                >
                  <div className="whitespace-nowrap truncate">{c.name} — <span className="text-zinc-400 text-xs">{c.location}</span></div>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
