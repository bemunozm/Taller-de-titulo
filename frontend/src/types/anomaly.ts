import { z } from 'zod'

// Esquema puro de la anomalía (sin red): importable desde tests sin cargar axios/env.

/** Niveles de sospecha que asigna la IA. Cualquier otro valor se conserva como texto. */
export const ANOMALY_SUSPICION_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const

const anomalyEventSchema = z.object({
  id: z.string().min(1),
  cameraId: z.string().catch(''),
  anomalyType: z.string().catch(''),
  confidence: z.number().finite().catch(0),
  snapshotJpegB64: z.string().nullish(),
  durationSeconds: z.number().nullish().catch(null),
  trackId: z.number().nullish().catch(null),
  suspicionLevel: z.string().nullish().catch(null),
  aiReasoning: z.string().nullish().catch(null),
  timestamp: z.string().catch(''),
})

/** Entidad `AnomalyEvent` del backend: las columnas nullable llegan como `null`. */
export type AnomalyEvent = z.infer<typeof anomalyEventSchema>

/**
 * Lee una anomalía de `GET /anomalies/:id` sin confiar en su forma. Sin `id`
 * (o si no es un objeto) devuelve `null`; los demás campos defectuosos caen a
 * un valor neutro para que la vista siga mostrando lo que sí llegó.
 */
export function parseAnomalyEvent(raw: unknown): AnomalyEvent | null {
  const parsed = anomalyEventSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
