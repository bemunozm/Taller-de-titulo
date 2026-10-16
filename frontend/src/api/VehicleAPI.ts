import api from '@/lib/axios'
import { toApiError, type StatusMessages } from '@/helpers/httpErrors'
import type { CreateVehiclePayload, UpdateVehiclePayload, Vehicle } from '@/types/index'

// Mensajes de los rechazos del backend (P5.C) cuando no traen `message`.
const WRITE_ERRORS: StatusMessages = {
    400: 'Revisa los datos: tipo de vehículo o nivel de acceso no válido',
    403: 'No puedes registrar un vehículo a nombre de ese propietario',
    409: 'Ya existe un vehículo con esa patente en el condominio',
}

// Obtener todos los vehículos
export async function getVehicles() {
    try {
        const { data } = await api.get<Vehicle[]>('/vehicles')
        return data
    } catch (error) {
        throw toApiError(error, 'Error al obtener los vehículos')
    }
}

// Crear un nuevo vehículo (400 enum inválido, 403 dueño ajeno, 409 patente duplicada)
export async function createVehicle(payload: CreateVehiclePayload) {
    try {
        const { data } = await api.post<Vehicle>('/vehicles', payload)
        return data
    } catch (error) {
        throw toApiError(error, 'Error al crear el vehículo', WRITE_ERRORS)
    }
}

// Actualizar un vehículo
export async function updateVehicle({ id, formData }: { id: string; formData: UpdateVehiclePayload }) {
    try {
        const { data } = await api.put<Vehicle>(`/vehicles/${id}`, formData)
        return data
    } catch (error) {
        throw toApiError(error, 'Error al actualizar el vehículo', WRITE_ERRORS)
    }
}

// Eliminar un vehículo
export async function deleteVehicle(id: string) {
    try {
        await api.delete(`/vehicles/${id}`)
    } catch (error) {
        throw toApiError(error, 'Error al eliminar el vehículo', {
            403: 'No puedes eliminar este vehículo',
            409: 'El vehículo tiene visitas asociadas y no se puede eliminar; márcalo como inactivo',
        })
    }
}
