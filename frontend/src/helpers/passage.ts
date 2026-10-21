import type { AttemptPassage, PassageSighting } from '@/types/passage'
import type { DetectionImageSource } from '@/helpers/detectionImage'

const DIRECTION_LABELS: Record<AttemptPassage['direction'], string> = {
  entry: 'Entrada',
  exit: 'Salida',
  unknown: 'Sin determinar',
}

/** Fuente de la dirección en lenguaje humano (E5). */
const DIRECTION_SOURCE_LABELS: Record<AttemptPassage['directionSource'], string> = {
  line: 'cruce de línea',
  camera: 'cámara de entrada/salida',
  motion: 'movimiento',
  width: 'tamaño de la patente',
  none: 'sin determinar',
}

export function getPassageDirectionLabel(direction: AttemptPassage['direction']): string {
  return DIRECTION_LABELS[direction]
}

export function getDirectionSourceLabel(source: AttemptPassage['directionSource']): string {
  return DIRECTION_SOURCE_LABELS[source]
}

/**
 * Adapta un avistamiento al formato que entiende `resolveDetectionImage` /
 * `DetectionImages`, para no duplicar la validación de URLs y base64.
 */
export function sightingImageSource(sighting: PassageSighting): DetectionImageSource {
  return {
    full_frame_path: sighting.full_frame_path ?? null,
    meta: { snapshot_jpeg_b64: sighting.snapshot_jpeg_b64 ?? null },
  }
}

/** Nombre de la cámara de un avistamiento; si no está en la lista, el id tal cual. */
export function resolveCameraName(
  cameraId: string,
  cameras: ReadonlyArray<{ id: string; name?: string | null; location?: string | null }>,
): string {
  const camera = cameras.find((candidate) => candidate.id === cameraId)
  return camera?.name || camera?.location || cameraId
}

/** Avistamientos ordenados por hora (sin mutar el original). */
export function sortedSightings(passage: AttemptPassage): PassageSighting[] {
  return [...passage.sightings].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
}

/**
 * Cámaras distintas que vieron la pasada. Sin detalle de avistamientos se usa
 * `sightingCount`; sin pasada (datos antiguos), 0.
 */
export function countPassageCameras(passage: AttemptPassage | null | undefined): number {
  if (!passage) return 0
  if (passage.sightings.length === 0) return passage.sightingCount
  return new Set(passage.sightings.map((sighting) => sighting.cameraId)).size
}
