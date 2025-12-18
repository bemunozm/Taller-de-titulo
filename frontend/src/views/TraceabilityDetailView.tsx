import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listAccessAttempts, type AccessAttempt } from '@/api/DetectionsAPI'
import { listCameras } from '@/api/CameraAPI'
import { respondToPendingDetection } from '@/api/PendingDetectionsAPI'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { DescriptionList, DescriptionTerm, DescriptionDetails } from '@/components/ui/DescriptionList'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/Dialog'
import { Heading, Subheading } from '@/components/ui/Heading'
import { useState, useMemo } from 'react'
import { 
  ChevronLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  CameraIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  CodeBracketIcon,
  EyeIcon,
  EyeSlashIcon,
  MapPinIcon,
  UserCircleIcon,
  ShieldCheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentDuplicateIcon,
  CheckIcon,
  SparklesIcon,
  SignalIcon,
  FingerPrintIcon
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'

function prettyJSON(obj: any) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

export default function TraceabilityDetailView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showRawMeta, setShowRawMeta] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [copiedPlate, setCopiedPlate] = useState(false)
  const [showApproveDialog, setShowApproveDialog] = useState(false)
  const [showRejectDialog, setShowRejectDialog] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    summary: true,
    detection: true,
    image: true
  })

  // fetch all attempts then find the id (backend doesn't provide single attempt endpoint)
  const { data = [] as AccessAttempt[], isLoading } = useQuery({ 
    queryKey: ['detections', 'attempts'], 
    queryFn: () => listAccessAttempts() 
  })
  const attempt = (data || []).find((a: AccessAttempt) => a.id === id) as AccessAttempt | undefined

  // Fetch cameras to get camera name
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: () => listCameras()
  })

  // Mutation para aprobar detección
  const approveMutation = useMutation({
    mutationFn: (attemptId: string) => respondToPendingDetection(attemptId, 'approved', 'Aprobado desde trazabilidad'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['detections', 'attempts'] })
      toast.success('✅ Detección aprobada exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al aprobar la detección')
    },
  })

  // Mutation para rechazar detección
  const rejectMutation = useMutation({
    mutationFn: (attemptId: string) => respondToPendingDetection(attemptId, 'denied', 'Rechazado desde trazabilidad'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['detections', 'attempts'] })
      toast.success('✅ Detección rechazada exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al rechazar la detección')
    },
  })

  // Get camera name from cameraId
  const cameraName = useMemo(() => {
    if (!attempt?.detection?.cameraId) return null
    const camera = cameras.find(c => c.id === attempt.detection.cameraId)
    return camera?.name || camera?.location || attempt.detection.cameraId
  }, [attempt, cameras])

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!attempt) return null
    
    const det = attempt.detection
    const avgConfidence = det?.ocr_confidence && det?.det_confidence 
      ? ((det.ocr_confidence + det.det_confidence) / 2 * 100).toFixed(1)
      : det?.ocr_confidence 
        ? (det.ocr_confidence * 100).toFixed(1)
        : det?.det_confidence
          ? (det.det_confidence * 100).toFixed(1)
          : null

    const processingTime = det?.createdAt 
      ? Math.abs(new Date(attempt.createdAt).getTime() - new Date(det.createdAt).getTime()) / 1000
      : null

    return {
      avgConfidence,
      processingTime,
      hasImage: !!det?.full_frame_path,
      method: attempt.method || 'No especificado'
    }
  }, [attempt])

  const copyToClipboard = async (text: string, type: 'id' | 'plate') => {
    try {
      await navigator.clipboard.writeText(text)
      if (type === 'id') {
        setCopiedId(true)
        setTimeout(() => setCopiedId(false), 2000)
      } else {
        setCopiedPlate(true)
        setTimeout(() => setCopiedPlate(false), 2000)
      }
      toast.success('Copiado al portapapeles')
    } catch (err) {
      toast.error('Error al copiar')
    }
  }

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  // Skeleton Loading
  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-4 h-10 w-48 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse"></div>
        
        {/* Header Skeleton */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-zinc-200 dark:bg-zinc-800 rounded-lg animate-pulse"></div>
            <div className="flex-1">
              <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-2"></div>
              <div className="h-4 w-48 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse"></div>
            </div>
          </div>
        </div>

        {/* Stats Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-3"></div>
              <div className="h-8 w-16 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse"></div>
            </div>
          ))}
        </div>

        {/* Content Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-6">
                <div className="h-6 w-48 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-4"></div>
                <div className="space-y-3">
                  {[...Array(4)].map((_, j) => (
                    <div key={j} className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse"></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-6">
              <div className="h-6 w-32 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mb-4"></div>
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-20 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!attempt) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <Button plain onClick={() => navigate('/traceability')} className="mb-4 text-zinc-400 hover:text-white">
          <ChevronLeftIcon className="h-5 w-5" />
          Volver a Trazabilidad
        </Button>
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-12">
          <div className="text-center">
            <XCircleIcon className="mx-auto h-16 w-16 text-red-500 mb-4" />
            <Heading className="mb-2">Intento no encontrado</Heading>
            <p className="text-zinc-500 dark:text-zinc-400 mb-6">
              No se pudo encontrar el intento de acceso con ID: <code className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">{id}</code>
            </p>
            <Button onClick={() => navigate('/traceability')}>
              Volver a Trazabilidad
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const det = attempt.detection
  const meta = det?.meta || {}

  const decisionBadge = attempt.decision === 'Aprovado' ? (
    <Badge color="green" className="inline-flex items-center gap-1.5">
      <CheckCircleIcon className="w-5 h-5" />
      Aprobado
    </Badge>
  ) : attempt.decision === 'Denegado' ? (
    <Badge color="red" className="inline-flex items-center gap-1.5">
      <XCircleIcon className="w-5 h-5" />
      Denegado
    </Badge>
  ) : (
    <Badge color="zinc">{attempt.decision}</Badge>
  )

  const methodBadge = (() => {
    const method = attempt.method
    if (!method) return <Badge color="zinc">No especificado</Badge>
    
    const methodColors: Record<string, any> = {
      'lpr': { color: 'lime', label: 'LPR' },
      'facial': { color: 'sky', label: 'Facial' },
      'manual': { color: 'amber', label: 'Manual' },
      'qr': { color: 'purple', label: 'QR' }
    }
    
    const config = methodColors[method.toLowerCase()] || { color: 'zinc', label: method }
    return <Badge color={config.color}>{config.label}</Badge>
  })()

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Breadcrumb / Back Button */}
      <nav className="mb-6">
        <ol className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <button onClick={() => navigate('/settings')} className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
              Configuraciones
            </button>
          </li>
          <ChevronLeftIcon className="w-4 h-4 rotate-180" />
          <li>
            <button onClick={() => navigate('/traceability')} className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
              Trazabilidad
            </button>
          </li>
          <ChevronLeftIcon className="w-4 h-4 rotate-180" />
          <li className="font-medium text-zinc-900 dark:text-zinc-100">
            Detalle #{attempt.id.slice(0, 8)}
          </li>
        </ol>
      </nav>

      {/* Header Card */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-start gap-3 mb-3">
              <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                <MapPinIcon className="w-6 h-6 text-zinc-700 dark:text-zinc-300" />
              </div>
              <div>
                <Heading className="mb-2">Intento de Acceso</Heading>
                <div className="flex flex-wrap items-center gap-3 text-zinc-600 dark:text-zinc-400">
                  <div className="flex items-center gap-2">
                    <ClockIcon className="w-4 h-4" />
                    <span className="text-sm">
                      {new Date(attempt.createdAt).toLocaleDateString('es-CL', { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {decisionBadge}
            {methodBadge}
          </div>
        </div>

        {/* Botones de Aprobación/Rechazo - Solo si está Pendiente */}
        {attempt.decision === 'Pendiente' && (
          <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
                  Esta detección está pendiente de aprobación. Puedes aprobar o rechazar el acceso:
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  color="red"
                  onClick={() => setShowRejectDialog(true)}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <XCircleIcon className="w-5 h-5" />
                  {rejectMutation.isPending ? 'Rechazando...' : 'Rechazar Acceso'}
                </Button>
                <Button
                  color="lime"
                  onClick={() => setShowApproveDialog(true)}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <CheckCircleIcon className="w-5 h-5" />
                  {approveMutation.isPending ? 'Aprobando...' : 'Aprobar Acceso'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Confidence Score */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <SparklesIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Confianza Promedio</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {metrics?.avgConfidence ? `${metrics.avgConfidence}%` : 'N/A'}
          </div>
          {metrics?.avgConfidence && (
            <div className="mt-2 w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5">
              <div 
                className="bg-blue-600 h-1.5 rounded-full transition-all"
                style={{ width: `${metrics.avgConfidence}%` }}
              />
            </div>
          )}
        </div>

        {/* Processing Time */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <ClockIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Tiempo de Proceso</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {metrics?.processingTime !== null && metrics?.processingTime !== undefined
              ? `${metrics.processingTime.toFixed(2)}s`
              : 'N/A'
            }
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Desde detección hasta decisión
          </p>
        </div>

        {/* Method */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <FingerPrintIcon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Método</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {metrics?.method || 'N/A'}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Sistema de verificación
          </p>
        </div>

        {/* Image Status */}
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="flex items-center gap-3 mb-2">
            <CameraIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Evidencia Visual</span>
          </div>
          <div className="flex items-center gap-3">
            {metrics?.hasImage ? (
              <>
                <CheckCircleIcon className="w-8 h-8 text-green-600 dark:text-green-400" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Disponible</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Imagen capturada</p>
                </div>
              </>
            ) : (
              <>
                <XCircleIcon className="w-8 h-8 text-red-600 dark:text-red-400" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">No disponible</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Sin imagen</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content - Left Side */}
        <div className="lg:col-span-2 space-y-6">
          {/* Summary Section */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800">
            <div 
              className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              onClick={() => toggleSection('summary')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DocumentTextIcon className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                  <Subheading>Información General</Subheading>
                </div>
                {expandedSections.summary ? (
                  <ChevronUpIcon className="w-5 h-5 text-zinc-400" />
                ) : (
                  <ChevronDownIcon className="w-5 h-5 text-zinc-400" />
                )}
              </div>
            </div>
            {expandedSections.summary && (
              <div className="p-6">
                <DescriptionList>
                  <DescriptionTerm>
                    <div className="flex items-center gap-2">
                      <ShieldCheckIcon className="w-4 h-4 text-zinc-400" />
                      ID del Intento
                    </div>
                  </DescriptionTerm>
                  <DescriptionDetails>
                    <div className="flex items-center gap-2">
                      <code className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded font-mono text-xs">
                        {attempt.id}
                      </code>
                      <Button
                        plain
                        onClick={() => copyToClipboard(attempt.id, 'id')}
                        className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                      >
                        {copiedId ? (
                          <CheckIcon className="w-4 h-4 text-green-600" />
                        ) : (
                          <DocumentDuplicateIcon className="w-4 h-4 text-zinc-400" />
                        )}
                      </Button>
                    </div>
                  </DescriptionDetails>

                  <DescriptionTerm>
                    <div className="flex items-center gap-2">
                      <UserCircleIcon className="w-4 h-4 text-zinc-400" />
                      Residente
                    </div>
                  </DescriptionTerm>
                  <DescriptionDetails>
                    {attempt.residente ? (
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                          <UserCircleIcon className="w-5 h-5 text-zinc-500" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {attempt.residente.name}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {attempt.residente.email}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">No asignado</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>
                    <div className="flex items-center gap-2">
                      <MapPinIcon className="w-4 h-4 text-zinc-400" />
                      Familia
                    </div>
                  </DescriptionTerm>
                  <DescriptionDetails>
                    {attempt.residente?.family ? (
                      <div className="flex flex-col">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {attempt.residente.family.name}
                        </span>
                        {attempt.residente.family.address && (
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {attempt.residente.family.address}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">No asignada</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>Método de Acceso</DescriptionTerm>
                  <DescriptionDetails>{methodBadge}</DescriptionDetails>

                  <DescriptionTerm>Razón</DescriptionTerm>
                  <DescriptionDetails>
                    {attempt.reason ? (
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">{attempt.reason}</p>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">No especificada</span>
                    )}
                  </DescriptionDetails>
                </DescriptionList>
              </div>
            )}
          </div>

          {/* Detection Section */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800">
            <div 
              className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              onClick={() => toggleSection('detection')}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CameraIcon className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                  <Subheading>Detección Asociada</Subheading>
                </div>
                {expandedSections.detection ? (
                  <ChevronUpIcon className="w-5 h-5 text-zinc-400" />
                ) : (
                  <ChevronDownIcon className="w-5 h-5 text-zinc-400" />
                )}
              </div>
            </div>
            {expandedSections.detection && (
              <div className="p-6">
                <DescriptionList>
                  <DescriptionTerm>Patente Detectada</DescriptionTerm>
                  <DescriptionDetails>
                    {det?.plate ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded border border-zinc-300 dark:border-zinc-600">
                          {det.plate}
                        </span>
                        <Button
                          plain
                          onClick={() => copyToClipboard(det.plate, 'plate')}
                          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                        >
                          {copiedPlate ? (
                            <CheckIcon className="w-4 h-4 text-green-600" />
                          ) : (
                            <DocumentDuplicateIcon className="w-4 h-4 text-zinc-400" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">No detectada</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>Patente Raw (OCR)</DescriptionTerm>
                  <DescriptionDetails>
                    {det?.plate_raw ? (
                      <code className="bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded text-xs">
                        {det.plate_raw}
                      </code>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">-</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>Cámara</DescriptionTerm>
                  <DescriptionDetails>
                    {det?.cameraId ? (
                      <div className="flex items-center gap-2">
                        <CameraIcon className="w-4 h-4 text-zinc-500" />
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {cameraName || det.cameraId}
                        </span>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">-</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>
                    <div className="flex items-center gap-2">
                      <SparklesIcon className="w-4 h-4 text-zinc-400" />
                      Confianza Promedio
                    </div>
                  </DescriptionTerm>
                  <DescriptionDetails>
                    {metrics?.avgConfidence ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-zinc-200 dark:bg-zinc-700 rounded-full h-2.5 max-w-xs">
                            <div 
                              className={`h-2.5 rounded-full transition-all ${
                                Number(metrics.avgConfidence) >= 90 ? 'bg-green-600' :
                                Number(metrics.avgConfidence) >= 70 ? 'bg-yellow-600' :
                                'bg-red-600'
                              }`}
                              style={{ width: `${metrics.avgConfidence}%` }}
                            />
                          </div>
                          <span className="font-bold text-zinc-900 dark:text-zinc-100 min-w-[3.5rem] text-right">
                            {metrics.avgConfidence}%
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Promedio de detección ({det?.det_confidence ? (det.det_confidence * 100).toFixed(1) : 'N/A'}%) 
                          y OCR ({det?.ocr_confidence ? (det.ocr_confidence * 100).toFixed(1) : 'N/A'}%)
                        </p>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">-</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>
                    <div className="flex items-center gap-2">
                      <SignalIcon className="w-4 h-4 text-zinc-400" />
                      Confianza OCR
                    </div>
                  </DescriptionTerm>
                  <DescriptionDetails>
                    {det?.ocr_confidence ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-zinc-200 dark:bg-zinc-700 rounded-full h-2.5 max-w-xs">
                            <div 
                              className="bg-zinc-900 dark:bg-zinc-100 h-2.5 rounded-full transition-all"
                              style={{ width: `${(det.ocr_confidence * 100)}%` }}
                            />
                          </div>
                          <span className="font-bold text-zinc-900 dark:text-zinc-100 min-w-[3.5rem] text-right">
                            {(det.ocr_confidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Precisión del reconocimiento óptico de caracteres
                        </p>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">-</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>
                    <div className="flex items-center gap-2">
                      <SignalIcon className="w-4 h-4 text-zinc-400" />
                      Confianza Detección
                    </div>
                  </DescriptionTerm>
                  <DescriptionDetails>
                    {det?.det_confidence ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-zinc-200 dark:bg-zinc-700 rounded-full h-2.5 max-w-xs">
                            <div 
                              className="bg-zinc-900 dark:bg-zinc-100 h-2.5 rounded-full transition-all"
                              style={{ width: `${(det.det_confidence * 100)}%` }}
                            />
                          </div>
                          <span className="font-bold text-zinc-900 dark:text-zinc-100 min-w-[3.5rem] text-right">
                            {(det.det_confidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Confianza del modelo de detección de placas
                        </p>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">-</span>
                    )}
                  </DescriptionDetails>

                  <DescriptionTerm>Fecha de Detección</DescriptionTerm>
                  <DescriptionDetails>
                    {det?.createdAt ? (
                      <div className="flex items-center gap-2">
                        <ClockIcon className="w-4 h-4 text-zinc-400" />
                        <span>{new Date(det.createdAt).toLocaleString('es-CL')}</span>
                      </div>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">-</span>
                    )}
                  </DescriptionDetails>
                </DescriptionList>

                {/* Image Section - Now inside detection */}
                {expandedSections.image && (
                  <div className="mt-6 pt-6 border-t border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <CameraIcon className="w-5 h-5 text-zinc-500" />
                        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                          Imagen Capturada
                        </span>
                      </div>
                      {det?.full_frame_path && (
                        <Button 
                          plain
                          onClick={() => window.open(det.full_frame_path, '_blank')}
                          className="text-xs"
                        >
                          <EyeIcon className="w-4 h-4" />
                          Abrir original
                        </Button>
                      )}
                    </div>
                    {det?.full_frame_path ? (
                      <div className="space-y-3">
                        <div className="relative rounded-lg overflow-hidden border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 group">
                          {!imageLoaded && (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="flex flex-col items-center gap-2">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-zinc-600"></div>
                                <p className="text-xs text-zinc-500">Cargando imagen...</p>
                              </div>
                            </div>
                          )}
                          <img 
                            src={det.full_frame_path} 
                            alt="Frame capturado" 
                            className={`w-full h-auto transition-all duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'} group-hover:scale-105`}
                            onLoad={() => setImageLoaded(true)}
                          />
                          {imageLoaded && (
                            <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm text-white px-2 py-1 rounded text-xs">
                              {new Date(det.createdAt).toLocaleTimeString('es-CL')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 rounded p-2">
                          <code className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex-1">
                            {det.full_frame_path}
                          </code>
                          <Button
                            plain
                            onClick={() => copyToClipboard(det.full_frame_path!, 'id')}
                            className="p-1"
                          >
                            <DocumentDuplicateIcon className="w-3.5 h-3.5 text-zinc-400" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-12 text-center border-2 border-dashed border-zinc-300 dark:border-zinc-700">
                        <CameraIcon className="mx-auto h-12 w-12 text-zinc-400 mb-3" />
                        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">
                          No hay imagen disponible
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-500">
                          La captura no pudo ser almacenada
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Right Side */}
        <aside className="lg:col-span-1">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow border border-zinc-200 dark:border-zinc-800">
            <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
              <div className="flex items-center gap-2">
                <CodeBracketIcon className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
                <Subheading>Metadatos</Subheading>
              </div>
            </div>
            <div className="p-6">
              {meta && Object.keys(meta).length > 0 ? (
                <div className="space-y-4">
                  {/* Meta Fields */}
                  <div className="space-y-3">
                    {Object.entries(meta).map(([k, v]) => (
                      <div key={k} className="bg-zinc-50 dark:bg-zinc-800 rounded-lg p-3">
                        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                          {k}
                        </div>
                        <div className="text-sm text-zinc-700 dark:text-zinc-300 break-words font-mono">
                          {typeof v === 'string' && v.length > 150 
                            ? v.substring(0, 150) + '…' 
                            : prettyJSON(v)
                          }
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                    <Button 
                      outline 
                      onClick={() => setShowRawMeta(s => !s)}
                      className="w-full justify-center"
                    >
                      {showRawMeta ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      {showRawMeta ? 'Ocultar JSON' : 'Ver JSON Raw'}
                    </Button>
                    <Button 
                      onClick={() => {
                        const blob = new Blob([prettyJSON(meta)], { type: 'application/json' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `detection-${det.id}-meta.json`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="w-full justify-center"
                    >
                      <ArrowDownTrayIcon className="w-4 h-4" />
                      Descargar JSON
                    </Button>
                  </div>

                  {/* Raw JSON Display */}
                  {showRawMeta && (
                    <div className="mt-4">
                      <pre className="text-xs overflow-auto max-h-96 bg-zinc-900 dark:bg-black text-green-400 p-4 rounded-lg border border-zinc-700">
                        {prettyJSON(meta)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <CodeBracketIcon className="mx-auto h-12 w-12 text-zinc-400 mb-2" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    No hay metadatos disponibles
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Modal de Confirmación de Aprobación */}
      <Dialog open={showApproveDialog} onClose={setShowApproveDialog}>
        <DialogTitle>Aprobar Detección</DialogTitle>
        <DialogDescription>
          ¿Estás seguro de que deseas aprobar esta detección? El vehículo será autorizado para ingresar.
        </DialogDescription>
        <DialogBody>
          {attempt?.detection?.plate && (
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Patente detectada:</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{attempt.detection.plate}</p>
            </div>
          )}
        </DialogBody>
        <DialogActions>
          <Button plain onClick={() => setShowApproveDialog(false)}>
            Cancelar
          </Button>
          <Button
            color="lime"
            onClick={() => {
              approveMutation.mutate(attempt!.id)
              setShowApproveDialog(false)
            }}
            disabled={approveMutation.isPending}
          >
            <CheckCircleIcon className="w-5 h-5" />
            {approveMutation.isPending ? 'Aprobando...' : 'Confirmar Aprobación'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal de Confirmación de Rechazo */}
      <Dialog open={showRejectDialog} onClose={setShowRejectDialog}>
        <DialogTitle>Rechazar Detección</DialogTitle>
        <DialogDescription>
          ¿Estás seguro de que deseas rechazar esta detección? El acceso será denegado.
        </DialogDescription>
        <DialogBody>
          {attempt?.detection?.plate && (
            <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-1">Patente detectada:</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{attempt.detection.plate}</p>
            </div>
          )}
        </DialogBody>
        <DialogActions>
          <Button plain onClick={() => setShowRejectDialog(false)}>
            Cancelar
          </Button>
          <Button
            color="red"
            onClick={() => {
              rejectMutation.mutate(attempt!.id)
              setShowRejectDialog(false)
            }}
            disabled={rejectMutation.isPending}
          >
            <XCircleIcon className="w-5 h-5" />
            {rejectMutation.isPending ? 'Rechazando...' : 'Confirmar Rechazo'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
