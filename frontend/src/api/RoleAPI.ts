import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Role, RoleFormData, RoleUpdateData, Permission } from '@/types/index'

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

export async function getRoleById(id: string): Promise<Role> {
  try {
    const { data } = await api.get<Role>(`/roles/${id}`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function createRole(roleData: RoleFormData): Promise<Role> {
  try {
    const { data } = await api.post<Role>('/roles', roleData)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function updateRole(id: string, roleData: RoleUpdateData): Promise<Role> {
  try {
    const { data } = await api.patch<Role>(`/roles/${id}`, roleData)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function updateRolePermissions(id: string, permissionIds: string[]): Promise<Role> {
  try {
    const { data } = await api.put<Role>(`/roles/${id}/permissions`, { permissionIds })
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function deleteRole(id: string): Promise<{ message: string; deleted: boolean }> {
  try {
    const { data } = await api.delete<{ message: string; deleted: boolean }>(`/roles/${id}`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}

export async function getAvailablePermissions(): Promise<Permission[]> {
  try {
    const { data } = await api.get<Permission[]>('/roles/permissions/available')
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
    const { data } = await api.get<Record<string, Permission[]>>('/roles/permissions/by-module')
    return data || {}
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw error
  }
}
