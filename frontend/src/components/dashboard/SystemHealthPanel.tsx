import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import type { ServiceHealth } from '../../types/dashboard';

interface SystemHealthPanelProps {
  services: ServiceHealth[];
  loading?: boolean;
}

export function SystemHealthPanel({ services, loading = false }: SystemHealthPanelProps) {
  const getStatusIcon = (status: ServiceHealth['status']) => {
    switch (status) {
      case 'healthy':
        return <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />;
      case 'degraded':
        return <ExclamationTriangleIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
      case 'down':
        return <XCircleIcon className="h-5 w-5 text-red-600 dark:text-red-400" />;
    }
  };

  const getStatusColor = (status: ServiceHealth['status']) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400';
      case 'degraded':
        return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400';
      case 'down':
        return 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400';
    }
  };

  const getStatusText = (status: ServiceHealth['status']) => {
    switch (status) {
      case 'healthy':
        return 'Operativo';
      case 'degraded':
        return 'Degradado';
      case 'down':
        return 'Caído';
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded w-48 mb-6 animate-pulse"></div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-zinc-100 dark:bg-zinc-800 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
          Estado de Servicios
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
          No hay datos de servicios disponibles
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
        Estado de Servicios
      </h3>
      <div className="space-y-4">
        {services.map((service) => (
          <div
            key={service.name}
            className="flex items-center justify-between p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1">
              {getStatusIcon(service.status)}
              <div className="flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {service.name}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Última verificación: {new Date(service.lastCheck).toLocaleTimeString('es-ES')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {service.uptime.toFixed(1)}%
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Uptime</p>
              </div>
              {service.responseTime !== undefined && (
                <div className="text-right">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {service.responseTime}ms
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Respuesta</p>
                </div>
              )}
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(
                  service.status
                )}`}
              >
                {getStatusText(service.status)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
