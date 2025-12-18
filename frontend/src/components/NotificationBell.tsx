import { useState } from 'react'
import type { ReactElement } from 'react'
import { BellIcon } from '@heroicons/react/20/solid'
import { 
  UserIcon, 
  TruckIcon, 
  ShieldExclamationIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  CheckIcon,
  XMarkIcon
} from '@heroicons/react/16/solid'
import { useNotifications } from '@/hooks/useNotifications'
import { 
  Dropdown, 
  DropdownButton, 
  DropdownMenu,
} from '@/components/ui/Dropdown'
import { NavbarItem } from '@/components/ui/Navbar'
import { NotificationDetailModal } from '@/components/NotificationDetailModal'
import type { AppNotification } from '@/types/index'

/**
 * Obtiene el ícono según el tipo de notificación
 */
function getNotificationIcon(type: string) {
  switch (type) {
    case 'VISITOR_ARRIVAL':
    case 'VISIT_CHECK_IN':
    case 'VISIT_APPROVED':
    case 'VISIT_CHECK_OUT':
      return UserIcon
    case 'VEHICLE_DETECTED':
    case 'UNKNOWN_VEHICLE':
      return TruckIcon
    case 'VISIT_REJECTED':
    case 'ACCESS_DENIED':
      return ShieldExclamationIcon
    case 'SYSTEM_ALERT':
    case 'VISIT_EXPIRING_SOON':
    case 'VISIT_EXPIRED':
      return ExclamationTriangleIcon
    default:
      return InformationCircleIcon
  }
}

interface NotificationItemProps {
  notification: AppNotification
  onClick: () => void
}

/**
 * Componente individual de notificación
 */
function NotificationItem({ notification, onClick }: NotificationItemProps): ReactElement {
  const { payload, read } = notification
  const Icon = getNotificationIcon(payload.type)

  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${
        read ? 'opacity-60' : ''
      }`}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-zinc-500 dark:text-zinc-400" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium text-zinc-950 dark:text-white">
            {payload.title}
          </p>
          {!read && (
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
          )}
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
          {payload.message}
        </p>
      </div>
    </button>
  )
}

/**
 * Componente de campana de notificaciones con dropdown
 */
export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    markAllAsRead,
    clearAll,
    markAsRead,
  } = useNotifications()

  const [selectedNotification, setSelectedNotification] = useState<AppNotification | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [notificationSnapshot, setNotificationSnapshot] = useState<AppNotification | null>(null)

  const recentNotifications = notifications.slice(0, 10)
  const hasNotifications = notifications.length > 0

  const handleNotificationClick = (notification: AppNotification) => {
    // Guardar un snapshot de la notificación para evitar que cambios posteriores causen parpadeo
    setNotificationSnapshot({ ...notification })
    setSelectedNotification(notification)
    
    // Abrir el modal después de un pequeño delay para evitar conflictos
    setTimeout(() => {
      setIsModalOpen(true)
    }, 150)
    
    // Marcar como leída después de abrir el modal
    if (!notification.read) {
      markAsRead(notification.id)
    }
  }

  const handleModalClose = () => {
    setIsModalOpen(false)
    // Pequeño delay antes de limpiar la notificación seleccionada para la animación
    setTimeout(() => {
      setSelectedNotification(null)
      setNotificationSnapshot(null)
    }, 300)
  }

  return (
    <>
      <Dropdown>
        <DropdownButton as={NavbarItem} aria-label="Notificaciones">
          <BellIcon data-slot="icon" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[11px] font-semibold text-white ring-2 ring-white dark:ring-zinc-900">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </DropdownButton>

      <DropdownMenu className="!p-0 min-w-[22rem] max-h-[36rem] !overflow-hidden" anchor="bottom end">
        <div className="col-span-full flex flex-col max-h-[36rem]">
          {/* Header */}
          <div className="border-b border-zinc-950/5 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-zinc-800">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">
                Notificaciones
              </h3>
              {unreadCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">
                  {unreadCount} nueva{unreadCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {hasNotifications ? (
            <>
              {/* Lista de notificaciones */}
              <div className="flex-1 overflow-y-auto">
                <div className="p-1">
                  {recentNotifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onClick={() => handleNotificationClick(notification)}
                    />
                  ))}
                </div>
              </div>

              {/* Footer con acciones */}
              <div className="border-t border-zinc-950/5 bg-white dark:border-white/10 dark:bg-zinc-800">
                <div className="flex gap-2 px-3.5 py-2.5">
                  {unreadCount > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        markAllAsRead()
                      }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
                    >
                      <CheckIcon className="h-4 w-4" />
                      Marcar leídas
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      clearAll()
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
                  >
                    <XMarkIcon className="h-4 w-4" />
                    Limpiar todo
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-16">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                <BellIcon className="h-6 w-6 text-zinc-400 dark:text-zinc-500" />
              </div>
              <p className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">
                Todo al día
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                No tienes notificaciones pendientes
              </p>
            </div>
          )}
        </div>
      </DropdownMenu>
      </Dropdown>

      {/* Modal de detalle de notificación - renderizado fuera del Dropdown */}
      <NotificationDetailModal
        notification={notificationSnapshot}
        isOpen={isModalOpen}
        onClose={handleModalClose}
      />
    </>
  )
}
