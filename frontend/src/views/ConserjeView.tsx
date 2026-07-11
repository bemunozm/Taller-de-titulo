import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import CameraPlayer from '@/components/CameraPlayer'
import { listCameras } from '@/api/CameraAPI'
import { io, Socket } from 'socket.io-client'

type ActiveAlert = {
  suspicionLevel: string
  type: string
  timestamp: number
  reasoning?: string
}

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

  // WebSocket silencioso para Sala de Conserjería
  const [activeAlerts, setActiveAlerts] = useState<Record<string, ActiveAlert>>({})
  const [isSocketConnected, setIsSocketConnected] = useState(false)
  const [socketError, setSocketError] = useState<string | null>(null)

  useEffect(() => {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
    const socketUrl = backendUrl.replace('/api/v1', '')
    
    const socket: Socket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })

    socket.on('connect', () => {
      // Unirse a la sala para recibir detecciones filtradas
      console.log('✅ Conserjería conectada al WebSocket')
      setIsSocketConnected(true)
      setSocketError(null)
      socket.emit('join_room', { room: 'conserje_room' })
    })

    socket.on('disconnect', (reason) => {
      console.warn('❌ Conserjería desconectada:', reason)
      setIsSocketConnected(false)
    })

    socket.on('connect_error', (error) => {
      console.error('⚠️ Error de conexión Conserjería:', error)
      setIsSocketConnected(false)
      setSocketError('Fallo conectando al servidor de Alertas')
    })

    socket.on('security:anomaly_highlight', (data: any) => {
      console.log('👀 AVISO AL CONSERJE (IA Vision):', data)
      setActiveAlerts((prev) => ({
        ...prev,
        [data.cameraId]: {
          suspicionLevel: data.suspicionLevel || 'MEDIUM',
          type: data.anomalyType,
          timestamp: Date.now(),
          reasoning: data.reasoning
        }
      }))
    })

    return () => {
      socket.emit('leave_room', { room: 'conserje_room' })
      socket.off('connect')
      socket.off('disconnect')
      socket.off('connect_error')
      socket.off('security:anomaly_highlight')
      socket.disconnect()
    }
  }, [])

  // Auto-limpiar alertas viejas (ej: después de 15 segundos)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setActiveAlerts(prev => {
        let changed = false
        const next = { ...prev }
        for (const camId in next) {
          if (now - next[camId].timestamp > 15000) {
            delete next[camId]
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [])

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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <h1 className="text-2xl font-semibold dark:text-white flex items-center gap-3">
          Conserje — Mosaico de cámaras
          
          {/* Status Badge */}
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full border border-zinc-200 dark:border-zinc-700">
            {isSocketConnected ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Inteligencia Activa</span>
              </>
            ) : (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-red-500"></span>
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  {socketError ? 'Reconectando...' : 'Sin conexión IA'}
                </span>
              </>
            )}
          </div>
        </h1>
      </div>

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
              
              {(() => {
                const alert = activeAlerts[cam.id]
                let borderClass = 'border-transparent'
                let badgeColor = ''
                let badgeText = ''
                let shadowClass = ''

                if (alert) {
                  const isHigh = alert.suspicionLevel === 'HIGH'
                  const isLow = alert.suspicionLevel === 'LOW'
                  
                  if (isHigh) {
                    borderClass = 'border-red-500 border-2 animate-pulse'
                    badgeColor = 'bg-red-600 text-white'
                    shadowClass = 'shadow-[0_0_15px_rgba(239,68,68,0.5)]'
                  } else if (isLow) {
                    borderClass = 'border-yellow-500 border'
                    badgeColor = 'bg-yellow-500 text-black'
                    shadowClass = 'shadow-[0_0_10px_rgba(234,179,8,0.3)]'
                  } else {
                    borderClass = alert.type === 'intrusion' ? 'border-orange-500 border-2 border-dashed' : 'border-orange-500 border-2'
                    badgeColor = 'bg-orange-500 text-white'
                    shadowClass = 'shadow-[0_0_15px_rgba(249,115,22,0.5)]'
                  }
                  
                  badgeText = alert.type === 'intrusion' ? 'INTRUSIÓN' : 'MERODEO'
                }

                return (
                  <div className={`relative h-48 bg-black transition-all duration-300 ${borderClass} ${shadowClass}`}>
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
                    
                    {/* Badge UI if alert exists */}
                    {alert && (
                      <div className="absolute top-2 right-2">
                        <div className="group relative">
                          <span className={`px-2 py-1 text-[10px] font-bold uppercase rounded shadow-md ${badgeColor}`}>
                            {badgeText} ({alert.suspicionLevel})
                          </span>
                          {/* Tooltip con el reasoning de la IA */}
                          <div className="absolute top-full right-0 mt-2 w-48 p-2 bg-black/90 text-white text-[10px] rounded shadow-xl border border-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                            {alert.reasoning}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })}
      </div>
    </div>
  )
}
