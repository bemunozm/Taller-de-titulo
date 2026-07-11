import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

type AnomalyEvent = {
  id: string
  anomalyType: string
  cameraId: string
  durationSeconds: number
  timestamp: string
  snapshotJpegB64: string
}

export default function AnomalyAlertModal() {
  const [anomaly, setAnomaly] = useState<AnomalyEvent | null>(null)

  useEffect(() => {
    // Determine backend URL
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
    
    // Connect to the generic root namespace or /hub if HubGateway is used
    // En este caso, el Backend emite por el servidor general (this.hubGateway.server.emit) 
    // lo cual envía a los clientes conectados al backend.
    const socketUrl = backendUrl.replace('/api/v1', '')
    
    const socket = io(socketUrl, {
      path: '/socket.io/', // default path
      transports: ['websocket', 'polling']
    })

    socket.on('connect', () => {
      console.log('✅ Consola Web conectada al WebSocket de Seguridad VigilIA')
    })
    
    socket.on('security:anomaly_detected', (data: AnomalyEvent) => {
      console.log('🚨 ANOMALIA REPORTADA DESDE EDGE:', data)
      setAnomaly(data)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  if (!anomaly) return null

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-[0_0_50px_-12px_rgba(220,38,38,0.8)] max-w-lg w-full overflow-hidden border border-red-500 zoom-in-95 duration-200">
        <div className="bg-red-600 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="h-8 w-8 text-white animate-pulse" />
            <h2 className="text-xl font-bold text-white tracking-wide">¡ALERTA DE SEGURIDAD!</h2>
          </div>
          <span className="text-red-100 text-xs font-bold uppercase py-1 px-2 bg-red-700 rounded shadow-inner">
            En Vivo
          </span>
        </div>
        
        <div className="p-6">
          <div className="mb-4">
            <p className="text-xl font-extrabold text-red-600 dark:text-red-500 uppercase mb-1 drop-shadow-sm">
              Motivo: {anomaly.anomalyType === 'loitering' ? 'Merodeo Sospechoso' : anomaly.anomalyType === 'intrusion' ? 'Intrusión Perimetral' : anomaly.anomalyType}
            </p>
            <p className="text-zinc-600 dark:text-zinc-400 font-medium">Cámara Asociada: <strong className="text-black dark:text-white capitalize">{anomaly.cameraId}</strong></p>
            <p className="text-zinc-600 dark:text-zinc-400 font-medium">Tiempo expuesto: <strong className="text-black dark:text-white">{anomaly.durationSeconds} segundos</strong></p>
          </div>
          
          {anomaly.snapshotJpegB64 && (
            <div className="relative rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black shadow-lg">
              <img 
                src={`data:image/jpeg;base64,${anomaly.snapshotJpegB64}`} 
                alt="Frame Capturada por YOLO" 
                className="w-full object-contain max-h-72"
              />
              <div className="absolute top-3 right-3 flex gap-2">
                <div className="flex items-center gap-1 bg-red-600 text-white text-[10px] uppercase font-bold px-2 py-1 rounded shadow-sm border border-red-500">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                  </span>
                  Tracker Activo
                </div>
              </div>
            </div>
          )}
          
          <div className="flex flex-col sm:flex-row items-center justify-end gap-3 mt-6">
            <button 
              onClick={() => setAnomaly(null)}
              className="w-full sm:w-auto px-4 py-2 font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors border border-transparent shadow-sm"
            >
              Descartar
            </button>
            <button 
              onClick={() => {
                setAnomaly(null)
                // Realizar logica de escalar alerta
              }}
              className="w-full sm:w-auto px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-md transition-colors border border-red-500 uppercase tracking-wide flex items-center justify-center gap-2"
            >
              <ExclamationTriangleIcon className="h-5 w-5" />
              Notificar Seguridad
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
