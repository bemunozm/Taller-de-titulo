import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeftIcon,
  ArrowPathIcon,
  DocumentArrowDownIcon,
  ServerIcon,
  ShieldExclamationIcon,
  BoltIcon,
  ClockIcon,
  SignalIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Heading, Subheading } from '@/components/ui/Heading';
import { SystemLogsTable } from '@/components/logs/SystemLogsTable';
import { getSystemLogs, getSystemLogStats } from '@/api/LogsAPI';

export default function SystemLogsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: logs = [], isLoading, isFetching: isFetchingLogs } = useQuery({
    queryKey: ['systemLogs'],
    queryFn: () => getSystemLogs({ limit: 1000 }),
    select: (data) => data.data,
  });

  const { data: stats, isFetching: isFetchingStats } = useQuery({
    queryKey: ['systemLogStats'],
    queryFn: () => getSystemLogStats(),
  });

  const isRefreshing = isFetchingLogs || isFetchingStats;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['systemLogs'] });
    queryClient.invalidateQueries({ queryKey: ['systemLogStats'] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando logs del sistema...
        </span>
      </div>
    );
  }

  // Calcular error rate si hay datos
  const errorRate = stats?.byLevel 
    ? ((stats.byLevel.ERROR || 0) + (stats.byLevel.FATAL || 0)) / stats.totalLogs * 100
    : 0;

  return (
    <div className="max-w-7xl mx-auto">
      <Button plain onClick={() => navigate('/settings')} className="mb-4 text-zinc-400 hover:text-white">
        <ChevronLeftIcon className="h-5 w-5" />
        Volver a Configuraciones
      </Button>

      {/* Header */}
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ServerIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <div>
            <Heading>Logs del Sistema</Heading>
            <Subheading>
              Monitoreo y rastreo de comunicaciones entre servicios
            </Subheading>
          </div>
        </div>
        <div className="flex gap-2">
          <Button outline onClick={handleRefresh} disabled={isRefreshing}>
            <ArrowPathIcon className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Actualizando...' : 'Actualizar'}
          </Button>
          <Button outline onClick={() => window.dispatchEvent(new CustomEvent('system-logs:export-csv'))}>
            <DocumentArrowDownIcon />
            Exportar
          </Button>
        </div>
      </header>

      {/* Stats Grid */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Total Logs */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <ServerIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Total de Logs
              </div>
            </div>
            <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {stats.totalLogs?.toLocaleString() || 0}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Últimos 30 días
            </div>
          </div>

          {/* Error Rate */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <ShieldExclamationIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Tasa de Errores
              </div>
            </div>
            <div className="text-3xl font-bold text-red-600 dark:text-red-400">
              {errorRate.toFixed(1)}%
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {(stats.byLevel?.ERROR || 0) + (stats.byLevel?.FATAL || 0)} errores totales
            </div>
          </div>

          {/* Avg Response Time */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <ClockIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Tiempo Promedio
              </div>
            </div>
            <div className="text-3xl font-bold text-sky-600 dark:text-sky-400">
              {stats.averageResponseTime ? `${Math.round(stats.averageResponseTime)}ms` : '-'}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Tiempo de respuesta
            </div>
          </div>

          {/* Services */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <SignalIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Servicios Activos
              </div>
            </div>
            <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
              {stats.byService ? Object.keys(stats.byService).length : 0}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {stats.byService && Object.entries(stats.byService).length > 0 && (
                <>
                  Más activo:{' '}
                  {Object.entries(stats.byService).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || '-'}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Level Distribution */}
      {stats?.byLevel && (
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <BoltIcon className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Distribución por Nivel
            </h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(stats.byLevel).map(([level, count]) => {
              const colors: Record<string, string> = {
                DEBUG: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300',
                INFO: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-300',
                WARN: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
                ERROR: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
                FATAL: 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300',
              };
              
              return (
                <div
                  key={level}
                  className={`rounded-lg p-3 ${colors[level] || colors.INFO}`}
                >
                  <div className="text-xs font-medium mb-1">{level}</div>
                  <div className="text-2xl font-bold">{count}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Errors */}
      {stats?.topErrors && stats.topErrors.length > 0 && (
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700 mb-6">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
            Errores Más Comunes
          </h3>
          <div className="space-y-2">
            {stats.topErrors.slice(0, 5).map((error, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 bg-zinc-50 dark:bg-zinc-900 rounded"
              >
                <div className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-1 flex-1">
                  {error.message}
                </div>
                <div className="text-sm font-semibold text-red-600 dark:text-red-400 ml-3">
                  {error.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <SystemLogsTable logs={logs} />
    </div>
  );
}
