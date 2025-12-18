import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type { Vehicle, CreateVehicleFormData, UpdateVehicleFormData } from '@/types/index'

// Obtener todos los vehículos
export async function getVehicles() {
    try {
        const { data } = await api.get<Vehicle[]>('/vehicles')
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener los vehículos')
    }
}

// Obtener un vehículo por ID
export async function getVehicleById(id: string) {
    try {
        const { data } = await api.get<Vehicle>(`/vehicles/${id}`)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al obtener el vehículo')
    }
}

// Crear un nuevo vehículo
export async function createVehicle(formData: CreateVehicleFormData) {
    try {
        console.log('=== API CREATE ===');
        console.log('Sending to API:', formData);
        console.log('ownerId in API:', formData.ownerId);
        const { data } = await api.post<Vehicle>('/vehicles', formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al crear el vehículo')
    }
}

// Actualizar un vehículo
export async function updateVehicle({ id, formData }: { id: string; formData: UpdateVehicleFormData }) {
    try {
        console.log('=== API UPDATE ===');
        console.log('Sending to API:', formData);
        console.log('ownerId in API:', formData.ownerId);
        const { data } = await api.put<Vehicle>(`/vehicles/${id}`, formData)
        return data
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al actualizar el vehículo')
    }
}

// Eliminar un vehículo
export async function deleteVehicle(id: string) {
    try {
        await api.delete(`/vehicles/${id}`)
    } catch (error) {
        if (isAxiosError(error) && error.response) {
            throw new Error(error.response.data.message)
        }
        throw new Error('Error al eliminar el vehículo')
    }
}
