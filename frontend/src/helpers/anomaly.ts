import type { AnomalyEvent, AnomalyStatus } from '@/types/anomaly'

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

export type AnomalyBadgeColor = 'amber' | 'green' | 'zinc' | 'sky'

export const ANOMALY_STATUS_META: Record<AnomalyStatus, { label: string; color: AnomalyBadgeColor }> = {
  open: { label: 'Abierta', color: 'amber' },
  reviewed: { label: 'Revisada', color: 'green' },
  dismissed: { label: 'Descartada', color: 'zinc' },
  false_alarm: { label: 'Falsa alarma', color: 'sky' },
}

/** Etiqueta y color del estado de revisión. */
export function anomalyStatusMeta(status: AnomalyStatus): { label: string; color: AnomalyBadgeColor } {
  return ANOMALY_STATUS_META[status]
}

export interface AnomalyStatusAction {
  /** Estado al que lleva la acción. */
  target: AnomalyStatus
  label: string
  /** Título del diálogo de confirmación. */
  dialogTitle: string
  /** Texto del botón de confirmación. */
  confirmLabel: string
  toastMessage: string
}

const STATUS_ACTIONS: Record<AnomalyStatus, AnomalyStatusAction> = {
  reviewed: {
    target: 'reviewed',
    label: 'Marcar revisada',
    dialogTitle: 'Marcar como revisada',
    confirmLabel: 'Marcar revisada',
    toastMessage: 'Anomalía marcada como revisada',
  },
  dismissed: {
    target: 'dismissed',
    label: 'Descartar',
    dialogTitle: 'Descartar anomalía',
    confirmLabel: 'Descartar',
    toastMessage: 'Anomalía descartada',
  },
  false_alarm: {
    target: 'false_alarm',
    label: 'Falsa alarma',
    dialogTitle: 'Marcar como falsa alarma',
    confirmLabel: 'Marcar falsa alarma',
    toastMessage: 'Anomalía marcada como falsa alarma',
  },
  open: {
    target: 'open',
    label: 'Reabrir',
    dialogTitle: 'Reabrir anomalía',
    confirmLabel: 'Reabrir',
    toastMessage: 'Anomalía reabierta',
  },
}

/** Acciones según el estado actual: una abierta se resuelve; una resuelta solo se reabre. */
export function anomalyStatusActions(status: AnomalyStatus): AnomalyStatusAction[] {
  return status === 'open'
    ? [STATUS_ACTIONS.reviewed, STATUS_ACTIONS.dismissed, STATUS_ACTIONS.false_alarm]
    : [STATUS_ACTIONS.open]
}

/** Permiso que habilita revisar/descartar anomalías (Administrador y Conserje). */
export const ANOMALY_RESOLVE_PERMISSION = 'anomalies.resolve'

/** Refresco mientras la IA analiza: cada 5 s y como máximo 24 veces (~2 min). */
export const ANOMALY_AI_POLL_MS = 5_000
export const ANOMALY_AI_POLL_MAX_UPDATES = 24

/**
 * Intervalo de refresco mientras la IA analiza (`aiStatus = 'pending'`), con
 * tope de intentos: complementa a `security:anomaly_updated` si el socket cae.
 */
export function anomalyAiPollInterval(isPending: boolean, updateCount: number): number | false {
  return isPending && updateCount < ANOMALY_AI_POLL_MAX_UPDATES ? ANOMALY_AI_POLL_MS : false
}
