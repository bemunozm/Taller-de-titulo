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
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline'
import { formatDateTime } from '@/helpers/index'
import { visibleUserEmail } from '@/helpers/userDisplay'
import {
  getVisitPlate,
  getVisitScanState,
  getVisitStatusColor,
  getVisitStatusLabel,
  type VisitScanSeverity,
  type VisitScanValidation,
} from '@/helpers/visitStatus'

const scanAlertStyles: Record<
  VisitScanSeverity,
  { container: string; title: string; description: string; icon: string }
> = {
  error: {
    container: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    title: 'text-red-900 dark:text-red-100',
    description: 'text-red-700 dark:text-red-300',
    icon: 'text-red-600 dark:text-red-400',
  },
  warning: {
    container: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
    title: 'text-amber-900 dark:text-amber-100',
    description: 'text-amber-700 dark:text-amber-300',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    container: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    title: 'text-blue-900 dark:text-blue-100',
    description: 'text-blue-700 dark:text-blue-300',
    icon: 'text-blue-600 dark:text-blue-400',
  },
}

const scanAlertIcons = {
  error: XCircleIcon,
  warning: ExclamationTriangleIcon,
  info: InformationCircleIcon,
} satisfies Record<VisitScanSeverity, typeof XCircleIcon>

interface ScanStatusAlertProps {
  validation: VisitScanValidation
}

function ScanStatusAlert({ validation }: ScanStatusAlertProps) {
  const styles = scanAlertStyles[validation.type]
  const Icon = scanAlertIcons[validation.type]

  return (
    <div
      role={validation.type === 'info' ? 'status' : 'alert'}
      className={`flex items-start gap-3 border-b p-4 ${styles.container}`}
    >
      <Icon aria-hidden="true" className={`w-6 h-6 flex-shrink-0 ${styles.icon}`} />
      <div>
        <p className={`font-semibold mb-1 ${styles.title}`}>{validation.message}</p>
        <p className={`text-sm ${styles.description}`}>{validation.description}</p>
      </div>
    </div>
  )
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

  // Refresca también tras un error: un 409 significa que la visita cambió de
  // estado y la tarjeta escaneada está desactualizada.
  const refreshScannedVisit = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['visit-qr', scannedQR] }),
      queryClient.invalidateQueries({ queryKey: ['visits'] }),
    ])

  // Los errores muestran el mensaje del backend tal cual: ya explica la causa
  // (p.ej. el 409 "No se puede registrar la entrada: la visita está …").
  const checkInMutation = useMutation({
    mutationFn: checkInVisit,
    onSuccess: () => {
      toast.success('✅ Entrada registrada exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al registrar entrada')
    },
    onSettled: refreshScannedVisit,
  })

  const checkOutMutation = useMutation({
    mutationFn: checkOutVisit,
    onSuccess: () => {
      toast.success('✅ Salida registrada exitosamente')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al registrar salida')
    },
    onSettled: refreshScannedVisit,
  })

  // El contenido del QR es una credencial de acceso: no se registra en consola.
  const handleScan = (data: string) => {
    setScannedQR(data)
    setIsScanning(false)
  }

  const handleError = (error: string) => {
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

  const scanState = visit ? getVisitScanState(visit) : null
  const statusValidation = scanState?.validation ?? null
  const canCheckIn = scanState?.canCheckIn ?? false
  const canCheckOut = scanState?.canCheckOut ?? false
  const plate = visit ? getVisitPlate(visit) : null
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
                  <Badge color={getVisitStatusColor(visit.status)}>
                    {getVisitStatusLabel(visit.status)}
                  </Badge>
                </div>
              </div>

              {/* Alertas de validación */}
              {statusValidation && <ScanStatusAlert validation={statusValidation} />}

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
                {visit.type === 'vehicular' && plate && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
                      Información del Vehículo
                    </h3>
                    <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                      <TruckIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      <div>
                        <p className="font-mono font-bold text-lg text-purple-900 dark:text-purple-100">
                          {plate}
                        </p>
                        {visit.vehicle?.brand && (
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
                        {/* Sin users.update el anfitrión llega como { id, name } (P5). */}
                        {/* Tampoco el email marcador de una cuenta anonimizada. */}
                        {visibleUserEmail(visit.host.email) ? (
                          <p className="text-sm text-zinc-500 dark:text-zinc-400">
                            {visibleUserEmail(visit.host.email)}
                          </p>
                        ) : null}
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
