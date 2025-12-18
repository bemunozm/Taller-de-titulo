import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheckIcon,
  UsersIcon,
  VideoCameraIcon,
  ArrowPathIcon,
  CalendarIcon,
  LockOpenIcon,
  QrCodeIcon,
  CameraIcon,
} from '@heroicons/react/24/outline';
import { StatsCard } from '../components/dashboard/StatsCard';
import { VisitsTrendChart } from '../components/dashboard/VisitsTrendChart';
import { SystemHealthPanel } from '../components/dashboard/SystemHealthPanel';
import { RecentActivityFeed } from '../components/dashboard/RecentActivityFeed';
import { DetectionsTable } from '../components/dashboard/DetectionsTable';
import DashboardAPI from '../api/DashboardAPI';
import { Heading } from '@/components/ui/Heading';
import { Button } from '@/components/ui/Button';

// Dashboard Ejecutivo con Acciones Rápidas
export default function DashboardView() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');
  const [trendDays, setTrendDays] = useState(7);

  // Query para el resumen completo
  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['dashboard-summary', period],
    queryFn: () => DashboardAPI.getSummary({ period }),
    refetchOnWindowFocus: false, // No recargar al hacer alt+tab
    staleTime: 5 * 60 * 1000, // Datos válidos por 5 minutos
  });

  // Query para la tendencia de visitas
  const {
    data: visitsTrend,
    isLoading: trendLoading,
  } = useQuery({
    queryKey: ['visits-trend', trendDays],
    queryFn: () => DashboardAPI.getVisitsTrend({ days: trendDays }),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  // Query para actividad reciente
  const {
    data: recentActivity,
    isLoading: activityLoading,
  } = useQuery({
    queryKey: ['recent-activity'],
    queryFn: () => DashboardAPI.getRecentActivity({ limit: 10 }),
    refetchOnWindowFocus: false,
    staleTime: 2 * 60 * 1000, // 2 minutos para actividad reciente
  });

  // Query para últimas detecciones
  const {
    data: latestDetections,
    isLoading: detectionsLoading,
  } = useQuery({
    queryKey: ['latest-detections'],
    queryFn: () => DashboardAPI.getLatestDetections({ limit: 10 }),
    refetchOnWindowFocus: false,
    staleTime: 2 * 60 * 1000,
  });

  const handleRefresh = () => {
    refetchSummary();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Heading>Dashboard Ejecutivo</Heading>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Visión completa del sistema en tiempo real
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Selector de período */}
            <div className="flex items-center justify-center gap-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1">
              <button
                onClick={() => setPeriod('today')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  period === 'today'
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                Hoy
              </button>
              <button
                onClick={() => setPeriod('week')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  period === 'week'
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                Semana
              </button>
              <button
                onClick={() => setPeriod('month')}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  period === 'month'
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                Mes
              </button>
            </div>
            <Button onClick={handleRefresh} className="w-full sm:w-auto">
              <ArrowPathIcon className="h-5 w-5" />
              Actualizar
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards Principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Detecciones Hoy"
          value={summary?.security.detectionsToday ?? 0}
          description={`${summary?.security.detectionsWeek ?? 0} esta semana`}
          icon={<VideoCameraIcon className="h-6 w-6" />}
          color="amber"
          loading={summaryLoading}
        />
        <StatsCard
          title="Visitas Activas"
          value={summary?.security.activeVisits ?? 0}
          description={`${summary?.security.pendingVisits ?? 0} esperando ingreso`}
          icon={<UsersIcon className="h-6 w-6" />}
          color="blue"
          loading={summaryLoading}
        />
        <StatsCard
          title="Cámaras Activas"
          value={`${summary?.systemHealth.camerasActive ?? 0}/${summary?.systemHealth.camerasTotal ?? 0}`}
          description={`${summary?.systemHealth.camerasInactive ?? 0} inactivas`}
          icon={<VideoCameraIcon className="h-6 w-6" />}
          color="green"
          loading={summaryLoading}
        />
        <StatsCard
          title="Error Rate"
          value={`${summary?.systemHealth.errorRateLast24h.toFixed(2) ?? '0.00'}%`}
          description={`${summary?.systemHealth.criticalErrorsToday ?? 0} errores críticos hoy`}
          icon={<ShieldCheckIcon className="h-6 w-6" />}
          color={
            (summary?.systemHealth.errorRateLast24h ?? 0) > 5
              ? 'red'
              : (summary?.systemHealth.errorRateLast24h ?? 0) > 2
              ? 'amber'
              : 'green'
          }
          loading={summaryLoading}
        />
      </div>

      {/* Stats Cards Secundarias */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatsCard
          title="Confianza Promedio Detección"
          value={`${((summary?.systemHealth.avgResponseTime ?? 0) * 100).toFixed(1)}%`}
          description="Precisión del OCR/Detector IA"
          icon={<ShieldCheckIcon className="h-6 w-6" />}
          color={
            (summary?.systemHealth.avgResponseTime ?? 0) > 0.9
              ? 'green'
              : (summary?.systemHealth.avgResponseTime ?? 0) > 0.75
              ? 'amber'
              : 'red'
          }
          loading={summaryLoading}
        />
        <StatsCard
          title="Familias Activas"
          value={`${summary?.userActivity.activeFamilies ?? 0}/${summary?.userActivity.totalFamilies ?? 0}`}
          description={`${summary?.userActivity.totalUsers ?? 0} usuarios totales`}
          icon={<UsersIcon className="h-6 w-6" />}
          color="indigo"
          loading={summaryLoading}
        />
        <StatsCard
          title="Duración Promedio Visita"
          value={`${summary?.security.avgVisitDuration ?? 0} min`}
          description={`${summary?.security.completedVisitsToday ?? 0} completadas hoy`}
          icon={<CalendarIcon className="h-6 w-6" />}
          color="blue"
          loading={summaryLoading}
        />
      </div>

      {/* Panel de Acciones Rápidas */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 rounded-lg border border-blue-200 dark:border-blue-900 p-6">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
          Acciones Rápidas
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Abrir Puerta */}
          <button
            onClick={() => {
              console.log('Abriendo puerta principal...');
            }}
            className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-green-400 dark:hover:border-green-600 hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-green-100 dark:bg-green-500/10 rounded-lg group-hover:bg-green-200 dark:group-hover:bg-green-500/20 transition-colors">
                <LockOpenIcon className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Abrir Puerta
              </span>
            </div>
          </button>

          {/* Abrir Portón */}
          <button
            onClick={() => {
              console.log('Abriendo portón vehicular...');
            }}
            className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-blue-600 hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-blue-100 dark:bg-blue-500/10 rounded-lg group-hover:bg-blue-200 dark:group-hover:bg-blue-500/20 transition-colors">
                <LockOpenIcon className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Abrir Portón
              </span>
            </div>
          </button>

          {/* Escanear QR */}
          <button
            onClick={() => {
              navigate('/qr-scanner');
            }}
            className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-purple-400 dark:hover:border-purple-600 hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-purple-100 dark:bg-purple-500/10 rounded-lg group-hover:bg-purple-200 dark:group-hover:bg-purple-500/20 transition-colors">
                <QrCodeIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Escanear QR
              </span>
            </div>
          </button>

          {/* Ver Cámaras en Vivo */}
          <button
            onClick={() => {
              navigate('/cameras');
            }}
            className="w-full h-32 p-4 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-amber-400 dark:hover:border-amber-600 hover:shadow-md transition-all group"
          >
            <div className="flex flex-col items-center justify-center gap-2 h-full">
              <div className="p-3 bg-amber-100 dark:bg-amber-500/10 rounded-lg group-hover:bg-amber-200 dark:group-hover:bg-amber-500/20 transition-colors">
                <CameraIcon className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Ver Cámaras
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Gráfico de Tendencia */
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Tendencia de Actividad
          </h2>
          <div className="flex items-center gap-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-1">
            <button
              onClick={() => setTrendDays(7)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                trendDays === 7
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              7 días
            </button>
            <button
              onClick={() => setTrendDays(14)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                trendDays === 14
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              14 días
            </button>
            <button
              onClick={() => setTrendDays(30)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                trendDays === 30
                  ? 'bg-blue-600 text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              30 días
            </button>
          </div>
        </div>
        <VisitsTrendChart data={visitsTrend ?? []} loading={trendLoading} />
      </div>
}
      {/* Panel de Estado de Servicios */}
      <SystemHealthPanel
        services={summary?.systemHealth.services ?? []}
        loading={summaryLoading}
      />

      {/* Grid de Actividad y Detecciones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentActivityFeed activities={recentActivity ?? []} loading={activityLoading} />
        <DetectionsTable detections={latestDetections ?? []} loading={detectionsLoading} />
      </div>

      {/* Top Audit Actions */}
      {summary?.userActivity.topAuditActions && summary.userActivity.topAuditActions.length > 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-6">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-6">
            Top Acciones de Auditoría
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {summary.userActivity.topAuditActions.map((action, index) => (
              <div
                key={`${action.module}-${action.action}`}
                className="flex items-center justify-between p-4 rounded-lg bg-zinc-50 dark:bg-zinc-800/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-sm font-semibold">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {action.action}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{action.module}</p>
                  </div>
                </div>
                <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  {action.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer con última actualización */}
      <div className="text-center text-xs text-zinc-400 dark:text-zinc-500">
        Última actualización:{' '}
        {summary?.lastUpdated
          ? new Date(summary.lastUpdated).toLocaleString('es-ES')
          : 'Cargando...'}
      </div>
    </div>
  );
}
