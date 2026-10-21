/** Tope del base64 del recorte (~1,5 MB de JPEG): no se procesa input mayor. */
export const MAX_SNAPSHOT_B64_LENGTH = 2_000_000

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
// Todo JPEG empieza con FF D8 FF, que en base64 es "/9j/".
const JPEG_BASE64_PREFIX = '/9j/'
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])

export interface DetectionImageSource {
  full_frame_path?: string | null
  meta?: unknown
}

export interface ResolvedDetectionImage {
  /** URL segura del cuadro completo, o `null` (p. ej. ruta de disco del host LPR). */
  fullFrameUrl: string | null
  /** Data URL del recorte de la patente, o `null`. */
  snapshotDataUrl: string | null
}

function toSafeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw === '' || raw.length > 2048) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    // Rutas relativas o de disco (C:\... se parsea con esquema "c:") no son URLs válidas.
    return null
  }
  if (url.protocol === 'https:') return url.href
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url.href
  return null
}

function toSnapshotDataUrl(meta: unknown): string | null {
  if (typeof meta !== 'object' || meta === null) return null
  const b64: unknown = (meta as Record<string, unknown>).snapshot_jpeg_b64
  if (typeof b64 !== 'string' || b64.length < 8 || b64.length > MAX_SNAPSHOT_B64_LENGTH) return null
  if (b64.length % 4 !== 0 || !b64.startsWith(JPEG_BASE64_PREFIX) || !BASE64_PATTERN.test(b64)) return null
  return `data:image/jpeg;base64,${b64}`
}

/**
 * Decide qué imágenes de una detección se pueden mostrar. Nunca devuelve rutas
 * de disco ni esquemas distintos de https (http solo en localhost para dev).
 */
export function resolveDetectionImage(det: DetectionImageSource | null | undefined): ResolvedDetectionImage {
  return {
    fullFrameUrl: toSafeUrl(det?.full_frame_path),
    snapshotDataUrl: toSnapshotDataUrl(det?.meta),
  }
}

/** ¿Hay al menos una imagen mostrable (cuadro completo o recorte)? */
export function hasDetectionImage(det: DetectionImageSource | null | undefined): boolean {
  const { fullFrameUrl, snapshotDataUrl } = resolveDetectionImage(det)
  return fullFrameUrl !== null || snapshotDataUrl !== null
}
