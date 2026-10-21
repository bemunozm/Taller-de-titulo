import { z } from 'zod'

// Esquemas puros de la pasada (sin red): importables desde tests sin cargar axios/env.
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
