import api from '@/lib/axios'
import { isAxiosError } from 'axios'

export type PlateDetection = {
  id: string
  cameraId: string
  plate: string
  plate_raw?: string | null
  det_confidence?: number | null
  ocr_confidence?: number | null
  full_frame_path?: string | null
  meta?: any | null
  createdAt: string
}

export type AccessAttempt = {
  id: string
  method?: string | null
  decision: string
  reason?: string | null
  createdAt: string
  residente?: any | null
  detection: PlateDetection
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
    return data || []
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function createAccessAttempt(payload: { detectionId: string; decision: string; method?: string; reason?: string }) {
  try {
    const { data } = await api.post('/detections/plates/attempts', payload)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}
