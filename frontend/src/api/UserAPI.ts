import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import { ApiError, toApiError } from '@/helpers/httpErrors'
import type { CreateUserByAdminPayload, User, UserSummary, UserUpdateData } from '@/types/index'

const FORBIDDEN_MESSAGE = 'No tienes permiso para realizar esta acción'

/** 403 al escribir sobre otro usuario cuyos permisos el actor no tiene. */
export const FORBIDDEN_TARGET_USER_MESSAGE =
  'No puedes modificar a este usuario: tiene permisos que tú no tienes'

/**
 * 409 de un email, RUT o teléfono ya usado por otro usuario (P5; antes 400).
 * El backend nombra el campo en su `message`, que tiene prioridad sobre este
 * texto de respaldo (ver getDuplicateUserFields).
 */
export const DUPLICATE_USER_MESSAGE = 'Ya existe un usuario con ese correo, RUT o teléfono'

// Obtener todos los usuarios (detalle: solo con users.update o super-admin)
export async function getUsers() {
  try {
    const { data } = await api.get<User[]>('/users')
    return data
  } catch (error) {
    throw toApiError(error, 'Error al obtener los usuarios', { 403: FORBIDDEN_MESSAGE })
  }
}

/**
 * Usuarios para selectores (anfitrión, propietario). Quien no tiene
 * `users.update` recibe la proyección mínima `{ id, name, family }` (P5.C),
 * así que aquí solo se tipan esos campos.
 */
export async function getUserOptions(): Promise<UserSummary[]> {
  try {
    const { data } = await api.get<UserSummary[]>('/users')
    // Con el detalle llegan también las cuentas deshabilitadas (y anonimizadas):
    // no son elegibles como anfitrión o propietario. La proyección mínima ya
    // viene sin ellas.
    return Array.isArray(data) ? data.filter((user) => !user.deletedAt) : []
  } catch (error) {
    throw toApiError(error, 'Error al obtener los usuarios', { 403: FORBIDDEN_MESSAGE })
  }
}

// Obtener un usuario por ID
export async function getUserById(id: string) {
  try {
    const { data } = await api.get<User>(`/users/${id}`)
    return data
  } catch (error) {
    throw toApiError(error, 'Error al obtener el usuario', { 403: FORBIDDEN_MESSAGE })
  }
}

/**
 * Crear un usuario (por administrador). `organizationId` solo lo envía el
 * super-admin: a cualquier otro actor el backend le responde 403.
 */
export async function createUser(payload: CreateUserByAdminPayload) {
  try {
    const { data } = await api.post<{ message: string; user: User }>('/users/create-by-admin', payload)
    return data.user
  } catch (error) {
    throw toApiError(error, 'Error al crear el usuario', {
      403: 'No puedes crear este usuario con esos roles o en ese condominio',
      409: DUPLICATE_USER_MESSAGE,
    })
  }
}

// Actualizar un usuario
export async function updateUser({ id, formData }: { id: string; formData: UserUpdateData }) {
  try {
    const { data } = await api.patch<{ affected: number }>(`/users/${id}`, formData)
    return data
  } catch (error) {
    throw toApiError(error, 'Error al actualizar el usuario', {
      403: 'No puedes editar este usuario, cambiar su correo ni asignarle esos roles',
      409: DUPLICATE_USER_MESSAGE,
    })
  }
}

/** Mensaje de un 409 al borrar: el usuario tiene datos asociados. */
export const DELETE_USER_CONFLICT_MESSAGE =
  'El usuario tiene datos asociados (visitas, vehículos u otros registros) y no se puede eliminar.'

// Eliminar un usuario (409 si tiene datos asociados; 403 sobre uno mismo)
export async function deleteUser(id: string) {
  try {
    const { data } = await api.delete<{ affected: number }>(`/users/${id}`)
    return data
  } catch (error) {
    throw toApiError(error, 'Error al eliminar el usuario', {
      403: FORBIDDEN_TARGET_USER_MESSAGE,
      409: DELETE_USER_CONFLICT_MESSAGE,
    })
  }
}

// Deshabilitar un usuario (403 sobre uno mismo)
export async function disableUser(id: string) {
  try {
    const { data } = await api.patch<{ message: string; affected: number }>(`/users/${id}/disable`)
    return data
  } catch (error) {
    throw toApiError(error, 'Error al deshabilitar el usuario', { 403: FORBIDDEN_TARGET_USER_MESSAGE })
  }
}

/**
 * 409 al habilitar: la cuenta ya se anonimizó (pasaron los días de retención
 * desde la baja) y no se puede recuperar.
 */
export const ANONYMIZED_USER_ENABLE_MESSAGE =
  'Esta cuenta ya fue anonimizada (Ley 21.719): sus datos se borraron y no se puede volver a habilitar. Si la persona vuelve, crea una cuenta nueva.'

// Habilitar un usuario (409 si la cuenta ya se anonimizó)
export async function enableUser(id: string) {
  try {
    const { data } = await api.patch<{ message: string; affected: number }>(`/users/${id}/enable`)
    return data
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 409) {
      throw new ApiError(ANONYMIZED_USER_ENABLE_MESSAGE, 409)
    }
    throw toApiError(error, 'Error al habilitar el usuario', { 403: FORBIDDEN_TARGET_USER_MESSAGE })
  }
}
