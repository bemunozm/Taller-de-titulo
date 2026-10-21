import { isAxiosError } from 'axios'

/** Mensaje para un 429 (throttling del backend). */
export const RATE_LIMIT_MESSAGE = 'Demasiados intentos. Espera un momento e intenta de nuevo.'

export function isRateLimitError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 429
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function backendMessage(data: unknown): string | null {
  if (!isRecord(data)) {
    return null
  }
  const { message } = data
  if (typeof message === 'string' && message.trim() !== '') {
    return message
  }
  if (Array.isArray(message)) {
    const parts = message.filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    return parts.length > 0 ? parts.join('. ') : null
  }
  return null
}

/**
 * Error de la API con el código HTTP, para que la UI distinga un 403 de un
 * 409 sin parsear el texto. `status` es `null` si no hubo respuesta (red
 * caída) o si el error no vino de HTTP. `field` es el campo que el backend
 * señala en el cuerpo (p.ej. el 409 de duplicados `{ ..., field: 'phone' }`),
 * o `null` si no lo indica.
 */
export class ApiError extends Error {
  readonly status: number | null
  readonly field: string | null

  constructor(message: string, status: number | null, field: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.field = field
  }
}

function backendField(data: unknown): string | null {
  if (!isRecord(data)) {
    return null
  }
  const { field } = data
  return typeof field === 'string' && field.trim() !== '' ? field : null
}

/** Mensajes por código HTTP para cuando el backend no trae `message`. */
export type StatusMessages = Partial<Record<number, string>>

/**
 * Normaliza cualquier error de una llamada a la API:
 * - 429 → `RATE_LIMIT_MESSAGE`;
 * - otro error HTTP → el `message` del backend; si no trae, el de
 *   `statusMessages` para ese código; si tampoco, `fallback`;
 * - error no HTTP → su `message`, si no `fallback`.
 */
export function toApiError(error: unknown, fallback: string, statusMessages: StatusMessages = {}): ApiError {
  if (error instanceof ApiError) {
    return error
  }
  if (isAxiosError(error)) {
    const status = error.response?.status ?? null
    if (status === 429) {
      return new ApiError(RATE_LIMIT_MESSAGE, status)
    }
    const statusMessage = status === null ? undefined : statusMessages[status]
    const data: unknown = error.response?.data
    return new ApiError(backendMessage(data) ?? statusMessage ?? fallback, status, backendField(data))
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return new ApiError(error.message, null)
  }
  return new ApiError(fallback, null)
}

/** Código HTTP de un error normalizado con `toApiError`, o `null`. */
export function getApiErrorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null
}

/**
 * Mensaje de error para mostrar a una persona:
 * - 429 → `RATE_LIMIT_MESSAGE` (nunca "Request failed with status code 429"
 *   ni "ThrottlerException: Too Many Requests");
 * - otro error HTTP → el `message` del backend si lo trae, si no `fallback`;
 * - error no HTTP → su `message`, si no `fallback`.
 */
export function getUserFacingErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    if (error.response?.status === 429) {
      return RATE_LIMIT_MESSAGE
    }
    return backendMessage(error.response?.data) ?? fallback
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }
  return fallback
}
