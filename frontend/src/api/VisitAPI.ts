import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Visit, CreateVisitFormData, UpdateVisitFormData } from '@/types/index'

// Shape de error de los endpoints de Nest: `message` es un string (p.ej. el 409
// de una transición inválida) o un string[] (errores de ValidationPipe).
interface NestErrorBody {
    message?: unknown
}

/**
 * Mensaje del backend tal cual; el `fallback` solo cubre lo que no trae uno
 * (red caída, proxy con HTML, cuerpo vacío).
 */
function getApiErrorMessage(error: unknown, fallback: string): string {
    if (!isAxiosError<NestErrorBody>(error)) {
        return fallback
    }

    const message = error.response?.data?.message
    if (typeof message === 'string' && message.trim() !== '') {
        return message
    }
    if (Array.isArray(message)) {
        const parts = message.filter(
            (part): part is string => typeof part === 'string' && part.trim() !== '',
        )
        if (parts.length > 0) {
            return parts.join('. ')
        }
    }
    return fallback
}

// Obtener todas las visitas
export async function getVisits() {
    try {
        const { data } = await api.get<Visit[]>('/visits')
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al obtener las visitas'))
    }
}

// Obtener una visita por ID
export async function getVisitById(id: string) {
    try {
        const { data } = await api.get<Visit>(`/visits/${id}`)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al obtener la visita'))
    }
}

// Obtener una visita por código QR
export async function getVisitByQRCode(qrCode: string) {
    try {
        const { data } = await api.get<Visit>(`/visits/qr/${encodeURIComponent(qrCode)}`)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al obtener la visita'))
    }
}

// Crear una nueva visita
export async function createVisit(formData: CreateVisitFormData) {
    try {
        const { data } = await api.post<Visit>('/visits', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al crear la visita'))
    }
}

// Actualizar una visita (409 si no está en pending/ready)
export async function updateVisit({ id, formData }: { id: string; formData: UpdateVisitFormData }) {
    try {
        const { data } = await api.patch<Visit>(`/visits/${id}`, formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al actualizar la visita'))
    }
}

// Cancelar una visita (409 si no está en pending)
export async function cancelVisit(id: string) {
    try {
        const { data } = await api.post<Visit>(`/visits/${id}/cancel`)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al cancelar la visita'))
    }
}

// Check-in de una visita (409 si no está en pending/ready)
export async function checkInVisit(id: string) {
    try {
        const { data } = await api.post<Visit>(`/visits/${id}/check-in`)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al realizar el check-in'))
    }
}

// Check-out de una visita (solo desde active)
export async function checkOutVisit(id: string) {
    try {
        const { data } = await api.post<Visit>(`/visits/${id}/check-out`)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al realizar el check-out'))
    }
}

// Eliminar una visita
export async function deleteVisit(id: string) {
    try {
        await api.delete(`/visits/${id}`)
    } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Error al eliminar la visita'))
    }
}
