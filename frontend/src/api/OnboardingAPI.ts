import api from '@/lib/axios'
import { toApiError } from '@/helpers/httpErrors'
import type { CondominiumOption } from '@/types/index'

/**
 * Listado de condominios para el selector del super-admin (P5.C). La ruta la
 * confirma el backend; si cambia, se ajusta solo aquí.
 */
export const CONDOMINIUMS_ENDPOINT = '/onboarding/condominiums'

function isCondominiumOption(value: unknown): value is CondominiumOption {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { id, name, slug } = value as Record<string, unknown>
  return typeof id === 'string' && typeof name === 'string' && typeof slug === 'string'
}

/** Condominios de la plataforma (`{ id, name, slug }[]`), solo para el super-admin. */
export async function listCondominiums(): Promise<CondominiumOption[]> {
  try {
    const { data } = await api.get<unknown>(CONDOMINIUMS_ENDPOINT)
    return Array.isArray(data) ? data.filter(isCondominiumOption) : []
  } catch (error) {
    throw toApiError(error, 'Error al obtener los condominios', {
      403: 'Solo el Super Administrador puede listar los condominios',
    })
  }
}
