import { useState, useEffect } from 'react'
import { Dialog, DialogTitle, DialogDescription, DialogBody, DialogActions } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { UserIcon, HomeIcon, TruckIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useNotifications } from '@/hooks/useNotifications'
import { useAuth } from '@/hooks/useAuth'
import ConciergeAPI from '@/api/ConciergeAPI'
import type { AppNotification } from '@/types/index'

interface VisitorData {
  sessionId: string
  visitorName: string
  vehiclePlate?: string
  visitReason?: string
  visitorRut?: string
  visitorPhone?: string
  timestamp: Date
  notificationId: string
  expiresAt: Date
}

export function VisitorApprovalDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const [visitorData, setVisitorData] = useState<VisitorData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<{ active: boolean; reason?: string } | null>(null)
  
  const { notifications, markAsRead } = useNotifications()
  const { data: user } = useAuth()

  useEffect(() => {
    // Filtrar notificaciones de visitantes que requieren acción
    const visitorNotifications = notifications.filter(
      (n: AppNotification) =>
        n.payload.type === 'VISITOR_ARRIVAL' &&
        n.payload.requiresAction &&
        !n.read &&
        n.payload.data?.expiresAt &&
        new Date(n.payload.data.expiresAt as string) > new Date() // Solo notificaciones no expiradas
    )

    console.log('[VisitorApprovalDialog] 📬 Notificaciones de visitantes pendientes:', visitorNotifications.length)

    // Mostrar la primera notificación pendiente
    if (visitorNotifications.length > 0 && !isOpen) {
      const notification = visitorNotifications[0]
      console.log('[VisitorApprovalDialog] 🔔 Mostrando notificación:', notification.id)

      const data = notification.payload.data as {
        sessionId: string
        expiresAt: string
        visitor: {
          name: string
          rut?: string
          phone?: string
          plate?: string
          reason?: string
        }
      }

      setVisitorData({
        sessionId: data.sessionId,
        visitorName: data.visitor.name,
        vehiclePlate: data.visitor.plate,
        visitReason: data.visitor.reason,
        visitorRut: data.visitor.rut,
        visitorPhone: data.visitor.phone,
        timestamp: notification.payload.timestamp || new Date(),
        notificationId: notification.id,
        expiresAt: new Date(data.expiresAt),
      })

      // Validar que la sesión esté activa antes de mostrar
      validateSession(data.sessionId)
      
      setIsOpen(true)
      setError(null)
    }
  }, [notifications, isOpen])

  const validateSession = async (sessionId: string) => {
    try {
      console.log('[VisitorApprovalDialog] 🔍 Validando estado de sesión:', sessionId)
      const status = await ConciergeAPI.checkSessionStatus(sessionId)
      setSessionStatus(status)
      
      if (!status.active) {
        console.warn('[VisitorApprovalDialog] ⚠️ Sesión no activa:', status.reason)
        setError(status.reason || 'La sesión ya no está activa')
      } else {
        console.log('[VisitorApprovalDialog] ✅ Sesión activa')
      }
    } catch (err) {
      console.error('[VisitorApprovalDialog] ❌ Error al validar sesión:', err)
      setError('No se pudo validar el estado de la sesión')
      setSessionStatus({ active: false, reason: 'Error de conexión' })
    }
  }

  const handleApprove = async () => {
    if (!visitorData) return

    // Verificar que la sesión esté activa
    if (!sessionStatus?.active) {
      setError(sessionStatus?.reason || 'La sesión no está activa')
      return
    }

    // Verificar que tengamos el ID del usuario
    if (!user?.id) {
      console.error('[VisitorApproval] ❌ No hay usuario autenticado o falta user.id:', user)
      setError('Error: No se pudo identificar al usuario autenticado')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      console.log('[VisitorApproval] 📤 Enviando aprobación con residentId:', user.id)
      // Enviar el ID del usuario actual como el residente que aprobó
      await ConciergeAPI.respondToVisitor(visitorData.sessionId, true, user.id)
      console.log('[VisitorApproval] ✅ Visita aprobada por residente:', user.id)
      
      // Marcar la notificación como leída
      await markAsRead(visitorData.notificationId)
      
      setIsOpen(false)
      setVisitorData(null)
      setSessionStatus(null)
    } catch (err: any) {
      console.error('[VisitorApproval] ❌ Error al aprobar:', err)
      setError(err.response?.data?.message || err.message || 'Error al aprobar la visita')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!visitorData) return

    // Verificar que la sesión esté activa
    if (!sessionStatus?.active) {
      setError(sessionStatus?.reason || 'La sesión no está activa')
      return
    }

    // Verificar que tengamos el ID del usuario
    if (!user?.id) {
      console.error('[VisitorApproval] ❌ No hay usuario autenticado o falta user.id:', user)
      setError('Error: No se pudo identificar al usuario autenticado')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      console.log('[VisitorApproval] 📤 Enviando rechazo con residentId:', user.id)
      // Enviar el ID del usuario actual como el residente que rechazó
      await ConciergeAPI.respondToVisitor(visitorData.sessionId, false, user.id)
      console.log('[VisitorApproval] ✅ Visita rechazada por residente:', user.id)
      
      // Marcar la notificación como leída
      await markAsRead(visitorData.notificationId)
      
      setIsOpen(false)
      setVisitorData(null)
      setSessionStatus(null)
    } catch (err: any) {
      console.error('[VisitorApproval] ❌ Error al rechazar:', err)
      setError(err.response?.data?.message || err.message || 'Error al rechazar la visita')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleClose = () => {
    if (!isProcessing) {
      setIsOpen(false)
      // Dar un pequeño delay antes de limpiar los datos para la animación
      setTimeout(() => {
        setVisitorData(null)
        setSessionStatus(null)
        setError(null)
      }, 300)
    }
  }

  if (!visitorData) return null

  const timeAgo = Math.floor((Date.now() - visitorData.timestamp.getTime()) / 1000)
  const timeText = timeAgo < 60 
    ? `Hace ${timeAgo} segundos` 
    : `Hace ${Math.floor(timeAgo / 60)} minuto${Math.floor(timeAgo / 60) !== 1 ? 's' : ''}`

  // Calcular tiempo restante hasta la expiración
  const expiresIn = Math.floor((visitorData.expiresAt.getTime() - Date.now()) / 1000)
  const expiresText = expiresIn > 60 
    ? `${Math.floor(expiresIn / 60)} minuto${Math.floor(expiresIn / 60) !== 1 ? 's' : ''}` 
    : `${expiresIn} segundos`
  const isExpiringSoon = expiresIn < 300 // Menos de 5 minutos

  return (
    <Dialog open={isOpen} onClose={handleClose}>
      <DialogTitle className="flex items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30">
          <UserIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            Visitante en Portería
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
        Hay un visitante esperando en la entrada. Por favor, revisa los datos y decide si deseas aprobar o rechazar el acceso.
      </DialogDescription>

      <DialogBody>
        <div className="space-y-4">
          {/* Advertencia de sesión inactiva */}
          {sessionStatus && !sessionStatus.active && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-red-900 dark:text-red-100">
                  Sesión No Válida
                </div>
                <div className="text-xs text-red-700 dark:text-red-300 mt-1">
                  {sessionStatus.reason}
                </div>
              </div>
            </div>
          )}

          {/* Advertencia de expiración cercana */}
          {isExpiringSoon && sessionStatus?.active && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <ClockIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                  Expira en {expiresText}
                </div>
              </div>
            </div>
          )}

          {/* Nombre del visitante */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            <UserIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                Nombre del Visitante
              </div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-white mt-1">
                {visitorData.visitorName}
              </div>
            </div>
          </div>

          {/* Patente del vehículo (si existe) */}
          {visitorData.vehiclePlate && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <TruckIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Patente del Vehículo
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge color="zinc" className="font-mono font-bold">
                    {visitorData.vehiclePlate}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {/* Motivo de la visita (si existe) */}
          {visitorData.visitReason && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <HomeIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Motivo de la Visita
                </div>
                <div className="text-sm text-zinc-900 dark:text-white mt-1">
                  {visitorData.visitReason}
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <p className="text-sm text-rose-900 dark:text-rose-200">
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
          {isProcessing ? 'Rechazando...' : 'Rechazar'}
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
