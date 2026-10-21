import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import { ApiError, getApiErrorStatus, toApiError } from '@/helpers/httpErrors'

export type PendingAttempt = {
  id: string
  decision: string
  reason: string | null
  method: string | null
  expiresAt: string | null
  respondedBy: unknown
  respondedAt: string | null
  notificationId: string | null
  createdAt: string
  updatedAt: string
  detection: {
    id: string
    cameraId: string
    plate: string
    plate_raw?: string | null
    det_confidence?: number | null
    ocr_confidence?: number | null
    full_frame_path?: string | null
    createdAt: string
  }
}

export async function listPendingDetections(): Promise<PendingAttempt[]> {
  try {
    const { data } = await api.get<PendingAttempt[]>('/detections/pending')
    return data || []
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function checkPendingDetectionStatus(attemptId: string): Promise<{ active: boolean; reason?: string }> {
  try {
    const { data } = await api.get<{ active: boolean; reason?: string }>(`/detections/pending/${attemptId}/status`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

/** 409 de `PATCH /detections/pending/:id/respond`: ya fue respondida (otra sesión o un doble clic). */
export const PENDING_ALREADY_RESPONDED_MESSAGE =
  'Esta detección ya fue respondida. Se actualizó la lista con la decisión registrada.'

/** 400: la espera venció antes de responder. */
export const PENDING_EXPIRED_MESSAGE = 'La detección venció: ya no se puede aprobar ni rechazar.'

/** `true` si el error es el 409 de una detección ya respondida. */
export function isPendingAlreadyRespondedError(error: unknown): boolean {
  return getApiErrorStatus(error) === 409
}

/**
 * Responde una detección pendiente. Errores con su código (`ApiError`):
 * 409 si ya fue respondida (mensaje fijo y claro: la respuesta de la otra
 * persona ya cuenta) y 400 si venció.
 */
export async function respondToPendingDetection(
  attemptId: string,
  decision: 'approved' | 'denied',
  response?: string
): Promise<unknown> {
  try {
    const { data } = await api.patch<unknown>(`/detections/pending/${attemptId}/respond`, {
      decision,
      response,
    })
    return data
  } catch (error) {
    const apiError = toApiError(error, 'No se pudo responder la detección', { 400: PENDING_EXPIRED_MESSAGE })
    if (apiError.status === 409) {
      throw new ApiError(PENDING_ALREADY_RESPONDED_MESSAGE, 409)
    }
    throw apiError
  }
}
