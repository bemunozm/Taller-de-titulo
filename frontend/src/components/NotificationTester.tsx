import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { NotificationsAPI } from '@/api/NotificationsAPI'
import { toast } from 'react-toastify'
import type { NotificationType } from '@/types/index'
import { 
  BellAlertIcon, 
  CheckCircleIcon, 
  ExclamationTriangleIcon,
  InformationCircleIcon,
  TruckIcon,
  UserGroupIcon,
  ShieldExclamationIcon
} from '@heroicons/react/24/outline'

interface NotificationOption {
  type: NotificationType
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  color: 'lime' | 'sky' | 'amber' | 'rose' | 'purple' | 'indigo' | 'zinc'
  requiresAction?: boolean
  priority?: 'low' | 'normal' | 'high' | 'urgent'
}

const notificationOptions: NotificationOption[] = [
  {
    type: 'VISITOR_ARRIVAL',
    label: 'Visitante en Portería',
    description: 'Notificación urgente que requiere acción',
    icon: BellAlertIcon,
    color: 'purple',
    requiresAction: true,
    priority: 'urgent',
  },
  {
    type: 'VISIT_CHECK_IN',
    label: 'Entrada de Visita',
    description: 'Confirmación de ingreso al condominio',
    icon: CheckCircleIcon,
    color: 'lime',
    priority: 'normal',
  },
  {
    type: 'VISIT_APPROVED',
    label: 'Visita Aprobada',
    description: 'Confirmación de aprobación de visita',
    icon: CheckCircleIcon,
    color: 'lime',
    priority: 'normal',
  },
  {
    type: 'VEHICLE_DETECTED',
    label: 'Vehículo Detectado',
    description: 'Detección de vehículo registrado',
    icon: TruckIcon,
    color: 'indigo',
    priority: 'normal',
  },
  {
    type: 'UNKNOWN_VEHICLE',
    label: 'Vehículo Desconocido',
    description: 'Alerta de vehículo no registrado',
    icon: TruckIcon,
    color: 'amber',
    priority: 'high',
  },
  {
    type: 'SYSTEM_ALERT',
    label: 'Alerta del Sistema',
    description: 'Advertencia que requiere atención',
    icon: ExclamationTriangleIcon,
    color: 'amber',
    priority: 'high',
  },
  {
    type: 'SYSTEM_INFO',
    label: 'Info del Sistema',
    description: 'Información general del sistema',
    icon: InformationCircleIcon,
    color: 'indigo',
    priority: 'low',
  },
  {
    type: 'ACCESS_DENIED',
    label: 'Acceso Denegado',
    description: 'Rechazo de acceso al condominio',
    icon: ShieldExclamationIcon,
    color: 'rose',
    priority: 'high',
  },
  {
    type: 'FAMILY_MEMBER_ADDED',
    label: 'Miembro de Familia Agregado',
    description: 'Nuevo miembro agregado a familia',
    icon: UserGroupIcon,
    color: 'zinc',
    priority: 'normal',
  },
]

export function NotificationTester() {
  const [sending, setSending] = useState<string | null>(null)

  const sendNotification = async (option: NotificationOption) => {
    setSending(option.type)
    try {
      await NotificationsAPI.sendTestNotification({
        type: option.type,
        requiresAction: option.requiresAction,
        priority: option.priority,
      })
      toast.success(`✅ Notificación "${option.label}" enviada`)
    } catch (error: any) {
      console.error('Error sending test notification:', error)
      toast.error(error.response?.data?.message || 'Error al enviar notificación')
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-200 dark:border-zinc-700 pb-4">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
          Probador de Notificaciones
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
          Envía notificaciones de prueba para validar el funcionamiento del sistema
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {notificationOptions.map((option) => {
          const Icon = option.icon
          const isSending = sending === option.type

          return (
            <div
              key={option.type}
              className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`p-2 rounded-lg bg-${option.color}-100 dark:bg-${option.color}-900/20`}>
                  <Icon className={`w-5 h-5 text-${option.color}-600 dark:text-${option.color}-400`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm text-zinc-900 dark:text-white">
                    {option.label}
                  </h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                    {option.description}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-3">
                <Badge color={option.color} className="text-xs">
                  {option.type}
                </Badge>
                {option.requiresAction && (
                  <Badge color="rose" className="text-xs">
                    Requiere acción
                  </Badge>
                )}
                <Badge color="zinc" className="text-xs">
                  {option.priority}
                </Badge>
              </div>

              <Button
                color={option.color}
                onClick={() => sendNotification(option)}
                disabled={isSending}
                className="w-full text-sm"
              >
                {isSending ? 'Enviando...' : 'Enviar notificación'}
              </Button>
            </div>
          )
        })}
      </div>

      <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
        <h3 className="font-semibold text-sm text-blue-900 dark:text-blue-100 mb-2">
          💡 Instrucciones
        </h3>
        <ul className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-disc list-inside">
          <li>Haz clic en cualquier botón para enviar una notificación de prueba</li>
          <li>Las notificaciones aparecerán en el componente NotificationBell (🔔) en el navbar</li>
          <li>Las notificaciones que "Requieren acción" se mostrarán con animación pulsante</li>
          <li>Revisa el modal de aprobación de visitantes con "Visitante en Portería"</li>
          <li>Las notificaciones se guardan en la base de datos y persisten entre sesiones</li>
        </ul>
      </div>
    </div>
  )
}
