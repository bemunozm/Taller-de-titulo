import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Heading, Subheading } from '@/components/ui/Heading'
import { Text } from '@/components/ui/Text'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import DashboardAPI from '@/api/DashboardAPI'
import api from '@/lib/axios'
import { toast } from 'react-toastify'
import { 
  ClockIcon, 
  CheckCircleIcon, 
  XCircleIcon,
  ChartBarIcon,
  ArrowDownTrayIcon
} from '@heroicons/react/24/outline'

export default function MetricsView() {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today')

  const { data: metrics, isLoading, error, refetch } = useQuery({
    queryKey: ['response-time-metrics', period],
    queryFn: () => DashboardAPI.getResponseTimeMetrics(period),
    refetchInterval: 30000, // Actualizar cada 30 segundos
  })

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const getComplianceColor = (rate: number) => {
    if (rate >= 95) return 'green'
    if (rate >= 80) return 'yellow'
    return 'red'
  }

  const periodLabels = {
    today: 'Hoy',
    week: 'Esta semana',
    month: 'Este mes',
  }

  const exportDetailedMetrics = async () => {
    try {
      const params = new URLSearchParams({ period })
      const { data } = await api.get(`/dashboard/metrics/response-time/detailed?${params}`)
      
      if (!data || data.length === 0) {
        toast.error('No hay datos para exportar')
        return
      }

      const csvData = data.map((row: any) => ({
        'ID Detección': row.detectionId,
        'Patente': row.plate || '',
        'Cámara': row.cameraId || '',
        'Fecha Detección': new Date(row.detectionCreatedAt).toISOString().replace('T', ' ').slice(0, 19),
        'Decisión': row.decision || '',
        'Método': row.method || '',
        'Fecha Decisión': row.attemptCreatedAt ? new Date(row.attemptCreatedAt).toISOString().replace('T', ' ').slice(0, 19) : '',
        'Tiempo de Respuesta (ms)': row.responseTimeMs || '',
        'Tiempo de Respuesta (s)': row.responseTimeMs ? (row.responseTimeMs / 1000).toFixed(3) : '',
        'Cumple SLA (≤5s)': row.responseTimeMs && row.responseTimeMs <= 5000 ? 'Sí' : 'No',
        'Confianza Detección': row.detConfidence ? (row.detConfidence * 100).toFixed(2) + '%' : '',
        'Confianza OCR': row.ocrConfidence ? (row.ocrConfidence * 100).toFixed(2) + '%' : ''
      }))

      const headers = Object.keys(csvData[0])
      const csv = [
        headers.join(','),
        ...csvData.map((row: any) =>
          headers.map((header) => `"${row[header]}"`).join(',')
        )
      ].join('\n')

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `metricas_respuesta_${period}_${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      toast.success(`CSV exportado exitosamente (${data.length} registros)`)
    } catch (error: any) {
      console.error('Error al exportar métricas:', error)
      toast.error('Error al exportar los datos: ' + (error.response?.data?.message || error.message))
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-800 rounded w-1/3"></div>
          <div className="h-4 bg-zinc-800 rounded w-1/2"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-zinc-800 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="rounded-lg bg-red-900/20 border border-red-900 p-4">
          <Text className="text-red-400">Error al cargar métricas: {(error as Error).message}</Text>
          <Button onClick={() => refetch()} className="mt-4">Reintentar</Button>
        </div>
      </div>
    )
  }

  if (!metrics) return null

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Heading className="text-gray-900 dark:text-white">Métricas de Rendimiento</Heading>
          <Subheading className="text-gray-600 dark:text-gray-400">
            Tiempo de respuesta del sistema y cumplimiento de SLA
          </Subheading>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-2">
            {(['today', 'week', 'month'] as const).map((p) => (
              <Button
                key={p}
                color={period === p ? 'indigo' : 'white'}
                onClick={() => setPeriod(p)}
              >
                {periodLabels[p]}
              </Button>
            ))}
          </div>
          <Button outline onClick={exportDetailedMetrics}>
            <ArrowDownTrayIcon className="w-5 h-5" />
            Exportar Datos
          </Button>
        </div>
      </header>

      {/* SLA Compliance Card */}
      <div className="mb-6 rounded-lg bg-gradient-to-br from-indigo-900/40 to-purple-900/40 p-6 shadow-sm ring-1 ring-white/10 border border-indigo-900/50">
        <div className="flex items-start justify-between">
          <div>
            <Text className="text-sm font-medium text-indigo-200">Cumplimiento SLA (≤ 5 segundos)</Text>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-5xl font-bold text-white">{metrics.complianceRate.toFixed(1)}%</span>
              <Badge color={getComplianceColor(metrics.complianceRate)}>
                {metrics.complianceRate >= 95 ? 'Excelente' : metrics.complianceRate >= 80 ? 'Aceptable' : 'Crítico'}
              </Badge>
            </div>
            <div className="mt-2 text-sm text-indigo-200">
              {metrics.detectionsUnder5s} de {metrics.totalDetections} detecciones
            </div>
          </div>
          <div className="rounded-full bg-indigo-500/20 p-3">
            <ChartBarIcon className="w-8 h-8 text-indigo-300" />
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 h-2 w-full rounded-full bg-white/10 overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 ${
              metrics.complianceRate >= 95 
                ? 'bg-green-500' 
                : metrics.complianceRate >= 80 
                ? 'bg-yellow-500' 
                : 'bg-red-500'
            }`}
            style={{ width: `${metrics.complianceRate}%` }}
          />
        </div>
      </div>

      {/* Time Statistics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Average Time */}
        <article className="rounded-lg bg-zinc-900 p-5 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <ClockIcon className="w-5 h-5 text-blue-400" />
            </div>
            <Text className="text-sm font-medium text-zinc-300">Tiempo Promedio</Text>
          </div>
          <div className="text-3xl font-bold text-white">{formatTime(metrics.avgResponseTimeMs)}</div>
          <div className="mt-1 text-xs text-zinc-400">
            {metrics.avgResponseTimeMs <= 5000 ? '✓ Dentro del objetivo' : '⚠ Supera objetivo'}
          </div>
        </article>

        {/* Min Time */}
        <article className="rounded-lg bg-zinc-900 p-5 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-green-500/20 p-2">
              <CheckCircleIcon className="w-5 h-5 text-green-400" />
            </div>
            <Text className="text-sm font-medium text-zinc-300">Tiempo Mínimo</Text>
          </div>
          <div className="text-3xl font-bold text-white">{formatTime(metrics.minResponseTimeMs)}</div>
          <div className="mt-1 text-xs text-zinc-400">Mejor caso registrado</div>
        </article>

        {/* Max Time */}
        <article className="rounded-lg bg-zinc-900 p-5 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-red-500/20 p-2">
              <XCircleIcon className="w-5 h-5 text-red-400" />
            </div>
            <Text className="text-sm font-medium text-zinc-300">Tiempo Máximo</Text>
          </div>
          <div className="text-3xl font-bold text-white">{formatTime(metrics.maxResponseTimeMs)}</div>
          <div className="mt-1 text-xs text-zinc-400">Peor caso registrado</div>
        </article>

        {/* Median Time */}
        <article className="rounded-lg bg-zinc-900 p-5 shadow-sm ring-1 ring-white/5 border border-zinc-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <ChartBarIcon className="w-5 h-5 text-purple-400" />
            </div>
            <Text className="text-sm font-medium text-zinc-300">Tiempo Mediano</Text>
          </div>
          <div className="text-3xl font-bold text-white">{formatTime(metrics.medianResponseTimeMs)}</div>
          <div className="mt-1 text-xs text-zinc-400">50% de casos</div>
        </article>
      </div>

      {/* By Decision Type */}
      <div className="rounded-lg bg-zinc-900 p-6 shadow-sm ring-1 ring-white/5 border border-zinc-800">
        <Heading className="text-lg mb-4 text-white">Tiempo de Respuesta por Tipo de Decisión</Heading>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Permitido */}
          {metrics.byDecision.Permitido && (
            <div className="rounded-lg bg-green-900/20 border border-green-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <Text className="text-sm font-medium text-green-400">Permitido</Text>
                <Badge color="green">{metrics.byDecision.Permitido.count}</Badge>
              </div>
              <div className="text-2xl font-bold text-white">
                {formatTime(metrics.byDecision.Permitido.avgMs)}
              </div>
              <div className="mt-1 text-xs text-green-300">
                Promedio de vehículos autorizados
              </div>
            </div>
          )}

          {/* Denegado */}
          {metrics.byDecision.Denegado && (
            <div className="rounded-lg bg-red-900/20 border border-red-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <Text className="text-sm font-medium text-red-400">Denegado</Text>
                <Badge color="red">{metrics.byDecision.Denegado.count}</Badge>
              </div>
              <div className="text-2xl font-bold text-white">
                {formatTime(metrics.byDecision.Denegado.avgMs)}
              </div>
              <div className="mt-1 text-xs text-red-300">
                Promedio de accesos denegados
              </div>
            </div>
          )}

          {/* Pendiente */}
          {metrics.byDecision.Pendiente && (
            <div className="rounded-lg bg-yellow-900/20 border border-yellow-900/50 p-4">
              <div className="flex items-center justify-between mb-2">
                <Text className="text-sm font-medium text-yellow-400">Pendiente</Text>
                <Badge color="yellow">{metrics.byDecision.Pendiente.count}</Badge>
              </div>
              <div className="text-2xl font-bold text-white">
                {formatTime(metrics.byDecision.Pendiente.avgMs)}
              </div>
              <div className="mt-1 text-xs text-yellow-300">
                Promedio de aprobaciones manuales
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info Footer */}
      <div className="mt-6 rounded-lg bg-zinc-900/60 border border-zinc-800 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-blue-500/20 p-2 mt-0.5">
            <ClockIcon className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <Text className="text-sm font-medium text-zinc-200">Objetivo de Rendimiento</Text>
            <Text className="text-xs text-zinc-400 mt-1">
              El sistema tiene como meta procesar el 95% de las detecciones en menos de 5 segundos, 
              desde que el LPR detecta la patente hasta que se toma una decisión de acceso.
            </Text>
            <Text className="text-xs text-zinc-500 mt-2">
              Última actualización: {new Date().toLocaleTimeString('es-CL')} • 
              Período: {periodLabels[period]} • 
              Actualización automática cada 30 segundos
            </Text>
          </div>
        </div>
      </div>
    </div>
  )
}
