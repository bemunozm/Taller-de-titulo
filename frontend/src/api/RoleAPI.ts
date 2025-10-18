import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Role } from '@/types/index'

export async function listRoles(): Promise<Role[]> {
  try {
    const { data } = await api.get<Role[]>('/roles')
    return data || []
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}
