import { Switch } from '@/components/ui/Switch';
import { BellIcon, EnvelopeIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline';

export function NotificationPreferencesSection() {
  // Estas preferencias podrían venir del usuario o de localStorage
  // Por ahora son solo UI, pero puedes conectarlas a un endpoint más adelante
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Preferencias de Notificaciones
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Configura cómo y cuándo quieres recibir notificaciones
        </p>
      </div>

      {/* Email Notifications */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-700">
          <EnvelopeIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Notificaciones por Email
          </h4>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Visitas Programadas
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Recibe un email cuando se programe una visita para ti
              </p>
            </div>
            <Switch color="indigo" defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Detecciones de Vehículos
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Notificaciones cuando se detecte tu vehículo
              </p>
            </div>
            <Switch color="indigo" defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Resumen Semanal
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Recibe un resumen de actividad cada semana
              </p>
            </div>
            <Switch color="indigo" />
          </div>
        </div>
      </div>

      {/* Push Notifications */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-700">
          <BellIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Notificaciones Push
          </h4>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Visitas en Tiempo Real
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Notificación instantánea cuando llegue una visita
              </p>
            </div>
            <Switch color="indigo" defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Alertas de Seguridad
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Notificaciones importantes sobre seguridad
              </p>
            </div>
            <Switch color="indigo" defaultChecked />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Recordatorios
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Recordatorios sobre visitas próximas a expirar
              </p>
            </div>
            <Switch color="indigo" defaultChecked />
          </div>
        </div>
      </div>

      {/* SMS Notifications */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-700">
          <DevicePhoneMobileIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Notificaciones por SMS
          </h4>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Alertas Críticas
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Solo para situaciones de emergencia
              </p>
            </div>
            <Switch color="indigo" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Códigos de Verificación
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                SMS con códigos de autenticación
              </p>
            </div>
            <Switch color="indigo" defaultChecked />
          </div>
        </div>
      </div>

      {/* Info Note */}
      <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4">
        <p className="text-sm text-sky-800 dark:text-sky-200">
          <strong>Nota:</strong> Algunas notificaciones críticas de seguridad no se pueden desactivar para garantizar la protección de tu cuenta.
        </p>
      </div>
    </div>
  );
}
