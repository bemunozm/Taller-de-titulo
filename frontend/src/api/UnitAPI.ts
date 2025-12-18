import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Unit, CreateUnitFormData, UpdateUnitFormData, UnitStats, CreateBulkUnitsFormData, BulkUnitsResult } from '@/types/index'

// Obtener todas las unidades
export async function getUnits(includeInactive = false) {
    try {
        const { data } = await api.get<Unit[]>('/units', {
            params: { includeInactive },
        })
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener las unidades')
    }
}

// Obtener una unidad por ID
export async function getUnitById(id: string) {
    try {
        const { data } = await api.get<Unit>(`/units/${id}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener la unidad')
    }
}

// Obtener unidad por identificador (ej: A-303)
export async function getUnitByIdentifier(identifier: string) {
    try {
        const { data } = await api.get<Unit>(`/units/identifier/${identifier}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener la unidad')
    }
}

// Buscar unidades
export async function searchUnits(term: string) {
    try {
        const { data } = await api.get<Unit[]>('/units/search', {
            params: { term },
        })
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al buscar unidades')
    }
}

// Obtener unidades disponibles (sin familia activa)
export async function getAvailableUnits() {
    try {
        const { data } = await api.get<Unit[]>('/units/available')
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener unidades disponibles')
    }
}

// Obtener unidades por bloque
export async function getUnitsByBlock(block: string) {
    try {
        const { data } = await api.get<Unit[]>(`/units/block/${block}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener unidades del bloque')
    }
}

// Obtener unidades por piso
export async function getUnitsByFloor(floor: number) {
    try {
        const { data } = await api.get<Unit[]>(`/units/floor/${floor}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener unidades del piso')
    }
}

// Obtener estadísticas de unidades
export async function getUnitStats() {
    try {
        const { data } = await api.get<UnitStats>('/units/stats')
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener estadísticas')
    }
}

// Crear una nueva unidad
export async function createUnit(formData: CreateUnitFormData) {
    try {
        const { data } = await api.post<Unit>('/units', formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al crear la unidad')
    }
}

// Crear múltiples unidades en rango
export async function createBulkUnits(formData: CreateBulkUnitsFormData) {
    try {
        const { data } = await api.post<BulkUnitsResult>('/units/bulk', formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al crear las unidades')
    }
}

// Actualizar una unidad
export async function updateUnit({ id, formData }: { id: string; formData: UpdateUnitFormData }) {
    try {
        const { data } = await api.patch<Unit>(`/units/${id}`, formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al actualizar la unidad')
    }
}

// Eliminar (desactivar) una unidad
export async function deleteUnit(id: string) {
    try {
        await api.delete(`/units/${id}`)
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al eliminar la unidad')
    }
}
