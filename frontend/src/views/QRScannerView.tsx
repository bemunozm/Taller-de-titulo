import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { getVisitByQRCode, checkInVisit, checkOutVisit } from '@/api/VisitAPI'
import type { Visit } from '@/types/index'
import { QRScanner } from '@/components/visits/QRScanner'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Heading, Subheading } from '@/components/ui/Heading'
import {
  QrCodeIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  UserIcon,
  TruckIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { formatDateTime } from '@/helpers/index'

// Colores para los badges de estado
const statusColors = {
  pending: 'amber',
  ready: 'amber',
  active: 'lime',
  completed: 'sky',
  cancelled: 'zinc',
  expired: 'rose',
  denied: 'rose',
} as const

const statusLabels = {
  pending: 'Pendiente',
  ready: 'Lista',
  active: 'Activa',
  completed: 'Completada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  denied: 'Denegada',
}

export function QRScannerView() {
  const queryClient = useQueryClient()
  const [isScanning, setIsScanning] = useState(false)
  const [scannedQR, setScannedQR] = useState<string>('')

  // Query para obtener visita por QR Code
  const { data: visit, isLoading, error } = useQuery<Visit>({
    queryKey: ['visit-qr', scannedQR],
    queryFn: () => getVisitByQRCode(scannedQR),
    enabled: !!scannedQR,
    retry: false,
  })

  // Mutación para check-in
  const checkInMutation = useMutation({
    mutationFn: checkInVisit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-qr', scannedQR] })
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('✅ Entrada registrada exitosamente')
    },
    onError: (error: Error) => {
      const message = error.message || 'Error al registrar entrada'
      
      // Mensajes específicos según el error
      if (message.includes('cancelada')) {
        toast.error('❌ Esta visita ha sido cancelada')
      } else if (message.includes('expirada') || message.includes('expir')) {
        toast.error('⏰ Esta visita ha expirado')
      } else if (message.includes('máximo de usos') || message.includes('usos permitidos')) {
        toast.error('🚫 Se alcanzó el máximo de usos permitidos')
      } else if (message.includes('período válido') || message.includes('válida desde')) {
        toast.error('📅 La visita no está dentro del período válido')
      } else {
        toast.error(`❌ ${message}`)
      }
    },
  })

  // Mutación para check-out
  const checkOutMutation = useMutation({
    mutationFn: checkOutVisit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-qr', scannedQR] })
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      toast.success('✅ Salida registrada exitosamente')
    },
    onError: (error: Error) => {
      const message = error.message || 'Error al registrar salida'
      
      if (message.includes('no está activa')) {
        toast.error('⚠️ La visita no está activa')
      } else {
        toast.error(`❌ ${message}`)
      }
    },
  })

  const handleScan = (data: string) => {
    console.log('QR escaneado:', data)
    setScannedQR(data)
    setIsScanning(false)
  }

  const handleError = (error: string) => {
    console.error('Error al escanear:', error)
    toast.error(`📷 ${error}`)
  }

  const handleStartScan = () => {
    setIsScanning(true)
    setScannedQR('')
  }

  const handleCheckIn = () => {
    if (visit) {
      checkInMutation.mutate(visit.id)
    }
  }

  const handleCheckOut = () => {
    if (visit) {
      checkOutMutation.mutate(visit.id)
    }
  }

  const handleNewScan = () => {
    setScannedQR('')
    setIsScanning(true)
  }

  // Validaciones de estado
  const validateVisitStatus = (visit: Visit | undefined) => {
    if (!visit) return null

    const now = new Date()
    const validFrom = new Date(visit.validFrom)
    const validUntil = new Date(visit.validUntil)

    // Verificar si expiró
    if (now > validUntil) {
      return {
        type: 'error' as const,
        message: '⏰ Esta visita ha expirado',
        description: `Válida hasta: ${formatDateTime(visit.validUntil)}`,
      }
    }

    // Verificar si aún no es válida
    if (now < validFrom) {
      return {
        type: 'warning' as const,
        message: '📅 Esta visita aún no es válida',
        description: `Válida desde: ${formatDateTime(visit.validFrom)}`,
      }
    }

    // Verificar si está cancelada
    if (visit.status === 'cancelled') {
      return {
        type: 'error' as const,
        message: '❌ Esta visita ha sido cancelada',
        description: 'No se puede registrar entrada o salida',
      }
    }

    // Verificar si está completada
    if (visit.status === 'completed') {
      return {
        type: 'info' as const,
        message: '✅ Esta visita ya está completada',
        description: 'No se pueden realizar más acciones',
      }
    }

    // Verificar usos máximos
    if (visit.maxUses !== null && visit.maxUses !== undefined) {
      if (visit.usedCount >= visit.maxUses) {
        return {
          type: 'error' as const,
          message: '🚫 Se alcanzó el máximo de usos',
          description: `Usos: ${visit.usedCount} / ${visit.maxUses}`,
        }
      }
    }

    return null
  }

  const statusValidation = validateVisitStatus(visit)

  const canCheckIn = visit?.status === 'pending' && !statusValidation
  const canCheckOut = visit?.status === 'active'
  const isPending = checkInMutation.isPending || checkOutMutation.isPending

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <QrCodeIcon className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
          <Heading>Escaneo de Visitas</Heading>
        </div>
        <Subheading>
          Escanea el código QR de la visita para registrar entrada o salida
        </Subheading>
      </header>

      {/* Estado del escáner */}
      <div className="mb-6">
        {!isScanning && !scannedQR && (
          <div className="text-center py-12 bg-white dark:bg-zinc-800 rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700">
            <QrCodeIcon className="w-16 h-16 mx-auto text-zinc-400 mb-4" />
            <p className="text-zinc-600 dark:text-zinc-400 mb-6">
              Presiona el botón para iniciar el escaneo
            </p>
            <Button color="indigo" onClick={handleStartScan}>
              <QrCodeIcon className="w-5 h-5" />
              Iniciar Escaneo
            </Button>
          </div>
        )}

        {isScanning && (
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 border border-zinc-200 dark:border-zinc-700">
            <ErrorBoundary>
              <QRScanner
                onScan={handleScan}
                onError={handleError}
                isScanning={isScanning}
              />
            </ErrorBoundary>
            <div className="mt-4 flex justify-center">
              <Button plain onClick={() => setIsScanning(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Resultado del escaneo */}
      {scannedQR && !isScanning && (
        <div className="space-y-6">
          {/* Estado de carga */}
          {isLoading && (
            <div className="bg-white dark:bg-zinc-800 rounded-lg p-8 border border-zinc-200 dark:border-zinc-700">
              <div className="flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4" />
                <p className="text-zinc-600 dark:text-zinc-400">
                  Verificando visita...
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-6 border-2 border-red-200 dark:border-red-800">
              <div className="flex items-start gap-4">
                <XCircleIcon className="w-8 h-8 text-red-600 dark:text-red-400 flex-shrink-0" />
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">
                    Visita No Encontrada
                  </h3>
                  <p className="text-red-700 dark:text-red-300 mb-4">
                    No se encontró ninguna visita con el código QR escaneado.
                  </p>
                  <div className="bg-red-100 dark:bg-red-900/30 rounded p-3 mb-4">
                    <p className="text-xs font-mono text-red-800 dark:text-red-200 break-all">
                      QR: {scannedQR}
                    </p>
                  </div>
                  <Button color="red" onClick={handleNewScan}>
                    <ArrowPathIcon className="w-5 h-5" />
                    Escanear Otro Código
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Visita encontrada */}
          {visit && (
            <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <CheckCircleIcon className="w-8 h-8" />
                    <div>
                      <h2 className="text-2xl font-bold">Visita Encontrada</h2>
                      <p className="text-indigo-100">
                        {visit.type === 'vehicular' ? 'Visita Vehicular' : 'Visita Peatonal'}
                      </p>
                    </div>
                  </div>
                  <Badge color={statusColors[visit.status]}>
                    {statusLabels[visit.status]}
                  </Badge>
                </div>
              </div>

              {/* Alertas de validación */}
              {statusValidation && (
                <div className={`border-b ${
                  statusValidation.type === 'error' 
                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' 
                    : statusValidation.type === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                    : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                } p-4`}>
                  <p className={`font-semibold mb-1 ${
                    statusValidation.type === 'error'
                      ? 'text-red-900 dark:text-red-100'
                      : statusValidation.type === 'warning'
                      ? 'text-amber-900 dark:text-amber-100'
                      : 'text-blue-900 dark:text-blue-100'
                  }`}>
                    {statusValidation.message}
                  </p>
                  <p className={`text-sm ${
                    statusValidation.type === 'error'
                      ? 'text-red-700 dark:text-red-300'
                      : statusValidation.type === 'warning'
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-blue-700 dark:text-blue-300'
                  }`}>
                    {statusValidation.description}
                  </p>
                </div>
              )}

              {/* Información de la visita */}
              <div className="p-6 space-y-6">
                {/* Visitante */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
                    Información del Visitante
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                      <UserIcon className="w-5 h-5 text-zinc-400" />
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Nombre
                        </p>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {visit.visitorName}
                        </p>
                      </div>
                    </div>
                    {visit.visitorRut && (
                      <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                        <UserIcon className="w-5 h-5 text-zinc-400" />
                        <div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            RUT
                          </p>
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {visit.visitorRut}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Vehículo (si aplica) */}
                {visit.type === 'vehicular' && visit.vehicle && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
                      Información del Vehículo
                    </h3>
                    <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                      <TruckIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      <div>
                        <p className="font-mono font-bold text-lg text-purple-900 dark:text-purple-100">
                          {visit.vehicle.plate}
                        </p>
                        {visit.vehicle.brand && (
                          <p className="text-sm text-purple-700 dark:text-purple-300">
                            {visit.vehicle.brand} {visit.vehicle.model}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Período de validez */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
                    Período de Validez
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                      <ClockIcon className="w-5 h-5 text-zinc-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Válido Desde
                        </p>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatDateTime(visit.validFrom)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                      <ClockIcon className="w-5 h-5 text-zinc-400 mt-0.5" />
                      <div>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          Válido Hasta
                        </p>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {formatDateTime(visit.validUntil)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Anfitrión */}
                {visit.host && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
                      Anfitrión
                    </h3>
                    <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
                      <UserIcon className="w-5 h-5 text-zinc-400" />
                      <div>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {visit.host.name}
                        </p>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                          {visit.host.email}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Control de usos */}
                {visit.maxUses !== null && visit.maxUses !== undefined && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                        Usos del QR:
                      </span>
                      <span className="text-lg font-bold text-blue-900 dark:text-blue-100">
                        {visit.usedCount || 0} / {visit.maxUses}
                      </span>
                    </div>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                      {visit.maxUses - (visit.usedCount || 0)} usos restantes
                    </p>
                  </div>
                )}

                {/* Acciones */}
                <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                  {canCheckIn && (
                    <Button
                      color="lime"
                      className="flex-1"
                      onClick={handleCheckIn}
                      disabled={isPending}
                    >
                      <CheckCircleIcon className="w-5 h-5" />
                      {isPending ? 'Registrando...' : 'Registrar Entrada'}
                    </Button>
                  )}

                  {canCheckOut && (
                    <Button
                      color="sky"
                      className="flex-1"
                      onClick={handleCheckOut}
                      disabled={isPending}
                    >
                      <CheckCircleIcon className="w-5 h-5" />
                      {isPending ? 'Registrando...' : 'Registrar Salida'}
                    </Button>
                  )}

                  {!canCheckIn && !canCheckOut && (
                    <div className="flex-1 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg p-4 text-center">
                      <p className="text-sm text-zinc-600 dark:text-zinc-400">
                        No hay acciones disponibles para esta visita
                      </p>
                    </div>
                  )}

                  <Button plain onClick={handleNewScan} disabled={isPending}>
                    <ArrowPathIcon className="w-5 h-5" />
                    Escanear Otro
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Información adicional */}
      <div className="mt-8 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-6 border border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-3">
          💡 Instrucciones de uso
        </h3>
        <ul className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
          <li className="flex items-start gap-2">
            <span className="text-indigo-600 dark:text-indigo-400 font-bold">1.</span>
            <span>Presiona "Iniciar Escaneo" para activar la cámara</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-600 dark:text-indigo-400 font-bold">2.</span>
            <span>Coloca el código QR de la visita frente a la cámara</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-600 dark:text-indigo-400 font-bold">3.</span>
            <span>El sistema detectará automáticamente el QR y mostrará la información</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-600 dark:text-indigo-400 font-bold">4.</span>
            <span>Registra la entrada o salida según corresponda</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
