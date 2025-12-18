import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import CameraPlayer from '@/components/CameraPlayer'
import { listCameras } from '@/api/CameraAPI'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid'
import { Squares2X2Icon, RectangleStackIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/Button'
import { Protected } from '@/components/auth/Protected'

type ViewMode = 'single' | 'mosaic'

export default function CamerasView() {
  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: () => listCameras() })

  // View mode state (persisted) - default is 'single'
  const [viewMode, setViewMode] = useState<ViewMode>('single')
  const [currentIndex, setCurrentIndex] = useState(0)

  // Search state (debounced + persisted)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Load preferences from localStorage
  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('cameras_view_mode') as ViewMode | null
      if (savedMode === 'single' || savedMode === 'mosaic') {
        setViewMode(savedMode)
      }
      const savedQuery = localStorage.getItem('cameras_search') ?? ''
      if (savedQuery) setQuery(savedQuery)
    } catch {}
  }, [])

  // Save view mode preference
  useEffect(() => {
    try {
      localStorage.setItem('cameras_view_mode', viewMode)
    } catch {}
  }, [viewMode])

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => {
      const v = query.trim().toLowerCase()
      setDebouncedQuery(v)
      try {
        localStorage.setItem('cameras_search', query)
      } catch {}
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

  // Single camera navigation
  const currentCamera = filtered[currentIndex]
  const prev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length))
  }, [filtered.length])

  const next = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % Math.max(1, filtered.length))
  }, [filtered.length])

  // Keyboard navigation for single mode
  useEffect(() => {
    if (viewMode !== 'single') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewMode, prev, next])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold dark:text-white">Cámaras</h1>
        
        {/* View mode toggle - Solo para Admin, Super Admin y Conserje */}
        <Protected anyRole={['Administrador', 'Super Administrador', 'Conserje']}>
          <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1">
            <Button
              plain
              onClick={() => setViewMode('single')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === 'single'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <RectangleStackIcon className="h-5 w-5" />
              <span className="hidden sm:inline ml-2">Una cámara</span>
            </Button>
            <Button
              plain
              onClick={() => setViewMode('mosaic')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === 'mosaic'
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Squares2X2Icon className="h-5 w-5" />
              <span className="hidden sm:inline ml-2">Mosaico</span>
            </Button>
          </div>
        </Protected>
      </div>

      {/* Search bar */}
      <div className="flex justify-end">
        <div className="relative w-full sm:w-56">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path fill="currentColor" d="M21 21l-4.35-4.35" />
            <path fill="currentColor" d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z" />
          </svg>
          <input
            aria-label="Buscar cámaras por nombre o ubicación"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre o ubicación"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-black/60 px-10 py-2 text-zinc-900 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="ml-3 text-sm text-zinc-400 hidden sm:flex items-center">
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'single' ? (
        /* Single Camera View */
        <div className="max-w-5xl mx-auto">
          <div className="relative rounded-lg overflow-hidden bg-black shadow-lg">
            {/* Camera label */}
            {currentCamera ? (
              <div className="absolute left-4 top-4 z-20 px-3 py-1 rounded bg-black/50 text-white text-sm max-w-[60%]">
                <div className="truncate font-medium">
                  {currentCamera.name ?? currentCamera.mountPath ?? currentCamera.id}
                </div>
                {currentCamera.location && (
                  <div className="text-xs text-zinc-300 truncate">{currentCamera.location}</div>
                )}
              </div>
            ) : null}

            {/* Previous button */}
            {filtered.length > 1 && (
              <button
                aria-label="Anterior"
                onClick={prev}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-40 rounded-full bg-black/40 p-2 hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <ChevronLeftIcon className="h-7 w-7 text-white" />
              </button>
            )}

            {/* Next button */}
            {filtered.length > 1 && (
              <button
                aria-label="Siguiente"
                onClick={next}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-40 rounded-full bg-black/40 p-2 hover:bg-black/60 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <ChevronRightIcon className="h-7 w-7 text-white" />
              </button>
            )}

            {/* Video area */}
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
                        <div className="text-sm text-zinc-500">
                          {!registered
                            ? 'No registrada en el gateway de medios'
                            : 'Marcada como inactiva'}
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-400">
                    No hay cámaras disponibles
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Camera indicators */}
          {filtered.length > 1 && (
            <div className="flex flex-col items-center gap-3 mt-4">
              <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden px-2 py-1 sm:px-0 sm:flex-wrap">
                {filtered.map((c, i) => {
                  const active = i === currentIndex
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCurrentIndex(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setCurrentIndex(i)
                        }
                      }}
                      aria-label={`Ir a ${c.name}`}
                      role="tab"
                      aria-selected={active}
                      title={`${c.name} — ${c.location}`}
                      className={`flex-shrink-0 max-w-[220px] truncate rounded-full px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                      }`}
                    >
                      <div className="whitespace-nowrap truncate">
                        {c.name} — <span className="text-xs opacity-75">{c.location}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Mosaic View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map((cam: any) => {
            const mountOrId = cam.mountPath ?? cam.id
            const isActive = cam.active === undefined || cam.active === true
            const registered = !!cam.registeredInMediamtx
            const displayName = cam.name ?? mountOrId
            const displayLocation = cam.location ?? ''

            return (
              <div
                key={cam.id}
                className="rounded-lg overflow-hidden bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700"
              >
                <div className="p-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <div className="font-medium truncate">{displayName}</div>
                  {displayLocation && (
                    <div className="text-xs text-zinc-500 truncate">{displayLocation}</div>
                  )}
                </div>
                <div className="h-48 bg-black relative">
                  {isActive && registered ? (
                    <CameraPlayer cameraId={mountOrId} />
                  ) : (
                    <div className="h-full w-full flex flex-col items-center justify-center text-zinc-400 p-4 space-y-2 text-center">
                      <div className="text-base font-medium">Cámara no disponible</div>
                      <div className="text-sm text-zinc-500">
                        {!registered
                          ? 'No registrada en el gateway de medios'
                          : 'Marcada como inactiva'}
                      </div>
                      <div className="mt-1 text-[10px] px-2 py-1 rounded-full bg-zinc-800 text-zinc-300">
                        {!registered ? 'No registrada' : 'Inactiva'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
