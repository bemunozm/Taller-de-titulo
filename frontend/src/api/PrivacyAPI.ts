import api from '@/lib/axios'
import { ApiError, isRateLimitError, toApiError } from '@/helpers/httpErrors'
import { filenameFromContentDisposition, toLocalIsoDate } from '@/helpers/download'

/**
 * Exportación de los datos del titular (acceso y portabilidad, P7.R):
 * `GET /auth/me/data-export`. La forma se tipa tolerante: el archivo se
 * entrega tal cual llega, sin recortar campos que el backend agregue.
 */
export interface MyDataExport {
  generatedAt?: string
  user?: Record<string, unknown>
  family?: Record<string, unknown> | null
  vehicles?: unknown[]
  visitsHosted?: unknown[]
  notifications?: unknown[]
  [key: string]: unknown
}

export interface DataExportFile {
  filename: string
  blob: Blob
  data: MyDataExport
}

/** El backend limita la exportación a pocas por hora por usuario. */
export const DATA_EXPORT_RATE_LIMIT_MESSAGE =
  'Ya descargaste tus datos varias veces en la última hora. Espera un rato e inténtalo de nuevo.'
export const DATA_EXPORT_ERROR_MESSAGE = 'No se pudieron descargar tus datos. Inténtalo de nuevo más tarde.'
export const DATA_EXPORT_INVALID_MESSAGE = 'El servidor entregó una respuesta inesperada. Inténtalo de nuevo más tarde.'

/** Nombre del archivo si la respuesta no trae (o no expone) `Content-Disposition`. */
export function defaultDataExportFilename(now: Date = new Date()): string {
  return `vigilia-mis-datos-${toLocalIsoDate(now)}.json`
}

function isDataExport(value: unknown): value is MyDataExport {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function downloadMyDataExport(now: Date = new Date()): Promise<DataExportFile> {
  try {
    const response = await api.get<unknown>('/auth/me/data-export')
    const data: unknown = response.data
    if (!isDataExport(data)) {
      throw new ApiError(DATA_EXPORT_INVALID_MESSAGE, response.status)
    }

    // Cross-origin, el header solo es legible si el backend lo expone (CORS).
    const header: unknown = response.headers['content-disposition']
    const filename = filenameFromContentDisposition(header) ?? defaultDataExportFilename(now)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })

    return { filename, blob, data }
  } catch (error) {
    if (isRateLimitError(error)) {
      throw new ApiError(DATA_EXPORT_RATE_LIMIT_MESSAGE, 429)
    }
    throw toApiError(error, DATA_EXPORT_ERROR_MESSAGE, {
      401: 'Tu sesión expiró. Inicia sesión de nuevo para descargar tus datos.',
    })
  }
}
