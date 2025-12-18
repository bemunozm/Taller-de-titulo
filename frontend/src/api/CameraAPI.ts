import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Camera, CreateCameraFormData, UpdateCameraFormData } from '@/types/index'

export async function listCameras(): Promise<Camera[]> {
  try {
    const { data } = await api.get<Camera[]>('/cameras')
    return data || []
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function createCamera(formData: CreateCameraFormData) {
  try {
    const { data } = await api.post('/cameras', formData)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function updateCamera(id: string, formData: UpdateCameraFormData) {
  try {
    const { data } = await api.patch(`/cameras/${id}`, formData)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function deleteCamera(id: string) {
  try {
    const { data } = await api.delete(`/cameras/${id}`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function registerCamera(id: string) {
  try {
    const { data } = await api.post(`/cameras/${id}/register`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getCameraSourceUrl(id: string): Promise<{ sourceUrl: string | null }> {
  try {
    const { data } = await api.get(`/cameras/${id}/source`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getCameraHasSource(id: string): Promise<{ hasSource: boolean }> {
  try {
    const { data } = await api.get(`/cameras/${id}/has-source`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getCameraRecentEventsCount(id: string): Promise<{ recentEvents: number }> {
  try {
    const { data } = await api.get(`/cameras/${id}/recent-events-count`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getIAHealth(): Promise<{ ok: boolean; status: string; details?: any; message?: string }> {
  try {
    const { data } = await api.get('/workers/ia-health')
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getMediamtxHealth(): Promise<{ ok: boolean; status: string; details?: any; message?: string }> {
  try {
    const { data } = await api.get('/mediamtx/health')
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function enableCameraLpr(id: string, enableLpr: boolean): Promise<{ id: string; name: string; enableLpr: boolean }> {
  try {
    const { data } = await api.patch(`/cameras/${id}/enable-lpr`, { enableLpr })
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}
