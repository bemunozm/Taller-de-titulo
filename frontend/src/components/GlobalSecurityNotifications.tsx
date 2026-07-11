import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { Alert, AlertTitle, AlertDescription, AlertBody, AlertActions } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Text } from '@/components/ui/Text'

type AnomalyData = {
  id: string
  cameraId: string
  anomalyType: string
  suspicionLevel: 'HIGH' | 'MEDIUM' | 'LOW'
  reasoning: string
  snapshotJpegB64: string
  timestamp: string | number
}

export default function GlobalSecurityNotifications() {
  const [activeAlert, setActiveAlert] = useState<AnomalyData | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(() => {
    const backendUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'
    const socketUrl = backendUrl.replace('/api/v1', '')
    
    // Conectarse al socket global
    const socket: Socket = io(socketUrl, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => {
      console.log('📡 GlobalSecurityNotifications: Conectado')
      socket.emit('join_room', { room: 'conserje_room' })
    })

    // Escuchar el evento de resaltado (que es el que viene evaluado por IA)
    socket.on('security:anomaly_highlight', (data: AnomalyData) => {
      console.log('🚨 GLOBAL ALERT RECEIVED:', data)
      
      // Solo abrir modal ruidoso para niveles HIGH y MEDIUM
      if (data.suspicionLevel === 'HIGH' || data.suspicionLevel === 'MEDIUM') {
        setActiveAlert(data)
        setIsModalOpen(true)
        
        // Reproducir sonido de alerta si es posible
        try {
          const audio = new Audio('/alert-security.mp3') // Asumimos que existe o fallback silencioso
          audio.play().catch(() => {})
        } catch {}
      }
    })

    return () => {
      socket.emit('leave_room', { room: 'conserje_room' })
      socket.disconnect()
    }
  }, [])

  const closeModal = () => {
    setIsModalOpen(false)
    // No limpiamos el activeAlert de inmediato para evitar que el contenido "desaparezca" durante la animación de cierre
  }

  if (!activeAlert) return null

  const isHigh = activeAlert.suspicionLevel === 'HIGH'
  
  return (
    <Alert open={isModalOpen} onClose={closeModal} size="md">
      <AlertTitle className="flex items-center gap-2">
        <span className={isHigh ? "text-red-500" : "text-orange-500"}>
          {isHigh ? "🚨 ALERTA CRÍTICA" : "⚠️ ACTIVIDAD SOSPECHOSA"}
        </span>
        <Badge color={isHigh ? 'red' : 'orange'} className="ml-auto">
          IA: {activeAlert.suspicionLevel}
        </Badge>
      </AlertTitle>
      
      <AlertBody>
        <div className="space-y-4">
          <div className="aspect-video bg-black rounded-lg overflow-hidden border border-zinc-700">
            {activeAlert.snapshotJpegB64 && (
              <img 
                src={`data:image/jpeg;base64,${activeAlert.snapshotJpegB64}`} 
                alt="Snaphost de anomalía"
                className="w-full h-full object-contain"
              />
            )}
          </div>
          
          <div>
            <Text className="font-bold text-zinc-900 dark:text-white">
              Detección: {activeAlert.anomalyType === 'intrusion' ? 'Intrusión en zona prohibida' : 'Merodeo prolongado'}
            </Text>
            <Text className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Cámara ID: <span className="font-mono text-xs">{activeAlert.cameraId}</span>
            </Text>
          </div>

          <div className="p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-md border border-zinc-100 dark:border-zinc-700 italic text-sm">
            "{activeAlert.reasoning}"
          </div>
        </div>
      </AlertBody>
      
      <AlertActions>
        <Button onClick={closeModal} color={isHigh ? 'red' : 'zinc'}>
          Entendido / Cerrar
        </Button>
      </AlertActions>
    </Alert>
  )
}
