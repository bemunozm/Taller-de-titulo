import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Family, CreateFamilyFormData, UpdateFamilyFormData, AvailableUser } from '@/types/index'

// Obtener todas las familias
export async function getFamilies() {
    try {
        const { data } = await api.get<Family[]>('/families')
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener las familias')
    }
}

// Obtener una familia por ID
export async function getFamilyById(id: string) {
    try {
        const { data } = await api.get<Family>(`/families/${id}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener la familia')
    }
}

// Crear una nueva familia
export async function createFamily(formData: CreateFamilyFormData) {
    try {
        const { data } = await api.post<Family>('/families', formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al crear la familia')
    }
}

// Actualizar una familia
export async function updateFamily({ id, formData }: { id: string; formData: UpdateFamilyFormData }) {
    try {
        const { data } = await api.patch<Family>(`/families/${id}`, formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al actualizar la familia')
    }
}

// Eliminar una familia
export async function deleteFamily(id: string) {
    try {
        await api.delete(`/families/${id}`)
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al eliminar la familia')
    }
}

// Agregar un miembro a la familia
export async function addMemberToFamily({ familyId, userId }: { familyId: string; userId: string }) {
    try {
        const { data } = await api.post<Family>(`/families/${familyId}/members`, { userId })
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al agregar el miembro a la familia')
    }
}

// Remover un miembro de la familia
export async function removeMemberFromFamily({ familyId, userId }: { familyId: string; userId: string }) {
    try {
        const { data } = await api.delete<Family>(`/families/${familyId}/members/${userId}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al remover el miembro de la familia')
    }
}

// Agregar múltiples miembros a la familia
export async function addMembersToFamily({ familyId, userIds }: { familyId: string; userIds: string[] }) {
    try {
        const { data } = await api.post<Family>(`/families/${familyId}/members/bulk`, { userIds })
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al agregar los miembros a la familia')
    }
}

// Obtener usuarios disponibles (sin familia asignada)
export async function getAvailableUsers() {
    try {
        const { data } = await api.get<AvailableUser[]>('/families/available-users')
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener los usuarios disponibles')
    }
}
