import api from '@/lib/axios'
import { isAxiosError } from 'axios'

export type PendingAttempt = {
  id: string
  decision: string
  reason: string | null
  method: string | null
  expiresAt: string | null
  respondedBy: any | null
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

export async function respondToPendingDetection(
  attemptId: string,
  decision: 'approved' | 'denied',
  response?: string
): Promise<any> {
  try {
    const { data } = await api.patch(`/detections/pending/${attemptId}/respond`, {
      decision,
      response,
    })
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}
