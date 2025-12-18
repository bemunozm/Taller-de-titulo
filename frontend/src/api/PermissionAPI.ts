import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Permission } from '@/types/index'

export async function listPermissions(): Promise<Permission[]> {
  try {
    const { data } = await api.get<Permission[]>('/permissions')
    return data || []
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getPermissionsByModule(): Promise<Record<string, Permission[]>> {
  try {
    const { data } = await api.get<Record<string, Permission[]>>('/permissions/by-module')
    return data || {}
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}
