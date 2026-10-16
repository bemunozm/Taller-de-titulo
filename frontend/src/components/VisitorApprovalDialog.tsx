import { useState, useEffect, useRef } from 'react'
import { toast } from 'react-toastify'
import { Dialog, DialogTitle, DialogDescription, DialogBody, DialogActions } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { UserIcon, HomeIcon, TruckIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { useNotifications } from '@/hooks/useNotifications'
import { ConciergeAPI } from '@/api/ConciergeAPI'
import {
  parseVisitorArrivalData,
  readVisitId,
  submitVisitorResponse,
  type VisitorArrivalData,
} from '@/services/visitorResponse'
import type { AppNotification } from '@/types/index'

interface PendingVisitor extends VisitorArrivalData {
  notificationId: string
  timestamp: Date
}

interface SessionStatus {
  active: boolean
  reason?: string
}

function findPendingVisitor(
  notifications: AppNotification[],
  dismissedIds: ReadonlySet<string>,
): PendingVisitor | null {
  const now = Date.now()

  for (const notification of notifications) {
    if (
      notification.payload.type !== 'VISITOR_ARRIVAL' ||
      !notification.payload.requiresAction ||
      notification.read ||
      dismissedIds.has(notification.id)
    ) {
      continue
    }

    const data = parseVisitorArrivalData(notification.payload.data)
    // Solo solicitudes no expiradas
    if (!data?.expiresAt || data.expiresAt.getTime() <= now) {
      continue
    }

    return {
      ...data,
      notificationId: notification.id,
      timestamp: notification.payload.timestamp ?? new Date(),
    }
  }

  return null
}

export function VisitorApprovalDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const [visitorData, setVisitorData] = useState<PendingVisitor | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  // Aprobada sin apertura automática: se muestra en el diálogo, no como un "éxito" plano.
  const [notOpenedNotice, setNotOpenedNotice] = useState<string | null>(null)
  // La solicitud ya no admite respuesta (409/403 o aviso mostrado): solo queda cerrar.
  const [isResolved, setIsResolved] = useState(false)
  // Notificaciones cerradas en esta pantalla: no se vuelven a abrir solas.
  const dismissedIdsRef = useRef(new Set<string>())

  const { notifications, markAsRead } = useNotifications()

  useEffect(() => {
    if (isOpen) {
      return
    }

    const pending = findPendingVisitor(notifications, dismissedIdsRef.current)
    if (!pending) {
      return
    }

    setVisitorData(pending)
    setSessionStatus(null)
    setError(null)
    setNotOpenedNotice(null)
    setIsResolved(false)
    setIsOpen(true)

    // Validar que la sesión siga activa (y obtener el visitId si la notificación no lo trae)
    const validateSession = async () => {
      try {
        const status = await ConciergeAPI.checkSessionStatus(pending.sessionId)
        const active = status.active === true
        setSessionStatus({ active, reason: status.reason })

        const statusVisitId = readVisitId(status.visitId)
        if (!pending.visitId && statusVisitId) {
          setVisitorData((current) =>
            current?.notificationId === pending.notificationId ? { ...current, visitId: statusVisitId } : current,
          )
        }

        if (!active) {
          setError(status.reason || 'La sesión ya no está activa')
        }
      } catch {
        setError('No se pudo validar el estado de la sesión')
        setSessionStatus({ active: false, reason: 'Error de conexión' })
      }
    }
    void validateSession()
  }, [notifications, isOpen])

  const closeDialog = () => {
    if (visitorData) {
      dismissedIdsRef.current.add(visitorData.notificationId)
    }
    setIsOpen(false)
  }

  const handleRespond = async (approved: boolean) => {
    if (!visitorData) return

    // Verificar que la sesión esté activa
    if (!sessionStatus?.active) {
      setError(sessionStatus?.reason || 'La sesión no está activa')
      return
    }

    setIsProcessing(true)
    setError(null)

    const result = await submitVisitorResponse({
      sessionId: visitorData.sessionId,
      visitId: visitorData.visitId,
      approved,
    })

    setIsProcessing(false)

    switch (result.status) {
      case 'approved':
        markAsRead(visitorData.notificationId)
        toast.success(result.message)
        closeDialog()
        break
      case 'denied':
        markAsRead(visitorData.notificationId)
        toast.info(result.message)
        closeDialog()
        break
      case 'approved-not-opened':
        markAsRead(visitorData.notificationId)
        setNotOpenedNotice(result.message)
        setIsResolved(true)
        break
      case 'error':
        // 409/404: otra respuesta la resolvió, expiró o ya no existe; no requiere acción.
        if (result.reason === 'conflict' || result.reason === 'not-found') {
          markAsRead(visitorData.notificationId)
        }
        setError(result.message)
        if (result.terminal) {
          setIsResolved(true)
        }
        break
    }
  }

  const handleClose = () => {
    if (!isProcessing) {
      closeDialog()
    }
  }

  if (!visitorData) return null

  const timeAgo = Math.floor((Date.now() - visitorData.timestamp.getTime()) / 1000)
  const timeText = timeAgo < 60
    ? `Hace ${timeAgo} segundos`
    : `Hace ${Math.floor(timeAgo / 60)} minuto${Math.floor(timeAgo / 60) !== 1 ? 's' : ''}`

  // Calcular tiempo restante hasta la expiración
  const expiresIn = visitorData.expiresAt
    ? Math.floor((visitorData.expiresAt.getTime() - Date.now()) / 1000)
    : 0
  const expiresText = expiresIn > 60
    ? `${Math.floor(expiresIn / 60)} minuto${Math.floor(expiresIn / 60) !== 1 ? 's' : ''}`
    : `${expiresIn} segundos`
  const isExpiringSoon = expiresIn < 300 // Menos de 5 minutos
  // Sin acciones hasta validar la sesión (y si ya no está activa).
  const actionsDisabled = isProcessing || !sessionStatus?.active

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
          {/* Aprobada, pero el acceso no se abrió automáticamente */}
          {notOpenedNotice && (
            <div
              role="alert"
              className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700"
            >
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                  Acceso no abierto automáticamente
                </div>
                <div className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                  {notOpenedNotice}
                </div>
              </div>
            </div>
          )}

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
          {isExpiringSoon && sessionStatus?.active && !isResolved && (
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
                {visitorData.visitor.name}
              </div>
            </div>
          </div>

          {/* Patente del vehículo (si existe) */}
          {visitorData.visitor.plate && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <TruckIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Patente del Vehículo
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Badge color="zinc" className="font-mono font-bold">
                    {visitorData.visitor.plate}
                  </Badge>
                </div>
              </div>
            </div>
          )}

          {/* Motivo de la visita (si existe) */}
          {visitorData.visitor.reason && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
              <HomeIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                  Motivo de la Visita
                </div>
                <div className="text-sm text-zinc-900 dark:text-white mt-1">
                  {visitorData.visitor.reason}
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div role="alert" className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
              <p className="text-sm text-rose-900 dark:text-rose-200">
                {error}
              </p>
            </div>
          )}
        </div>
      </DialogBody>

      <DialogActions>
        {isResolved ? (
          <Button onClick={handleClose}>
            {notOpenedNotice ? 'Entendido' : 'Cerrar'}
          </Button>
        ) : (
          <>
            <Button
              plain
              onClick={handleClose}
              disabled={isProcessing}
            >
              Cancelar
            </Button>
            <Button
              color="rose"
              onClick={() => void handleRespond(false)}
              disabled={actionsDisabled}
            >
              {isProcessing ? 'Rechazando...' : 'Rechazar'}
            </Button>
            <Button
              color="lime"
              onClick={() => void handleRespond(true)}
              disabled={actionsDisabled}
            >
              {isProcessing ? 'Aprobando...' : 'Aprobar Acceso'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
