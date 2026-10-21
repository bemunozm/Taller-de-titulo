import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import { ApiError, toApiError } from '@/helpers/httpErrors'
import { parseAnomalyEvent, type AnomalyEvent } from '@/types/anomaly'
import { parseAttemptPassage, type AttemptPassage } from '@/types/passage'

export { parseAttemptPassage, PASSAGE_DIRECTIONS, PASSAGE_DIRECTION_SOURCES } from '@/types/passage'
export type { AttemptPassage, PassageSighting } from '@/types/passage'
export type { AnomalyEvent } from '@/types/anomaly'

/** Metadatos libres del worker LPR; solo se lee el snapshot. */
export type PlateDetectionMeta = {
  snapshot_jpeg_b64?: string | null
  [key: string]: unknown
}

export type PlateDetection = {
  id: string
  cameraId: string
  plate: string
  plate_raw?: string | null
  det_confidence?: number | null
  ocr_confidence?: number | null
  full_frame_path?: string | null
  meta?: PlateDetectionMeta | null
  createdAt: string
}

/**
 * Residente asociado a una detección. Sin `users.update` llega como
 * `{ id, name }` (P5): email y familia son opcionales.
 */
export type User = {
  id: string
  name: string
  email?: string | null
  family?: Family | null
}

export type Family = {
  id: string
  name: string
  address?: string | null
}

export type AccessAttempt = {
  id: string
  method?: string | null
  decision: string
  reason?: string | null
  createdAt: string
  residente?: User | null
  detection: PlateDetection
  /** Pasada a la que pertenece el intento; `null` o ausente en datos antiguos. */
  passage?: AttemptPassage | null
}

export async function listPlateDetections(): Promise<PlateDetection[]> {
  try {
    const { data } = await api.get<PlateDetection[]>('/detections/plates')
    return data || []
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function listAccessAttempts(): Promise<AccessAttempt[]> {
  try {
    const { data } = await api.get<AccessAttempt[]>('/detections/plates/attempts')
    return (data || []).map((attempt) => ({ ...attempt, passage: parseAttemptPassage(attempt.passage) }))
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

/**
 * Anomalías del condominio de la sesión (P5.C: `GET /anomalies` con sesión
 * humana; antes solo con la API key del worker y la UI recibía 401). Se
 * asume un arreglo; cualquier otra forma se trata como vacío.
 */
export async function listAnomalies(): Promise<AnomalyEvent[]> {
  try {
    const { data } = await api.get<unknown>('/anomalies')
    return Array.isArray(data) ? (data as AnomalyEvent[]) : []
  } catch (error) {
    throw toApiError(error, 'No se pudieron cargar las anomalías', {
      401: 'Tu sesión no permite ver las anomalías',
      403: 'No tienes permiso para ver las anomalías',
    })
  }
}

/**
 * Una anomalía con su foto (`snapshotJpegB64`), acotada al condominio de la
 * sesión y con `detections.read` (P6). El aviso por WebSocket no trae la
 * imagen: se pide aquí por id. También alimenta la vista de detalle.
 */
export async function getAnomaly(id: string): Promise<AnomalyEvent> {
  try {
    const { data } = await api.get<unknown>(`/anomalies/${encodeURIComponent(id)}`)
    const anomaly = parseAnomalyEvent(data)
    if (!anomaly) {
      throw new ApiError('La anomalía llegó con un formato inesperado', null)
    }
    return anomaly
  } catch (error) {
    throw toApiError(error, 'No se pudo cargar la anomalía', {
      401: 'Tu sesión no permite ver la anomalía',
      403: 'No tienes permiso para ver la anomalía',
      404: 'La anomalía no existe o no pertenece a tu condominio',
    })
  }
}
