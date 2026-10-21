import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CameraIcon,
  ChevronLeftIcon,
  ClockIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
  ShieldExclamationIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { getAnomaly } from '@/api/DetectionsAPI'
import { listCameras } from '@/api/CameraAPI'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/ui/DescriptionList'
import { Heading, Subheading } from '@/components/ui/Heading'
import {
  ANOMALIES_LIST_PATH,
  anomalyMetadata,
  anomalySeverity,
  formatAnomalyConfidence,
  formatAnomalyDuration,
  resolveAnomalyCameraName,
} from '@/helpers/anomaly'
import { saveBlobAsFile } from '@/helpers/download'
import { ApiError } from '@/helpers/httpErrors'
import { anomalyTypeLabel, toJpegDataUrl } from '@/helpers/securityAlerts'

const CARD = 'rounded-lg border border-zinc-200 bg-white shadow dark:border-zinc-800 dark:bg-zinc-900'
const EMPTY = <span className="text-zinc-400 dark:text-zinc-600">-</span>

function formatTimestamp(value: string): string | null {
  const date = new Date(value)
  if (value === '' || Number.isNaN(date.getTime())) return null
  return date.toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'medium' })
}

function BackToList() {
  const navigate = useNavigate()
  return (
    <Button plain onClick={() => navigate(ANOMALIES_LIST_PATH)} className="mb-4">
      <ChevronLeftIcon className="h-5 w-5" />
      Volver a Trazabilidad
    </Button>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-7xl p-6" role="status" aria-label="Cargando anomalía">
      <div className="mb-4 h-10 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className={`${CARD} mb-6 p-6`}>
        <div className="mb-2 h-8 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className={`${CARD} h-72 animate-pulse lg:col-span-2`} />
        <div className={`${CARD} h-72 animate-pulse`} />
      </div>
    </div>
  )
}

interface DetailErrorProps {
  error: unknown
  onRetry: () => void
  retrying: boolean
}

function DetailError({ error, onRetry, retrying }: DetailErrorProps) {
  const status = error instanceof ApiError ? error.status : null
  const notFound = status === 404
  const forbidden = status === 403 || status === 401
  const title = notFound ? 'Anomalía no encontrada' : forbidden ? 'Sin acceso a esta anomalía' : 'No se pudo cargar la anomalía'
  const message =
    error instanceof Error && error.message ? error.message : 'Ocurrió un error inesperado. Intenta de nuevo.'

  return (
    <div className="mx-auto max-w-7xl p-6">
      <BackToList />
      <div role="alert" className={`${CARD} p-12 text-center`}>
        <ExclamationTriangleIcon className="mx-auto mb-4 h-16 w-16 text-red-500" aria-hidden="true" />
        <Heading className="mb-2">{title}</Heading>
        <p className="mb-6 text-zinc-500 dark:text-zinc-400">{message}</p>
        {notFound || forbidden ? null : (
          <Button outline onClick={onRetry} disabled={retrying}>
            <ArrowPathIcon className={retrying ? 'animate-spin' : ''} />
            Reintentar
          </Button>
        )}
      </div>
    </div>
  )
}

interface TechnicalFieldProps {
  label: string
  value: string | null
}

function TechnicalField({ label, value }: TechnicalFieldProps) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
      <dt className="mb-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</dt>
      <dd className="font-mono text-sm break-words text-zinc-700 dark:text-zinc-300">{value || EMPTY}</dd>
    </div>
  )
}

export default function AnomalyDetailView() {
  const { id = '' } = useParams()

  const anomalyQuery = useQuery({
    queryKey: ['anomalies', 'detail', id],
    queryFn: () => getAnomaly(id),
    enabled: id !== '',
    // Un 404/403 no se arregla reintentando.
    retry: false,
  })
  // El nombre de la cámara es un extra: si falla, se muestra el identificador.
  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: () => listCameras(), retry: false })

  const anomaly = anomalyQuery.data
  const cameraName = useMemo(
    () => (anomaly ? resolveAnomalyCameraName(anomaly.cameraId, cameras) : null),
    [anomaly, cameras],
  )

  if (anomalyQuery.isPending && id !== '') return <DetailSkeleton />
  if (!anomaly) {
    const error = id === '' ? new ApiError('Falta el identificador de la anomalía', 404) : anomalyQuery.error
    return <DetailError error={error} onRetry={() => anomalyQuery.refetch()} retrying={anomalyQuery.isFetching} />
  }

  const severity = anomalySeverity(anomaly.suspicionLevel)
  const imageSrc = toJpegDataUrl(anomaly.snapshotJpegB64)
  const when = formatTimestamp(anomaly.timestamp)
  const duration = formatAnomalyDuration(anomaly.durationSeconds)
  const typeLabel = anomalyTypeLabel(anomaly.anomalyType)
  const metadata = anomalyMetadata(anomaly)

  const downloadMetadata = () => {
    const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' })
    saveBlobAsFile(blob, `anomaly-${anomaly.id}-meta.json`)
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <nav aria-label="Ruta de navegación" className="mb-6">
        <ol className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <Link to="/traceability" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
              Trazabilidad
            </Link>
          </li>
          <ChevronLeftIcon className="h-4 w-4 rotate-180" aria-hidden="true" />
          <li>
            <Link to={ANOMALIES_LIST_PATH} className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
              Anomalías
            </Link>
          </li>
          <ChevronLeftIcon className="h-4 w-4 rotate-180" aria-hidden="true" />
          <li aria-current="page" className="font-medium text-zinc-900 dark:text-zinc-100">
            Detalle #{anomaly.id.slice(0, 8)}
          </li>
        </ol>
      </nav>

      <header className={`${CARD} mb-6 p-6`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-zinc-100 p-2 dark:bg-zinc-800">
              <ShieldExclamationIcon className="h-6 w-6 text-zinc-700 dark:text-zinc-300" aria-hidden="true" />
            </div>
            <div>
              <Heading className="mb-2">{typeLabel}</Heading>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon className="h-4 w-4" aria-hidden="true" />
                  {when ?? 'Fecha desconocida'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CameraIcon className="h-4 w-4" aria-hidden="true" />
                  {cameraName || 'Cámara sin identificar'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {severity ? (
              <Badge color={severity.color}>Riesgo {severity.label}</Badge>
            ) : (
              <Badge color="zinc">Sin evaluar</Badge>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section aria-labelledby="anomaly-evidence" className={CARD}>
            <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <PhotoIcon className="h-5 w-5 text-zinc-700 dark:text-zinc-300" aria-hidden="true" />
              <Subheading id="anomaly-evidence">Evidencia</Subheading>
            </div>
            <div className="p-6">
              {imageSrc ? (
                <img
                  src={imageSrc}
                  alt={`Captura de la anomalía en ${cameraName || 'la cámara'}`}
                  className="h-auto w-full rounded-lg border border-zinc-200 bg-zinc-950 object-contain dark:border-zinc-700"
                />
              ) : (
                <div className="rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-100 p-12 text-center dark:border-zinc-700 dark:bg-zinc-800">
                  <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">No hay imagen disponible</p>
                  <p className="text-xs text-zinc-500">Este evento se registró sin captura</p>
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="anomaly-analysis" className={CARD}>
            <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <SparklesIcon className="h-5 w-5 text-zinc-700 dark:text-zinc-300" aria-hidden="true" />
              <Subheading id="anomaly-analysis">Análisis de la IA</Subheading>
            </div>
            <div className="p-6">
              {anomaly.aiReasoning ? (
                <p className="text-sm/6 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{anomaly.aiReasoning}</p>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Sin evaluación disponible</p>
              )}
            </div>
          </section>

          <section aria-labelledby="anomaly-summary" className={CARD}>
            <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
              <DocumentTextIcon className="h-5 w-5 text-zinc-700 dark:text-zinc-300" aria-hidden="true" />
              <Subheading id="anomaly-summary">Información general</Subheading>
            </div>
            <div className="p-6">
              <DescriptionList>
                <DescriptionTerm>Tipo</DescriptionTerm>
                <DescriptionDetails>{typeLabel}</DescriptionDetails>

                <DescriptionTerm>Nivel de riesgo</DescriptionTerm>
                <DescriptionDetails>
                  {severity ? <Badge color={severity.color}>{severity.label}</Badge> : <span>Sin evaluar</span>}
                </DescriptionDetails>

                <DescriptionTerm>Confianza de la IA</DescriptionTerm>
                <DescriptionDetails>{formatAnomalyConfidence(anomaly.confidence)}</DescriptionDetails>

                <DescriptionTerm>Cámara</DescriptionTerm>
                <DescriptionDetails>{cameraName || EMPTY}</DescriptionDetails>

                <DescriptionTerm>Fecha y hora</DescriptionTerm>
                <DescriptionDetails>{when ?? EMPTY}</DescriptionDetails>

                <DescriptionTerm>Duración</DescriptionTerm>
                <DescriptionDetails>{duration ?? EMPTY}</DescriptionDetails>
              </DescriptionList>
            </div>
          </section>
        </div>

        <aside aria-labelledby="anomaly-technical" className={`${CARD} self-start`}>
          <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
            <CodeBracketIcon className="h-5 w-5 text-zinc-700 dark:text-zinc-300" aria-hidden="true" />
            <Subheading id="anomaly-technical">Datos técnicos</Subheading>
          </div>
          <div className="space-y-4 p-6">
            <dl className="space-y-3">
              <TechnicalField label="ID de la anomalía" value={anomaly.id} />
              <TechnicalField label="ID de la cámara" value={anomaly.cameraId} />
              <TechnicalField label="Tipo (código)" value={anomaly.anomalyType} />
              <TechnicalField
                label="Track"
                value={anomaly.trackId === null || anomaly.trackId === undefined ? null : String(anomaly.trackId)}
              />
            </dl>
            <Button onClick={downloadMetadata} className="w-full justify-center">
              <ArrowDownTrayIcon className="h-4 w-4" />
              Descargar JSON
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
