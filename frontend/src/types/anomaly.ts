import { z } from 'zod'

// Esquema puro de la anomalía (sin red): importable desde tests sin cargar axios/env.

/** Niveles de sospecha que asigna la IA. Cualquier otro valor se conserva como texto. */
export const ANOMALY_SUSPICION_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const

/** Ciclo de revisión de una anomalía (`status` del backend). */
export const ANOMALY_STATUSES = ['open', 'reviewed', 'dismissed', 'false_alarm'] as const
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number]

/** Estado del análisis asíncrono de la IA (`aiStatus`); `null` en filas anteriores a la IA asíncrona. */
export const ANOMALY_AI_STATUSES = ['pending', 'done', 'failed', 'skipped'] as const
export type AnomalyAiStatus = (typeof ANOMALY_AI_STATUSES)[number]

/** Tipos que detecta el Guardián. */
export const ANOMALY_TYPES = ['intrusion', 'loitering'] as const

/** Largo máximo de la nota de resolución (igual que el DTO del backend). */
export const ANOMALY_NOTE_MAX_LENGTH = 500

const baseShape = {
  id: z.string().min(1),
  organizationId: z.string().nullish().catch(null),
  cameraId: z.string().catch(''),
  anomalyType: z.string().catch(''),
  confidence: z.number().finite().catch(0),
  durationSeconds: z.number().nullish().catch(null),
  trackId: z.number().nullish().catch(null),
  suspicionLevel: z.string().nullish().catch(null),
  aiReasoning: z.string().nullish().catch(null),
  timestamp: z.string().catch(''),
  // Un estado desconocido se trata como pendiente de revisión.
  status: z.enum(ANOMALY_STATUSES).catch('open'),
  resolvedById: z.string().nullish().catch(null),
  resolvedAt: z.string().nullish().catch(null),
  resolutionNote: z.string().nullish().catch(null),
  aiStatus: z.enum(ANOMALY_AI_STATUSES).nullish().catch(null),
  aiFalsePositive: z.boolean().nullish().catch(null),
}

/** Fila del listado: nunca trae la foto. */
const anomalyListItemSchema = z.object(baseShape)

/** Detalle (`GET /anomalies/:id`): suma la foto. */
const anomalyEventSchema = z.object({
  ...baseShape,
  snapshotJpegB64: z.string().nullish(),
  // Solo en el detalle y en la respuesta del PATCH (no en el listado).
  resolvedByName: z.string().nullish().catch(null),
})

/** Entidad `AnomalyEvent` del backend: las columnas nullable llegan como `null`. */
export type AnomalyEvent = z.infer<typeof anomalyEventSchema>
/** Fila de `GET /anomalies`: igual que el detalle, sin `snapshotJpegB64`. */
export type AnomalyListItem = z.infer<typeof anomalyListItemSchema>

export interface AnomalyListPage {
  items: AnomalyListItem[]
  total: number
}

/**
 * Lee una anomalía de `GET /anomalies/:id` sin confiar en su forma. Sin `id`
 * (o si no es un objeto) devuelve `null`; los demás campos defectuosos caen a
 * un valor neutro para que la vista siga mostrando lo que sí llegó.
 */
export function parseAnomalyEvent(raw: unknown): AnomalyEvent | null {
  const parsed = anomalyEventSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Lee una fila del listado; sin `id` válido devuelve `null`. */
export function parseAnomalyListItem(raw: unknown): AnomalyListItem | null {
  const parsed = anomalyListItemSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/**
 * Lee `GET /anomalies` (`{ items, total }`). Las filas sin id se descartan; un
 * `total` ausente o inválido se reemplaza por la cantidad de filas. Un arreglo
 * suelto (forma anterior del endpoint) se acepta como una sola página.
 */
export function parseAnomalyListPage(raw: unknown): AnomalyListPage {
  const rawItems: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : []
  const items = rawItems.flatMap((row) => {
    const item = parseAnomalyListItem(row)
    return item ? [item] : []
  })
  const rawTotal = Array.isArray(raw) ? undefined : (raw as { total?: unknown } | null)?.total
  const total =
    typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= items.length ? Math.floor(rawTotal) : items.length
  return { items, total }
}
