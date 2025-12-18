import { Heading, Subheading } from '@/components/ui/Heading'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Divider } from '@/components/ui/Divider'
import { Text } from '@/components/ui/Text'
import { useNotifications } from '@/hooks/useNotifications'
import { BellIcon, CheckCircleIcon, XCircleIcon, SignalIcon, SignalSlashIcon } from '@heroicons/react/24/outline'
import { formatDateTime } from '@/helpers/index'

/**
 * Vista de prueba y demostración del sistema de notificaciones
 */
export default function NotificationTestView() {
  const {
    notifications,
    unreadCount,
    isConnected,
    markAsRead,
    markAllAsRead,
    clearAll,
    requestPermission,
    hasPermission,
  } = useNotifications()

  const handleTestNotification = () => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Notificación de Prueba', {
        body: 'Esta es una notificación de prueba del navegador',
        icon: '/favicon.ico',
      })
    } else {
      alert('Primero habilita las notificaciones del navegador')
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <BellIcon className="w-8 h-8 text-indigo-500" />
          <Heading>Sistema de Notificaciones Push</Heading>
        </div>
        <Subheading>
          Panel de prueba y monitoreo del sistema de notificaciones en tiempo real
        </Subheading>
      </header>

      {/* Estado de conexión */}
      <section className="mb-8 rounded-lg bg-white dark:bg-zinc-900 p-6 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Estado de Conexión
          </h2>
          {isConnected ? (
            <Badge color="lime" className="flex items-center gap-2">
              <SignalIcon className="w-4 h-4" />
              Conectado
            </Badge>
          ) : (
            <Badge color="rose" className="flex items-center gap-2">
              <SignalSlashIcon className="w-4 h-4" />
              Desconectado
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800">
            <Text className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
              Estado WebSocket
            </Text>
            <Text className="text-sm font-semibold text-zinc-900 dark:text-white">
              {isConnected ? '🟢 Conectado' : '🔴 Desconectado'}
            </Text>
          </div>

          <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800">
            <Text className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
              Permisos del Navegador
            </Text>
            <Text className="text-sm font-semibold text-zinc-900 dark:text-white">
              {hasPermission ? '✅ Habilitado' : '❌ Deshabilitado'}
            </Text>
          </div>

          <div className="p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800">
            <Text className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
              Notificaciones sin leer
            </Text>
            <Text className="text-sm font-semibold text-zinc-900 dark:text-white">
              {unreadCount} de {notifications.length}
            </Text>
          </div>
        </div>
      </section>

      {/* Acciones */}
      <section className="mb-8 rounded-lg bg-white dark:bg-zinc-900 p-6 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4">
          Acciones de Prueba
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!hasPermission && (
            <Button
              color="indigo"
              onClick={requestPermission}
              className="w-full"
            >
              <BellIcon className="w-5 h-5" />
              Habilitar Notificaciones del Navegador
            </Button>
          )}

          {hasPermission && (
            <Button
              color="sky"
              onClick={handleTestNotification}
              className="w-full"
            >
              <BellIcon className="w-5 h-5" />
              Probar Notificación del Navegador
            </Button>
          )}

          <Button
            outline
            onClick={markAllAsRead}
            disabled={unreadCount === 0}
            className="w-full"
          >
            <CheckCircleIcon className="w-5 h-5" />
            Marcar todas como leídas ({unreadCount})
          </Button>

          <Button
            outline
            onClick={clearAll}
            disabled={notifications.length === 0}
            className="w-full"
          >
            <XCircleIcon className="w-5 h-5" />
            Limpiar todas ({notifications.length})
          </Button>
        </div>

        <Divider className="my-6" />

        <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg">
          <Text className="text-sm text-amber-900 dark:text-amber-200">
            <strong>💡 Nota:</strong> Las notificaciones reales se generan desde el backend
            cuando ocurren eventos como check-in/check-out de visitas, detecciones de vehículos, etc.
            Para probar notificaciones reales, realiza acciones en el sistema (crear visitas, detectar vehículos, etc.).
          </Text>
        </div>
      </section>

      {/* Lista de notificaciones */}
      <section className="rounded-lg bg-white dark:bg-zinc-900 p-6 shadow-sm ring-1 ring-zinc-950/5 dark:ring-white/10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Historial de Notificaciones
          </h2>
          <Badge color="zinc">{notifications.length} total</Badge>
        </div>

        {notifications.length === 0 ? (
          <div className="text-center py-12">
            <BellIcon className="w-16 h-16 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
            <Text className="text-zinc-600 dark:text-zinc-400">
              No hay notificaciones aún
            </Text>
            <Text className="text-sm text-zinc-500 dark:text-zinc-500 mt-2">
              Las notificaciones aparecerán aquí cuando se reciban
            </Text>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`
                  p-4 rounded-lg border transition-all
                  ${notification.read 
                    ? 'bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 opacity-60' 
                    : 'bg-white dark:bg-zinc-900 border-indigo-200 dark:border-indigo-800 shadow-sm'
                  }
                `}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Text className="font-semibold text-zinc-900 dark:text-white">
                        {notification.payload.title}
                      </Text>
                      {!notification.read && (
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                      )}
                    </div>
                    <Text className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
                      {notification.payload.message}
                    </Text>
                    <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500">
                      <Badge color="zinc" className="text-xs">
                        {notification.payload.type}
                      </Badge>
                      <span>
                        {notification.payload.timestamp ? formatDateTime(notification.payload.timestamp) : 'Sin fecha'}
                      </span>
                    </div>
                  </div>

                  {!notification.read && (
                    <Button
                      plain
                      onClick={() => markAsRead(notification.id)}
                      className="flex-shrink-0"
                    >
                      <CheckCircleIcon className="w-5 h-5" />
                    </Button>
                  )}
                </div>

                {notification.payload.data && Object.keys(notification.payload.data).length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-zinc-500 dark:text-zinc-500 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300">
                      Ver datos adicionales
                    </summary>
                    <pre className="mt-2 text-xs bg-zinc-100 dark:bg-zinc-950 p-3 rounded overflow-auto">
                      {JSON.stringify(notification.payload.data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Información adicional */}
      <section className="mt-8 rounded-lg bg-zinc-50 dark:bg-zinc-800 p-6">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-3">
          Tipos de Notificaciones Soportadas
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Badge color="lime">CHECK_IN</Badge>
            <Text className="text-zinc-600 dark:text-zinc-400">Ingreso de visita</Text>
          </div>
          <div className="flex items-center gap-2">
            <Badge color="sky">CHECK_OUT</Badge>
            <Text className="text-zinc-600 dark:text-zinc-400">Salida de visita</Text>
          </div>
          <div className="flex items-center gap-2">
            <Badge color="rose">ACCESS_DENIED</Badge>
            <Text className="text-zinc-600 dark:text-zinc-400">Acceso denegado</Text>
          </div>
          <div className="flex items-center gap-2">
            <Badge color="amber">SYSTEM_ALERT</Badge>
            <Text className="text-zinc-600 dark:text-zinc-400">Alerta del sistema</Text>
          </div>
        </div>
      </section>
    </div>
  )
}
