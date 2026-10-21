import type { AccessAttempt, PlateDetection } from '@/api/DetectionsAPI'
import { Button } from '@/components/ui/Button'
import { AccessDecisionBadge } from './AccessDecisionBadge'
import { DetectionImages } from './DetectionImages'
import { PassageSightings } from './PassageSightings'
import { getAttemptDirectionLabel } from '@/helpers/accessDecision'
import { getDirectionSourceLabel } from '@/helpers/passage'

type Props = {
  attempt: AccessAttempt | null
  onClose: () => void
  /** Para mostrar el nombre de cada cámara de la pasada; sin ella se muestra el id. */
  cameras?: ReadonlyArray<{ id: string; name?: string | null; location?: string | null }>
}

const NO_CAMERAS: NonNullable<Props['cameras']> = []

export default function AttemptDetails({ attempt, onClose, cameras = NO_CAMERAS }: Props) {
  if (!attempt) return (
    <div className="text-sm text-zinc-500">Selecciona un intento para ver detalles</div>
  )

  const detection: PlateDetection = attempt.detection

  return (
    <div className="max-w-2xl bg-white dark:bg-zinc-900 rounded shadow p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold dark:text-white">Detalle de intento</h3>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">{new Date(attempt.createdAt).toLocaleString()}</div>
        </div>
        <div>
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-zinc-800 dark:text-zinc-200">
        <div>
          <dt className="font-medium">Decisión</dt>
          <dd><AccessDecisionBadge decision={attempt.decision} /></dd>
        </div>
        <div>
          <dt className="font-medium">Método</dt>
          <dd>{attempt.method ?? '-'}</dd>
        </div>
        <div>
          <dt className="font-medium">Dirección</dt>
          <dd>{getAttemptDirectionLabel(attempt) ?? '-'}</dd>
        </div>
        {attempt.passage && (
          <div>
            <dt className="font-medium">Fuente de la dirección</dt>
            <dd>{getDirectionSourceLabel(attempt.passage.directionSource)}</dd>
          </div>
        )}
        <div>
          <dt className="font-medium">Residente</dt>
          <dd>{attempt.residente ? attempt.residente.name ?? attempt.residente.id : '-'}</dd>
        </div>
        <div>
          <dt className="font-medium">Razón</dt>
          <dd>{attempt.reason ?? '-'}</dd>
        </div>
      </dl>

      <hr className="my-4 border-zinc-100 dark:border-zinc-800" />

      {attempt.passage && (
        <>
          <PassageSightings passage={attempt.passage} cameras={cameras} />
          <hr className="my-4 border-zinc-100 dark:border-zinc-800" />
        </>
      )}

      <div>
        <h4 className="font-medium dark:text-white">Detección de patente</h4>
        <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
          <div><strong>Patente:</strong> {detection.plate}</div>
          <div><strong>Cámara:</strong> {detection.cameraId}</div>
          <div><strong>Conf. OCR:</strong> {detection.ocr_confidence ?? '-'}</div>
          <div><strong>Conf. Det:</strong> {detection.det_confidence ?? '-'}</div>
          <div className="mt-2">
            <DetectionImages detection={detection} capturedAt={detection.createdAt} emptyMessage="Sin imagen" />
          </div>
        </div>
      </div>
    </div>
  )
}
