import { useEffect, useState, type ComponentProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useNavigate } from 'react-router-dom'
import { ShieldExclamationIcon } from '@heroicons/react/24/outline'
import { ClockIcon, PhotoIcon, VideoCameraIcon } from '@heroicons/react/16/solid'
import { Alert, AlertActions, AlertBody, AlertDescription, AlertTitle } from '@/components/ui/Alert'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { getAnomaly } from '@/api/DetectionsAPI'
import { anomalyDetailPath } from '@/helpers/anomaly'
import { usePermissions } from '@/hooks/usePermissions'
import { formatDateTime } from '@/helpers/index'
import {
  anomalyTypeLabel,
  canReceiveSecurityAlerts,
  toJpegDataUrl,
  type AnomalyHighlight,
  type AnomalySeverity,
} from '@/helpers/securityAlerts'
import { webSocketService } from '@/services/WebSocketService'

type BadgeColor = NonNullable<ComponentProps<typeof Badge>['color']>

const SEVERITY_BADGE: Record<AnomalySeverity, { label: string; color: BadgeColor }> = {
  HIGH: { label: 'Alta', color: 'red' },
  MEDIUM: { label: 'Media', color: 'orange' },
  LOW: { label: 'Baja', color: 'zinc' },
}

/**
 * Avisos del Guardián Visual (`security:anomaly_highlight`). Solo se monta
 * para quien el backend une a la sala de seguridad de su condominio:
 * `detections.read` + `condominium.view-all`. Nunca para el super-admin
 * (no hay feed de plataforma; consulta `GET /anomalies`).
 */
export function GlobalSecurityNotifications() {
  const { userPermissions, isSuperAdmin } = usePermissions()

  if (!canReceiveSecurityAlerts({ isSuperAdmin, permissions: userPermissions })) {
    return null
  }

  return <SecurityAlertListener />
}

/** Escucha el socket de la sesión (`webSocketService`) y abre el aviso. */
function SecurityAlertListener() {
  const [alert, setAlert] = useState<AnomalyHighlight | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(
    () =>
      webSocketService.onAnomalyHighlight((highlight) => {
        // Un nivel bajo queda en Trazabilidad; no interrumpe con un aviso.
        if (highlight.severity === 'LOW') {
          return
        }
        setAlert(highlight)
        setIsOpen(true)
      }),
    [],
  )

  if (!alert) {
    return null
  }

  // El aviso se conserva al cerrar para que la animación de salida no quede vacía.
  return <SecurityAlertDialog alert={alert} open={isOpen} onClose={() => setIsOpen(false)} />
}

interface SecurityAlertDialogProps {
  alert: AnomalyHighlight
  open: boolean
  onClose: () => void
}

function SecurityAlertDialog({ alert, open, onClose }: SecurityAlertDialogProps) {
  const isCritical = alert.severity === 'HIGH'
  const severity = alert.severity ? SEVERITY_BADGE[alert.severity] : null
  const cameraLabel = alert.cameraName ?? alert.cameraId ?? 'Cámara sin identificar'
  const navigate = useNavigate()

  const openDetail = () => {
    onClose()
    navigate(anomalyDetailPath(alert.anomalyId))
  }

  return (
    <Alert open={open} onClose={onClose} size="lg">
      <div className="flex items-start gap-4">
        <span
          className={clsx(
            'relative flex size-11 shrink-0 items-center justify-center rounded-full',
            isCritical
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
          )}
        >
          {isCritical && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full ring-2 ring-red-500/40 motion-safe:animate-ping"
            />
          )}
          <ShieldExclamationIcon className="size-6" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs/5 font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            Guardián visual
          </p>
          <AlertTitle className="text-left! text-base/6!">
            {isCritical ? 'Alerta crítica' : 'Actividad sospechosa'}
          </AlertTitle>
          <AlertDescription className="mt-0.5! text-left!">{anomalyTypeLabel(alert.type)}</AlertDescription>
        </div>

        <Badge color={severity?.color ?? 'zinc'} className="shrink-0">
          IA: {severity?.label ?? 'sin nivel'}
        </Badge>
      </div>

      <AlertBody className="space-y-4">
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm/6 text-zinc-600 dark:text-zinc-400">
          <div className="flex min-w-0 items-center gap-1.5">
            <dt>
              <VideoCameraIcon className="size-4 fill-zinc-400 dark:fill-zinc-500" aria-hidden="true" />
              <span className="sr-only">Cámara</span>
            </dt>
            <dd className="truncate font-medium text-zinc-800 dark:text-zinc-200">{cameraLabel}</dd>
          </div>
          {alert.timestamp && (
            <div className="flex items-center gap-1.5">
              <dt>
                <ClockIcon className="size-4 fill-zinc-400 dark:fill-zinc-500" aria-hidden="true" />
                <span className="sr-only">Hora</span>
              </dt>
              <dd>
                <time dateTime={alert.timestamp.toISOString()}>{formatDateTime(alert.timestamp)}</time>
              </dd>
            </div>
          )}
        </dl>

        <AnomalySnapshot anomalyId={alert.anomalyId} cameraLabel={cameraLabel} enabled={open} />

        {alert.reasoning && (
          <figure
            className={clsx(
              'rounded-r-lg border-l-2 bg-zinc-50 py-2.5 pr-3 pl-4 dark:bg-white/5',
              isCritical ? 'border-red-500' : 'border-amber-500',
            )}
          >
            <figcaption className="text-xs/5 font-medium text-zinc-500 dark:text-zinc-400">
              Evaluación de la IA
            </figcaption>
            <blockquote className="mt-1 text-sm/6 text-pretty text-zinc-800 dark:text-zinc-200">
              {alert.reasoning}
            </blockquote>
          </figure>
        )}
      </AlertBody>

      <AlertActions>
        <Button outline onClick={openDetail}>
          Ver detalle
        </Button>
        <Button onClick={onClose} color={isCritical ? 'red' : 'dark/zinc'}>
          Entendido
        </Button>
      </AlertActions>
    </Alert>
  )
}

interface AnomalySnapshotProps {
  anomalyId: string
  cameraLabel: string
  enabled: boolean
}

/**
 * Foto de la anomalía por `GET /anomalies/:id` (el aviso del socket no la
 * trae). Si no llega, el aviso se muestra igual.
 */
function AnomalySnapshot({ anomalyId, cameraLabel, enabled }: AnomalySnapshotProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['anomalies', 'detail', anomalyId],
    queryFn: () => getAnomaly(anomalyId),
    enabled,
    retry: false,
    staleTime: Infinity,
  })
  const imageSrc = toJpegDataUrl(data?.snapshotJpegB64)

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-zinc-950/10 dark:ring-white/10">
      {imageSrc ? (
        <img src={imageSrc} alt={`Captura de ${cameraLabel}`} className="size-full object-contain" />
      ) : (
        <div
          role="status"
          className={clsx(
            'flex size-full flex-col items-center justify-center gap-2 text-sm text-zinc-400',
            isPending && !isError && 'motion-safe:animate-pulse',
          )}
        >
          <PhotoIcon className="size-6 fill-zinc-600" aria-hidden="true" />
          {isError
            ? 'No se pudo cargar la foto. Revísala en Trazabilidad.'
            : isPending
              ? 'Cargando foto…'
              : 'Sin foto disponible'}
        </div>
      )}
    </div>
  )
}
