import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Dialog, 
  DialogTitle, 
  DialogDescription, 
  DialogBody, 
  DialogActions 
} from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import {
  UserIcon,
  TruckIcon,
  HomeIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShieldExclamationIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  BellAlertIcon,
  UsersIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline'
import { useNotifications } from '@/hooks/useNotifications'
import ConciergeAPI from '@/api/ConciergeAPI'
import type { AppNotification } from '@/types/index'

interface VisitorArrivalData {
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

interface NotificationDetailModalProps {
  notification: AppNotification | null
  isOpen: boolean
  onClose: () => void
}

/**
 * Obtiene el ícono y color según el tipo de notificación
 */
function getNotificationStyle(type: string) {
  switch (type) {
    case 'VISITOR_ARRIVAL':
      return {
        icon: UserIcon,
        bgColor: 'bg-amber-100 dark:bg-amber-900/30',
        iconColor: 'text-amber-600 dark:text-amber-400',
        badgeColor: 'amber' as const,
      }
    case 'VISIT_APPROVED':
      return {
        icon: CheckCircleIcon,
        bgColor: 'bg-green-100 dark:bg-green-900/30',
        iconColor: 'text-green-600 dark:text-green-400',
        badgeColor: 'lime' as const,
      }
    case 'VISIT_REJECTED':
      return {
        icon: XCircleIcon,
        bgColor: 'bg-red-100 dark:bg-red-900/30',
        iconColor: 'text-red-600 dark:text-red-400',
        badgeColor: 'rose' as const,
      }
    case 'VISIT_CHECK_IN':
      return {
        icon: UserIcon,
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
        iconColor: 'text-blue-600 dark:text-blue-400',
        badgeColor: 'blue' as const,
      }
    case 'VISIT_CHECK_OUT':
      return {
        icon: UserIcon,
        bgColor: 'bg-zinc-100 dark:bg-zinc-800',
        iconColor: 'text-zinc-600 dark:text-zinc-400',
        badgeColor: 'zinc' as const,
      }
    case 'VEHICLE_DETECTED':
    case 'UNKNOWN_VEHICLE':
      return {
        icon: TruckIcon,
        bgColor: 'bg-purple-100 dark:bg-purple-900/30',
        iconColor: 'text-purple-600 dark:text-purple-400',
        badgeColor: 'purple' as const,
      }
    case 'ACCESS_DENIED':
      return {
        icon: ShieldExclamationIcon,
        bgColor: 'bg-red-100 dark:bg-red-900/30',
        iconColor: 'text-red-600 dark:text-red-400',
        badgeColor: 'rose' as const,
      }
    case 'VISIT_EXPIRING_SOON':
    case 'VISIT_EXPIRED':
      return {
        icon: ExclamationTriangleIcon,
        bgColor: 'bg-orange-100 dark:bg-orange-900/30',
        iconColor: 'text-orange-600 dark:text-orange-400',
        badgeColor: 'orange' as const,
      }
    case 'FAMILY_INVITATION':
    case 'FAMILY_MEMBER_ADDED':
    case 'FAMILY_MEMBER_REMOVED':
      return {
        icon: UsersIcon,
        bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
        iconColor: 'text-indigo-600 dark:text-indigo-400',
        badgeColor: 'indigo' as const,
      }
    case 'SYSTEM_ALERT':
      return {
        icon: BellAlertIcon,
        bgColor: 'bg-red-100 dark:bg-red-900/30',
        iconColor: 'text-red-600 dark:text-red-400',
        badgeColor: 'rose' as const,
      }
    default:
      return {
        icon: InformationCircleIcon,
        bgColor: 'bg-blue-100 dark:bg-blue-900/30',
        iconColor: 'text-blue-600 dark:text-blue-400',
        badgeColor: 'blue' as const,
      }
  }
}

/**
 * Formatea el tipo de notificación para mostrar
 */
function formatNotificationType(type: string): string {
  const typeMap: Record<string, string> = {
    VISITOR_ARRIVAL: 'Visitante en Portería',
    VISIT_APPROVED: 'Visita Aprobada',
    VISIT_REJECTED: 'Visita Rechazada',
    VISIT_CHECK_IN: 'Registro de Entrada',
    VISIT_CHECK_OUT: 'Registro de Salida',
    VISIT_EXPIRING_SOON: 'Visita por Expirar',
    VISIT_EXPIRED: 'Visita Expirada',
    VEHICLE_DETECTED: 'Vehículo Detectado',
    UNKNOWN_VEHICLE: 'Vehículo Desconocido',
    ACCESS_DENIED: 'Acceso Denegado',
    SYSTEM_ALERT: 'Alerta del Sistema',
    SYSTEM_INFO: 'Información del Sistema',
    FAMILY_INVITATION: 'Invitación a Familia',
    FAMILY_MEMBER_ADDED: 'Miembro Agregado',
    FAMILY_MEMBER_REMOVED: 'Miembro Removido',
  }
  return typeMap[type] || type
}

/**
 * Componente modal para mostrar detalles de notificaciones
 */
export function NotificationDetailModal({
  notification,
  isOpen,
  onClose,
}: NotificationDetailModalProps) {
  const navigate = useNavigate()
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { markAsRead } = useNotifications()

  // No marcar automáticamente como leída - esto lo maneja el componente padre
  // Solo se marca como leída cuando el padre lo decide

  if (!notification) return null

  const { payload } = notification
  const style = getNotificationStyle(payload.type)
  const Icon = style.icon

  // Calcular tiempo transcurrido
  // Convertir timestamp a Date si es string
  const timestamp = typeof payload.timestamp === 'string' 
    ? new Date(payload.timestamp) 
    : (payload.timestamp || new Date())
  
  const timeAgo = Math.floor((Date.now() - timestamp.getTime()) / 1000)
  
  let timeText: string
  if (timeAgo < 60) {
    timeText = `Hace ${timeAgo} segundo${timeAgo !== 1 ? 's' : ''}`
  } else if (timeAgo < 3600) {
    const minutes = Math.floor(timeAgo / 60)
    timeText = `Hace ${minutes} minuto${minutes !== 1 ? 's' : ''}`
  } else if (timeAgo < 86400) {
    const hours = Math.floor(timeAgo / 3600)
    timeText = `Hace ${hours} hora${hours !== 1 ? 's' : ''}`
  } else if (timeAgo < 604800) {
    const days = Math.floor(timeAgo / 86400)
    timeText = `Hace ${days} día${days !== 1 ? 's' : ''}`
  } else if (timeAgo < 2592000) {
    const weeks = Math.floor(timeAgo / 604800)
    timeText = `Hace ${weeks} semana${weeks !== 1 ? 's' : ''}`
  } else if (timeAgo < 31536000) {
    const months = Math.floor(timeAgo / 2592000)
    timeText = `Hace ${months} mes${months !== 1 ? 'es' : ''}`
  } else {
    const years = Math.floor(timeAgo / 31536000)
    timeText = `Hace ${years} año${years !== 1 ? 's' : ''}`
  }

  // Handler para aprobar visitante
  const handleApproveVisitor = async () => {
    if (!payload.data?.sessionId) return

    const sessionId = payload.data.sessionId as string

    setIsProcessing(true)
    setError(null)

    try {
      // Enviar el ID del usuario actual como el residente que aprobó
      await ConciergeAPI.respondToVisitor(sessionId, true, user?.id)
      console.log('[NotificationDetail] ✅ Visita aprobada por residente:', user?.id)

      // Marcar como leída
      await markAsRead(notification.id)

      onClose()
    } catch (err: any) {
      console.error('[NotificationDetail] ❌ Error al aprobar:', err)
      setError(err.response?.data?.message || err.message || 'Error al aprobar la visita')
    } finally {
      setIsProcessing(false)
    }
  }

  // Handler para rechazar visitante
  const handleRejectVisitor = async () => {
    if (!payload.data?.sessionId) return

    const sessionId = payload.data.sessionId as string

    setIsProcessing(true)
    setError(null)

    try {
      // Enviar el ID del usuario actual como el residente que rechazó
      await ConciergeAPI.respondToVisitor(sessionId, false, user?.id)
      console.log('[NotificationDetail] ✅ Visita rechazada por residente:', user?.id)

      // Marcar como leída
      await markAsRead(notification.id)

      onClose()
    } catch (err: any) {
      console.error('[NotificationDetail] ❌ Error al rechazar:', err)
      setError(err.response?.data?.message || err.message || 'Error al rechazar la visita')
    } finally {
      setIsProcessing(false)
    }
  }

  // Handler para cerrar
  const handleClose = () => {
    onClose()
  }

  // Handler para ver detalle de detección
  const handleViewDetails = () => {
    const attemptId = payload.data?.attemptId
    if (attemptId) {
      // Marcar como leída si aún no lo está
      if (!notification.read) {
        markAsRead(notification.id)
      }
      // Cerrar el modal
      onClose()
      // Navegar a la vista de detalle
      navigate(`/traceability/${attemptId as string}`)
    }
  }

  // Verificar si la sesión ha expirado para VISITOR_ARRIVAL
  const visitorData = payload.type === 'VISITOR_ARRIVAL' ? (payload.data as VisitorArrivalData | undefined) : undefined
  const isExpired =
    (payload.type === 'VISITOR_ARRIVAL' &&
    !!visitorData?.expiresAt &&
    new Date(visitorData.expiresAt) < new Date()) as boolean

  // Verificar si requiere acción y está activa
  const requiresAction = (!!payload.requiresAction && !isExpired) as boolean

  // Renderizar advertencia de sesión expirada
  const renderExpiredWarning = () => {
    if (!isExpired) return null
    
    return (
      <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-red-900 dark:text-red-100">
            Sesión Expirada
          </div>
          <div className="text-xs text-red-700 dark:text-red-300 mt-1">
            Esta solicitud de visita ha expirado y ya no requiere acción.
          </div>
        </div>
      </div>
    )
  }
  
  const expiredWarningElement = renderExpiredWarning()

  return (
    <Dialog open={isOpen} onClose={handleClose}>
      <DialogTitle className="flex items-center gap-3">
        <div className={`flex items-center justify-center w-12 h-12 rounded-full ${style.bgColor}`}>
          <Icon className={`w-6 h-6 ${style.iconColor}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-zinc-900 dark:text-white">
              {payload.title}
            </span>
            <Badge color={style.badgeColor}>{formatNotificationType(payload.type)}</Badge>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <ClockIcon className="w-4 h-4 text-zinc-400" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{timeText}</span>
          </div>
        </div>
      </DialogTitle>

      <DialogDescription>{payload.message}</DialogDescription>

      <DialogBody>
        <div className="space-y-4">
          {/* Mensaje de error */}
          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <p className="text-sm text-rose-900 dark:text-rose-200">{error}</p>
            </div>
          )}

          {/* Advertencia de sesión expirada */}
          {(expiredWarningElement as any)}

          {/* Información adicional según el tipo de notificación */}
          {payload.type === 'VISITOR_ARRIVAL' && payload.data && (
            <>
              {/* Datos del visitante */}
              {payload.data.visitor && (
                <div className="space-y-3">
                  {/* Nombre */}
                  {(payload.data.visitor as any).name && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                      <UserIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                          Visitante
                        </div>
                        <div className="text-sm font-semibold text-zinc-900 dark:text-white mt-1">
                          {(payload.data.visitor as any).name}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Patente */}
                  {(payload.data.visitor as any).plate && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                      <TruckIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                          Vehículo
                        </div>
                        <Badge color="zinc" className="font-mono font-bold mt-1">
                          {(payload.data.visitor as any).plate}
                        </Badge>
                      </div>
                    </div>
                  )}

                  {/* Motivo */}
                  {(payload.data.visitor as any).reason && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                      <HomeIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                          Motivo
                        </div>
                        <div className="text-sm text-zinc-900 dark:text-white mt-1">
                          {(payload.data.visitor as any).reason}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Información de vehículo detectado */}
          {(payload.type === 'VEHICLE_DETECTED' || payload.type === 'UNKNOWN_VEHICLE') &&
            payload.data?.plate && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
                <TruckIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                    Patente Detectada
                  </div>
                  <Badge color="zinc" className="font-mono font-bold mt-1">
                    {payload.data.plate as string}
                  </Badge>
                </div>
              </div>
            )}
        </div>
      </DialogBody>

      <DialogActions>
        {requiresAction && payload.type === 'VISITOR_ARRIVAL' ? (
          <>
            {/* Botones para aprobar/rechazar visitante */}
            <Button plain onClick={handleClose} disabled={isProcessing}>
              Cerrar
            </Button>
            <Button color="rose" onClick={handleRejectVisitor} disabled={isProcessing}>
              {isProcessing ? 'Rechazando...' : 'Rechazar'}
            </Button>
            <Button color="lime" onClick={handleApproveVisitor} disabled={isProcessing}>
              {isProcessing ? 'Aprobando...' : 'Aprobar Acceso'}
            </Button>
          </>
        ) : payload.type === 'UNKNOWN_VEHICLE' && payload.data?.attemptId ? (
          <>
            {/* Botón de cerrar y ver detalle para vehículos desconocidos */}
            <Button plain onClick={handleClose}>
              Cerrar
            </Button>
            <Button color="indigo" onClick={handleViewDetails}>
              <ArrowTopRightOnSquareIcon className="w-5 h-5" />
              Ver Detalle Completo
            </Button>
          </>
        ) : (
          <>
            {/* Solo botón de cerrar para notificaciones informativas */}
            <Button onClick={handleClose}>Cerrar</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
