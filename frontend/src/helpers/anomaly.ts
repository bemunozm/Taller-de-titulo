import type { AnomalyEvent } from '@/types/anomaly'

export type AnomalySeverityColor = 'red' | 'orange' | 'zinc'

interface CameraRef {
  id: string
  name?: string | null
  location?: string | null
  mountPath?: string | null
}

/** Ruta del detalle de una anomalía. */
export function anomalyDetailPath(id: string): string {
  return `/traceability/anomalies/${encodeURIComponent(id)}`
}

/** Ruta de Trazabilidad con la pestaña de anomalías abierta. */
export const ANOMALIES_LIST_PATH = '/traceability?tab=anomalies'

const SEVERITY: Record<string, { label: string; color: AnomalySeverityColor }> = {
  HIGH: { label: 'Alta', color: 'red' },
  MEDIUM: { label: 'Media', color: 'orange' },
  LOW: { label: 'Baja', color: 'zinc' },
}

/** Etiqueta y color del nivel de sospecha; `null` si la IA no lo evaluó. */
export function anomalySeverity(level: string | null | undefined): { label: string; color: AnomalySeverityColor } | null {
  if (!level) return null
  return SEVERITY[level.toUpperCase()] ?? { label: level, color: 'zinc' }
}

/**
 * Nombre de la cámara de una anomalía. El worker puede nombrar la cámara por
 * su `mountPath`, por eso también se busca por él. Sin coincidencia devuelve
 * el identificador tal cual.
 */
export function resolveAnomalyCameraName(cameraId: string, cameras: ReadonlyArray<CameraRef>): string {
  const camera = cameras.find((candidate) => candidate.id === cameraId || (candidate.mountPath ?? null) === cameraId)
  return camera?.name || camera?.location || cameraId
}

/** Confianza de la IA como porcentaje entero ("92%"). */
export function formatAnomalyConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/** Duración en segundos como "1 min 5 s" / "45 s"; `null` si no hay dato. */
export function formatAnomalyDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return minutes > 0 ? `${minutes} min ${rest} s` : `${rest} s`
}

/** Metadatos descargables: todo menos la foto (base64 pesado, ya visible en pantalla). */
export function anomalyMetadata(anomaly: AnomalyEvent): Record<string, unknown> {
  return Object.fromEntries(Object.entries(anomaly).filter(([key]) => key !== 'snapshotJpegB64'))
}
