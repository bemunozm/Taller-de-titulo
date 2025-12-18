import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Visit, CreateVisitFormData, UpdateVisitFormData } from '@/types/index'

// Obtener todas las visitas
export async function getVisits() {
    try {
        const { data } = await api.get<Visit[]>('/visits')
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener las visitas')
    }
}

// Obtener una visita por ID
export async function getVisitById(id: string) {
    try {
        const { data } = await api.get<Visit>(`/visits/${id}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener la visita')
    }
}

// Obtener una visita por código QR
export async function getVisitByQRCode(qrCode: string) {
    try {
        const { data } = await api.get<Visit>(`/visits/qr/${qrCode}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener la visita')
    }
}

// Crear una nueva visita
export async function createVisit(formData: CreateVisitFormData) {
    try {
        const { data } = await api.post<Visit>('/visits', formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al crear la visita')
    }
}

// Actualizar una visita
export async function updateVisit({ id, formData }: { id: string; formData: UpdateVisitFormData }) {
    try {
        const { data } = await api.patch<Visit>(`/visits/${id}`, formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al actualizar la visita')
    }
}

// Cancelar una visita
export async function cancelVisit(id: string) {
    try {
        const { data } = await api.post<Visit>(`/visits/${id}/cancel`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al cancelar la visita')
    }
}

// Check-in de una visita
export async function checkInVisit(id: string) {
    try {
        const { data } = await api.post<Visit>(`/visits/${id}/check-in`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al realizar el check-in')
    }
}

// Check-out de una visita
export async function checkOutVisit(id: string) {
    try {
        const { data } = await api.post<Visit>(`/visits/${id}/check-out`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al realizar el check-out')
    }
}

// Eliminar una visita
export async function deleteVisit(id: string) {
    try {
        await api.delete(`/visits/${id}`)
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al eliminar la visita')
    }
}
