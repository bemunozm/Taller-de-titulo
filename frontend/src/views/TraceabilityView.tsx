import TraceabilityTable from '@/components/traceability/TraceabilityTable'
import { Button } from '@/components/ui/Button'
import { Heading, Subheading } from '@/components/ui/Heading'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { 
  ArrowPathIcon, 
  DocumentArrowDownIcon,
  MapIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ChevronLeftIcon
} from '@heroicons/react/24/outline'
import { listAccessAttempts } from '@/api/DetectionsAPI'
import { useNavigate } from 'react-router-dom'
import { useMemo } from 'react'

export default function TraceabilityView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data = [], isFetching } = useQuery({ 
    queryKey: ['detections', 'attempts'], 
    queryFn: () => listAccessAttempts() 
  })

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['detections', 'attempts'] })
  }

  // Calcular estadísticas
  const stats = useMemo(() => {
    const total = data.length
    const approved = data.filter(d => d.decision === 'Aprovado').length
    const denied = data.filter(d => d.decision === 'Denegado').length
    const today = new Date().toISOString().slice(0, 10)
    const todayAttempts = data.filter(d => 
      new Date(d.createdAt).toISOString().slice(0, 10) === today
    ).length
    
    return { total, approved, denied, todayAttempts }
  }, [data])

  return (
    <div className="max-w-7xl mx-auto">
      <Button plain onClick={() => navigate('/settings')} className="mb-4 text-zinc-400 hover:text-white">
        <ChevronLeftIcon className="h-5 w-5" />
        Volver a Configuraciones
      </Button>

      {/* Header */}
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <MapIcon className="w-8 h-8 text-teal-600 dark:text-teal-400" />
          <div>
            <Heading>Trazabilidad de Accesos</Heading>
            <Subheading>
              Historial completo de intentos de acceso y detecciones
            </Subheading>
          </div>
        </div>
        <div className="flex gap-2">
          <Button outline onClick={handleRefresh} disabled={isFetching}>
            <ArrowPathIcon className={isFetching ? 'animate-spin' : ''} />
            {isFetching ? 'Actualizando...' : 'Actualizar'}
          </Button>
          <Button outline onClick={() => window.dispatchEvent(new CustomEvent('traceability:export-csv'))}>
            <DocumentArrowDownIcon />
            Exportar
          </Button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Total */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <MapIcon className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Total de Intentos
            </div>
          </div>
          <div className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.total.toLocaleString()}
          </div>
        </div>

        {/* Aprobados */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <CheckCircleIcon className="w-6 h-6 text-green-600 dark:text-green-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Accesos Aprobados
            </div>
          </div>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {stats.approved.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {stats.total > 0 ? ((stats.approved / stats.total) * 100).toFixed(1) : 0}% del total
          </div>
        </div>

        {/* Denegados */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <XCircleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Accesos Denegados
            </div>
          </div>
          <div className="text-3xl font-bold text-red-600 dark:text-red-400">
            {stats.denied.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {stats.total > 0 ? ((stats.denied / stats.total) * 100).toFixed(1) : 0}% del total
          </div>
        </div>

        {/* Hoy */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-3 mb-2">
            <ClockIcon className="w-6 h-6 text-sky-600 dark:text-sky-400" />
            <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Intentos Hoy
            </div>
          </div>
          <div className="text-3xl font-bold text-sky-600 dark:text-sky-400">
            {stats.todayAttempts.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            {new Date().toLocaleDateString('es-CL')}
          </div>
        </div>
      </div>

      {/* Table */}
      <TraceabilityTable />
    </div>
  )
}
