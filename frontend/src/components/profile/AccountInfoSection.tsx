import { Badge } from '@/components/ui/Badge';
import {
  ShieldCheckIcon,
  CheckBadgeIcon,
  XCircleIcon,
  CalendarIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';
import type { UserWithFamily } from '@/types/index';

interface AccountInfoSectionProps {
  user: UserWithFamily;
}

export function AccountInfoSection({ user }: AccountInfoSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Información de la Cuenta
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Detalles sobre tu cuenta, roles y permisos
        </p>
      </div>

      {/* Account Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            {user.confirmed ? (
              <CheckBadgeIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <XCircleIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            )}
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Estado de la Cuenta
            </div>
          </div>
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {user.confirmed ? (
              <Badge color="lime">Confirmada</Badge>
            ) : (
              <Badge color="amber">Pendiente de Confirmación</Badge>
            )}
          </div>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-2">
            <CalendarIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Cuenta Creada
            </div>
          </div>
          <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {new Date(user.createdAt).toLocaleDateString('es-CL', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </div>
        </div>
      </div>

      {/* Roles */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheckIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Roles Asignados
          </h4>
        </div>
        {user.roles && user.roles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {user.roles.map((role: any) => (
              <Badge key={role.id} color="indigo">
                {role.name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No tienes roles asignados
          </p>
        )}
      </div>

      {/* Permissions */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <KeyIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Permisos
          </h4>
        </div>
        {user.roles && user.roles.length > 0 ? (
          <div className="space-y-2">
            {user.roles.map((role: any) => (
              <div
                key={role.id}
                className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3"
              >
                <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100 mb-2">
                  {role.name}
                </div>
                {role.permissions && role.permissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {role.permissions.map((permission: any) => (
                      <span
                        key={permission.id}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200"
                      >
                        {permission.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Sin permisos específicos
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No tienes permisos asignados
          </p>
        )}
      </div>

      {/* Family Info (if applicable) */}
      {user.family && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-2">
            Información Familiar
          </h4>
          <div className="space-y-1 text-sm text-indigo-800 dark:text-indigo-200">
            <p><span className="font-medium">Familia:</span> {user.family.name}</p>
            {user.family.unit && (
              <p><span className="font-medium">Unidad:</span> {user.family.unit.identifier}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
