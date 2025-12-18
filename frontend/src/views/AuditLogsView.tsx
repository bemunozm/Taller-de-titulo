import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeftIcon,
  ArrowPathIcon,
  DocumentArrowDownIcon,
  ClockIcon,
  UserGroupIcon,
  CubeIcon,
  BoltIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { Heading, Subheading } from '@/components/ui/Heading';
import { AuditLogsTable } from '@/components/audit/AuditLogsTable';
import { getAuditLogs, getAuditStats } from '@/api/AuditAPI';

export default function AuditLogsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: logs = [], isLoading, isFetching: isFetchingLogs } = useQuery({
    queryKey: ['auditLogs'],
    queryFn: () => getAuditLogs({ limit: 1000 }), // Cargar hasta 1000 registros
    select: (data) => data.data,
  });

  const { data: stats, isFetching: isFetchingStats } = useQuery({
    queryKey: ['auditStats'],
    queryFn: () => getAuditStats(),
  });

  const isRefreshing = isFetchingLogs || isFetchingStats;

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
    queryClient.invalidateQueries({ queryKey: ['auditStats'] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
        <span className="ml-3 text-zinc-600 dark:text-zinc-400">
          Cargando registros de auditoría...
        </span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <Button plain onClick={() => navigate('/settings')} className="mb-4 text-zinc-400 hover:text-white">
        <ChevronLeftIcon className="h-5 w-5" />
        Volver a Configuraciones
      </Button>

      {/* Header */}
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <ClockIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <div>
            <Heading>Registros de Auditoría</Heading>
            <Subheading>
              Historial completo de acciones realizadas en el sistema
            </Subheading>
          </div>
        </div>
        <div className="flex gap-2">
          <Button outline onClick={handleRefresh} disabled={isRefreshing}>
            <ArrowPathIcon className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Actualizando...' : 'Actualizar'}
          </Button>
          <Button outline onClick={() => window.dispatchEvent(new CustomEvent('audit:export-csv'))}>
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
              <ClockIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Total de Registros
              </div>
            </div>
            <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              {stats.totalLogs?.toLocaleString() || 0}
            </div>
          </div>

          {/* Active Users */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <UserGroupIcon className="w-6 h-6 text-lime-600 dark:text-lime-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Usuarios Activos
              </div>
            </div>
            <div className="text-3xl font-bold text-lime-600 dark:text-lime-400">
              {stats.activeUsers || 0}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Con actividad registrada
            </div>
          </div>

          {/* Modules */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <CubeIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Módulos Auditados
              </div>
            </div>
            <div className="text-3xl font-bold text-sky-600 dark:text-sky-400">
              {stats.byModule ? Object.keys(stats.byModule).length : 0}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {stats.byModule && Object.entries(stats.byModule).length > 0 && (
                <>
                  Más activo:{' '}
                  {Object.entries(stats.byModule).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || '-'}
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3 mb-2">
              <BoltIcon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Tipos de Acciones
              </div>
            </div>
            <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
              {stats.byAction ? Object.keys(stats.byAction).length : 0}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {stats.byAction && Object.entries(stats.byAction).length > 0 && (
                <>
                  Más común:{' '}
                  {Object.entries(stats.byAction).sort(([, a], [, b]) => (b as number) - (a as number))[0]?.[0] || '-'}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <AuditLogsTable logs={logs} />
    </div>
  );
}
