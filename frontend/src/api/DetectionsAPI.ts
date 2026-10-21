import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import { z } from 'zod'
import { ApiError, toApiError } from '@/helpers/httpErrors'

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

/** Dirección de una pasada o avistamiento; un valor desconocido del backend cae en "unknown". */
export const PASSAGE_DIRECTIONS = ['entry', 'exit', 'unknown'] as const
/** De dónde salió la dirección (E5): cámara fija, cruce de línea, movimiento, ancho de patente o nada. */
export const PASSAGE_DIRECTION_SOURCES = ['camera', 'line', 'motion', 'width', 'none'] as const

const passageDirectionSchema = z.enum(PASSAGE_DIRECTIONS).catch('unknown')
const passageDirectionSourceSchema = z.enum(PASSAGE_DIRECTION_SOURCES).catch('none')

/** Una detección que confirma la pasada, vista por una cámara. */
const passageSightingSchema = z.object({
  detectionId: z.string(),
  cameraId: z.string(),
  at: z.string(),
  direction: passageDirectionSchema,
  directionSource: passageDirectionSourceSchema,
  full_frame_path: z.string().nullish(),
  snapshot_jpeg_b64: z.string().nullish(),
})

const attemptPassageSchema = z.object({
  id: z.string(),
  direction: passageDirectionSchema,
  directionSource: passageDirectionSourceSchema,
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  sightingCount: z.number().int().nonnegative().catch(0),
  // Cada avistamiento se valida por separado: uno roto no tira la pasada entera.
  sightings: z.array(z.unknown()).catch([]),
})

export type PassageSighting = z.infer<typeof passageSightingSchema>
export type AttemptPassage = Omit<z.infer<typeof attemptPassageSchema>, 'sightings'> & {
  sightings: PassageSighting[]
}

/**
 * Pasada de un intento (E7). Tolerante: `passage` ausente, `null` o malformado
 * (datos anteriores a las pasadas) devuelve `null`, nunca lanza.
 */
export function parseAttemptPassage(raw: unknown): AttemptPassage | null {
  const parsed = attemptPassageSchema.safeParse(raw)
  if (!parsed.success) return null
  const sightings = parsed.data.sightings.flatMap((item) => {
    const sighting = passageSightingSchema.safeParse(item)
    return sighting.success ? [sighting.data] : []
  })
  return { ...parsed.data, sightings }
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

// Entidad `AnomalyEvent` del backend: las columnas nullable llegan como `null`.
export type AnomalyEvent = {
  id: string
  cameraId: string
  anomalyType: string
  confidence: number
  snapshotJpegB64?: string | null
  durationSeconds?: number | null
  trackId?: number | null
  suspicionLevel?: string | null
  aiReasoning?: string | null
  timestamp: string
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

function isAnomalyEvent(value: unknown): value is AnomalyEvent {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
}

/**
 * Una anomalía con su foto (`snapshotJpegB64`), acotada al condominio de la
 * sesión y con `detections.read` (P6). El aviso por WebSocket no trae la
 * imagen: se pide aquí por id.
 */
export async function getAnomaly(id: string): Promise<AnomalyEvent> {
  try {
    const { data } = await api.get<unknown>(`/anomalies/${encodeURIComponent(id)}`)
    if (!isAnomalyEvent(data)) {
      throw new ApiError('La anomalía llegó con un formato inesperado', null)
    }
    return data
  } catch (error) {
    throw toApiError(error, 'No se pudo cargar la anomalía', {
      401: 'Tu sesión no permite ver la anomalía',
      403: 'No tienes permiso para ver la anomalía',
      404: 'La anomalía no existe o no pertenece a tu condominio',
    })
  }
}
