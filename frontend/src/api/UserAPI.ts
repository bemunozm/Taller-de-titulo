import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { User, UserUpdateData, UserAdminFormData } from '@/types/index'

// Obtener todos los usuarios
export async function getUsers() {
  try {
    const { data } = await api.get<User[]>('/users')
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw new Error('Error al obtener los usuarios')
  }
}

// Obtener un usuario por ID
export async function getUserById(id: string) {
  try {
    const { data } = await api.get<User>(`/users/${id}`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw new Error('Error al obtener el usuario')
  }
}

// Crear un nuevo usuario (por administrador)
export async function createUser(formData: UserAdminFormData) {
  try {
    const { data } = await api.post<{ message: string; user: User }>('/users/create-by-admin', formData)
    return data.user
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw new Error('Error al crear el usuario')
  }
}

// Actualizar un usuario
export async function updateUser({ id, formData }: { id: string; formData: UserUpdateData }) {
  try {
    const { data } = await api.patch<{ affected: number }>(`/users/${id}`, formData)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw new Error('Error al actualizar el usuario')
  }
}

// Eliminar un usuario
export async function deleteUser(id: string) {
  try {
    const { data } = await api.delete<{ affected: number }>(`/users/${id}`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw new Error('Error al eliminar el usuario')
  }
}

// Deshabilitar un usuario
export async function disableUser(id: string) {
  try {
    const { data } = await api.patch<{ message: string; affected: number }>(`/users/${id}/disable`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw new Error('Error al deshabilitar el usuario')
  }
}

// Habilitar un usuario
export async function enableUser(id: string) {
  try {
    const { data } = await api.patch<{ message: string; affected: number }>(`/users/${id}/enable`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response) {
      throw new Error(error.response.data.message)
    }
    throw new Error('Error al habilitar el usuario')
  }
}
