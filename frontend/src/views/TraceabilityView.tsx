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
  ChevronLeftIcon
} from '@heroicons/react/24/outline'
import { listAccessAttempts } from '@/api/DetectionsAPI'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useId, useMemo, useState } from 'react'
import AnomalyTable from '@/components/traceability/AnomalyTable'
import { listAnomalies } from '@/api/DetectionsAPI'
import { ShieldExclamationIcon } from '@heroicons/react/24/outline'
import { countAccessDecisions } from '@/helpers/accessDecision'

interface StatCardProps {
  icon: typeof MapIcon
  iconClassName: string
  label: string
  value: number
  valueClassName: string
  footnote?: string
}

function StatCard({ icon: Icon, iconClassName, label, value, valueClassName, footnote }: StatCardProps) {
  const labelId = useId()

  return (
    <section
      aria-labelledby={labelId}
      className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700"
    >
      <div className="flex items-center gap-3 mb-2">
        <Icon aria-hidden="true" className={`w-6 h-6 ${iconClassName}`} />
        <p id={labelId} className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </p>
      </div>
      <p className={`text-3xl font-bold ${valueClassName}`}>{value.toLocaleString()}</p>
      {footnote ? <p className="text-xs text-zinc-500 mt-1">{footnote}</p> : null}
    </section>
  )
}

function shareOfTotal(count: number, total: number): string {
  return `${total > 0 ? ((count / total) * 100).toFixed(1) : 0}% del total`
}

export default function TraceabilityView() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data = [], isFetching } = useQuery({ 
    queryKey: ['detections', 'attempts'], 
    queryFn: () => listAccessAttempts() 
  })
  const { data: anomalies = [], isError: isAnomaliesError } = useQuery({
    queryKey: ['anomalies'], 
    queryFn: () => listAnomalies() 
  })

  // `?tab=anomalies` permite volver desde el detalle de una anomalía a su pestaña.
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<'access' | 'anomalies'>(
    searchParams.get('tab') === 'anomalies' ? 'anomalies' : 'access',
  )

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['detections', 'attempts'] })
  }

  // Calcular estadísticas. "Aprobado" es solo `Permitido`: un `Duplicado`
  // nunca abre el portón, así que no suma como acceso aprobado.
  const stats = useMemo(() => {
    const total = data.length
    const byDecision = countAccessDecisions(data)
    const approved = byDecision.Permitido
    const denied = byDecision.Denegado
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
        <StatCard
          icon={MapIcon}
          iconClassName="text-indigo-600 dark:text-indigo-400"
          label="Total de Intentos"
          value={stats.total}
          valueClassName="text-zinc-900 dark:text-zinc-100"
        />
        <StatCard
          icon={CheckCircleIcon}
          iconClassName="text-green-600 dark:text-green-400"
          label="Accesos Aprobados"
          value={stats.approved}
          valueClassName="text-green-600 dark:text-green-400"
          footnote={shareOfTotal(stats.approved, stats.total)}
        />
        <StatCard
          icon={XCircleIcon}
          iconClassName="text-red-600 dark:text-red-400"
          label="Accesos Denegados"
          value={stats.denied}
          valueClassName="text-red-600 dark:text-red-400"
          footnote={shareOfTotal(stats.denied, stats.total)}
        />
        <StatCard
          icon={ShieldExclamationIcon}
          iconClassName="text-red-600 dark:text-red-400"
          label="Anomalías IA"
          value={anomalies.length}
          valueClassName="text-red-600 dark:text-red-400"
          footnote={isAnomaliesError ? 'No se pudieron cargar' : 'Eventos críticos detectados'}
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-6">
        <button
          onClick={() => setActiveTab('access')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'access' 
              ? 'border-teal-500 text-teal-600 dark:text-teal-400' 
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          Trazabilidad de Accesos (LPR)
        </button>
        <button
          onClick={() => setActiveTab('anomalies')}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'anomalies' 
              ? 'border-teal-500 text-teal-600 dark:text-teal-400' 
              : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
          }`}
        >
          Anomalías de Seguridad (IA)
        </button>
      </div>

      {/* Table Selection */}
      {activeTab === 'access' ? <TraceabilityTable /> : <AnomalyTable />}
    </div>
  )
}
