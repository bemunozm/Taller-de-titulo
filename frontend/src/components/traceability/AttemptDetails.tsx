import type { AccessAttempt, PlateDetection } from '@/api/DetectionsAPI'
import { Button } from '@/components/ui/Button'

type Props = {
  attempt: AccessAttempt | null
  onClose: () => void
}

export default function AttemptDetails({ attempt, onClose }: Props) {
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
          <dd>{attempt.decision}</dd>
        </div>
        <div>
          <dt className="font-medium">Método</dt>
          <dd>{attempt.method ?? '-'}</dd>
        </div>
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

      <div>
        <h4 className="font-medium dark:text-white">Detección de patente</h4>
        <div className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
          <div><strong>Patente:</strong> {detection.plate}</div>
          <div><strong>Cámara:</strong> {detection.cameraId}</div>
          <div><strong>Conf. OCR:</strong> {detection.ocr_confidence ?? '-'}</div>
          <div><strong>Conf. Det:</strong> {detection.det_confidence ?? '-'}</div>
          {detection.meta?.snapshot_jpeg_b64 && (
            <div className="mt-2">
              <img src={`data:image/jpeg;base64,${detection.meta.snapshot_jpeg_b64}`} alt="snapshot" className="max-w-full rounded" />
            </div>
          )}
          {detection.full_frame_path && (
            <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Frame path: {detection.full_frame_path}</div>
          )}
        </div>
      </div>
    </div>
  )
}
