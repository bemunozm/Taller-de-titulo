import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useNotifications } from '@/hooks/useNotifications'
import type { AppNotification } from '@/types/index'
import * as PendingDetectionsAPI from '@/api/PendingDetectionsAPI'
import { isPendingAlreadyRespondedError } from '@/api/PendingDetectionsAPI'
import { 
  TruckIcon, 
  ClockIcon, 
  CameraIcon,
  ExclamationTriangleIcon,
  ShieldExclamationIcon
} from '@heroicons/react/24/outline'

interface PendingDetectionData {
  attemptId: string
  detectionId: string
  plate: string
  reason: string
  fullFramePath?: string
  timestamp: Date
  notificationId: string
  expiresAt: Date
}

export function UnknownVehicleApprovalDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const [detectionData, setDetectionData] = useState<PendingDetectionData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<{ active: boolean; reason?: string } | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  
  // Usar useRef para trackear notificaciones procesadas sin causar re-renders
  const processedNotificationsRef = useRef<Set<string>>(new Set())
  
  const { notifications, markAsRead } = useNotifications()
  const queryClient = useQueryClient()

  useEffect(() => {
    // No procesar si el modal ya está abierto o está procesando
    if (isOpen || isProcessing) {
      return
    }

    // Filtrar notificaciones de vehículos no reconocidos que requieren acción
    const unknownVehicleNotifications = notifications.filter(
      (n: AppNotification) =>
        n.payload.type === 'UNKNOWN_VEHICLE' &&
        n.payload.data?.requiresAction &&
        !n.read &&
        n.payload.data?.expiresAt &&
        new Date(n.payload.data.expiresAt as string) > new Date() && // Solo notificaciones no expiradas
        !processedNotificationsRef.current.has(n.id) // No mostrar notificaciones ya procesadas
    )

    // Mostrar la primera notificación pendiente que no haya sido procesada
    if (unknownVehicleNotifications.length > 0) {
      const notification = unknownVehicleNotifications[0]
      
      // Marcar como procesada inmediatamente usando ref
      processedNotificationsRef.current.add(notification.id)

      const data = notification.payload.data as {
        attemptId: string
        detectionId: string
        plate: string
        reason: string
        fullFramePath?: string
        expiresAt: string
      }

      setDetectionData({
        attemptId: data.attemptId,
        detectionId: data.detectionId,
        plate: data.plate,
        reason: data.reason,
        fullFramePath: data.fullFramePath,
        timestamp: notification.payload.timestamp || new Date(),
        notificationId: notification.id,
        expiresAt: new Date(data.expiresAt),
      })

      // Validar que la detección esté activa antes de mostrar
      validateDetection(data.attemptId)
      
      setIsOpen(true)
      setError(null)
      setImageLoaded(false)
    }
  }, [notifications, isOpen, isProcessing])

  const validateDetection = async (attemptId: string) => {
    try {
      const status = await PendingDetectionsAPI.checkPendingDetectionStatus(attemptId)
      setSessionStatus(status)
      
      if (!status.active) {
        setError(status.reason || 'La detección ya no está activa')
      }
    } catch {
      setError('No se pudo validar el estado de la detección')
      setSessionStatus({ active: false, reason: 'Error de conexión' })
    }
  }

  const respond = async (decision: 'approved' | 'denied') => {
    if (!detectionData) return

    // Verificar que la detección esté activa
    if (!sessionStatus?.active) {
      setError(sessionStatus?.reason || 'La detección no está activa')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      await PendingDetectionsAPI.respondToPendingDetection(
        detectionData.attemptId,
        decision,
        decision === 'approved' ? 'Aprobado manualmente por conserje' : 'Rechazado manualmente por conserje'
      )
      
      // Marcar la notificación como leída
      await markAsRead(detectionData.notificationId)
      
      // Cerrar y limpiar
      closeModal()
    } catch (err) {
      const message = err instanceof Error && err.message
        ? err.message
        : decision === 'approved' ? 'Error al aprobar el acceso' : 'Error al rechazar el acceso'

      if (isPendingAlreadyRespondedError(err)) {
        // Ya la respondió otra sesión: la notificación ya no pide acción y
        // los botones quedan deshabilitados con el motivo a la vista.
        setSessionStatus({ active: false, reason: message })
        await markAsRead(detectionData.notificationId)
      }
      setError(message)
    } finally {
      setIsProcessing(false)
      // Con éxito o con 409, la lista de detecciones cambió.
      queryClient.invalidateQueries({ queryKey: ['detections'] })
    }
  }

  const handleApprove = () => respond('approved')
  const handleReject = () => respond('denied')

  const closeModal = () => {
    setIsOpen(false)
    // Dar un pequeño delay antes de limpiar los datos para la animación
    setTimeout(() => {
      setDetectionData(null)
      setSessionStatus(null)
      setError(null)
      setImageLoaded(false)
    }, 300)
  }

  const handleClose = () => {
    if (!isProcessing) {
      // Si se cierra sin procesar, sigue en la lista de procesadas para evitar spam
      closeModal()
    }
  }

  if (!detectionData) return null

  const timeAgo = Math.floor((Date.now() - detectionData.timestamp.getTime()) / 1000)
  const timeText = timeAgo < 60 
    ? `Hace ${timeAgo} segundos` 
    : `Hace ${Math.floor(timeAgo / 60)} minuto${Math.floor(timeAgo / 60) !== 1 ? 's' : ''}`

  // Calcular tiempo restante hasta la expiración
  const expiresIn = Math.floor((detectionData.expiresAt.getTime() - Date.now()) / 1000)
  const expiresText = expiresIn > 60 
    ? `${Math.floor(expiresIn / 60)} minuto${Math.floor(expiresIn / 60) !== 1 ? 's' : ''}` 
    : `${expiresIn} segundos`
  const isExpiringSoon = expiresIn < 300 // Menos de 5 minutos

  return (
    <Dialog open={isOpen} onClose={handleClose}>
      <DialogTitle className="flex items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30">
          <ShieldExclamationIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            Vehículo No Reconocido
          </div>
          <div className="flex items-center gap-2 mt-1">
            <ClockIcon className="w-4 h-4 text-zinc-400" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {timeText}
            </span>
          </div>
        </div>
      </DialogTitle>
      
      <DialogDescription>
        Se detectó un vehículo que no está registrado como residente ni tiene visita autorizada. Por favor, revisa la información y decide si deseas aprobar o rechazar el acceso.
      </DialogDescription>

      <DialogBody>
        <div className="space-y-4">
          {/* Advertencia de detección inactiva */}
          {sessionStatus && !sessionStatus.active && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-red-900 dark:text-red-100">
                  Detección Inactiva
                </h4>
                <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                  {sessionStatus.reason}
                </p>
              </div>
            </div>
          )}

          {/* Advertencia de expiración cercana */}
          {isExpiringSoon && sessionStatus?.active && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <ClockIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Tiempo Limitado
                </h4>
                <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                  Esta detección expira en {expiresText}. Toma una decisión pronto.
                </p>
              </div>
            </div>
          )}

          {/* Patente detectada */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <TruckIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                Patente Detectada
              </p>
              <p className="font-mono font-bold text-lg text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-900 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600 inline-block">
                {detectionData.plate}
              </p>
            </div>
          </div>

          {/* Razón */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <ExclamationTriangleIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                Motivo
              </p>
              <p className="text-sm text-zinc-900 dark:text-zinc-100">
                {detectionData.reason}
              </p>
            </div>
          </div>

          {/* Imagen capturada */}
          {detectionData.fullFramePath && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <CameraIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-2">
                  Imagen Capturada (click para ampliar)
                </p>
                <div className="relative rounded-lg overflow-hidden border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 cursor-pointer hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors">
                  {!imageLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center min-h-[200px]">
                      <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-600"></div>
                        <p className="text-xs text-zinc-500">Cargando imagen...</p>
                      </div>
                    </div>
                  )}
                  <img 
                    src={detectionData.fullFramePath} 
                    alt="Vehículo detectado" 
                    className={`w-full h-auto transition-all duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'} hover:scale-105`}
                    onLoad={() => setImageLoaded(true)}
                    onClick={() => window.open(detectionData.fullFramePath, '_blank')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <p className="text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            </div>
          )}
        </div>
      </DialogBody>

      <DialogActions>
        <Button 
          plain 
          onClick={handleClose}
          disabled={isProcessing}
        >
          Cancelar
        </Button>
        <Button 
          color="rose" 
          onClick={handleReject}
          disabled={isProcessing || (sessionStatus !== null && !sessionStatus.active)}
        >
          {isProcessing ? 'Rechazando...' : 'Rechazar Acceso'}
        </Button>
        <Button 
          color="lime" 
          onClick={handleApprove}
          disabled={isProcessing || (sessionStatus !== null && !sessionStatus.active)}
        >
          {isProcessing ? 'Aprobando...' : 'Aprobar Acceso'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
