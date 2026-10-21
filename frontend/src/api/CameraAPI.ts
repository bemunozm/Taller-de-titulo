import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Camera, CameraLprSettingsResponse, CreateCameraPayload, LprSettings, UpdateCameraFormData, ZonePoint } from '@/types/index'
import { cameraLprSettingsResponseSchema } from '@/types/index'
import { toApiError } from '@/helpers/httpErrors'

export async function enableCameraGuardian(id: string, enableGuardian: boolean): Promise<{ id: string; name: string; enableGuardian: boolean }> {
  try {
    const { data } = await api.patch(`/cameras/${id}/enable-guardian`, { enableGuardian })
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

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

export async function createCamera(formData: CreateCameraPayload): Promise<Camera> {
  try {
    const { data } = await api.post<Camera>('/cameras', formData)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function updateCamera(id: string, formData: UpdateCameraFormData): Promise<Camera> {
  try {
    const { data } = await api.patch<Camera>(`/cameras/${id}`, formData)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function deleteCamera(id: string): Promise<unknown> {
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

export async function registerCamera(id: string): Promise<unknown> {
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

export async function getIAHealth(): Promise<{ ok: boolean; status: string; details?: unknown; message?: string }> {
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

export async function getMediamtxHealth(): Promise<{ ok: boolean; status: string; details?: unknown; message?: string }> {
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

/** Zonas de intrusión del Guardián (reemplaza todas las zonas de la cámara). */
export async function updateCameraGuardianZones(id: string, zones: ZonePoint[][]): Promise<void> {
  try {
    await api.patch(`/cameras/${id}/zones`, { zones })
  } catch (error) {
    throw toApiError(error, 'Error al guardar las zonas')
  }
}

/** Configuración de visión LPR de la cámara; `lprSettings: null` = defaults del worker. */
export async function getCameraLprSettings(id: string): Promise<CameraLprSettingsResponse> {
  try {
    const { data } = await api.get<unknown>(`/cameras/${id}/lpr-settings`)
    return cameraLprSettingsResponseSchema.parse(data)
  } catch (error) {
    throw toApiError(error, 'No se pudo cargar la configuración LPR')
  }
}

/** Reemplaza (no mezcla) la configuración LPR: hay que enviar el objeto completo. */
export async function updateCameraLprSettings(
  id: string,
  settings: LprSettings,
): Promise<CameraLprSettingsResponse> {
  try {
    const { data } = await api.patch<unknown>(`/cameras/${id}/lpr-settings`, settings)
    return cameraLprSettingsResponseSchema.parse(data)
  } catch (error) {
    throw toApiError(error, 'No se pudo guardar la configuración LPR')
  }
}

/** Vuelve a los defaults del worker (el backend interpreta `{}` como `null`). */
export async function resetCameraLprSettings(id: string): Promise<CameraLprSettingsResponse> {
  return updateCameraLprSettings(id, {})
}
