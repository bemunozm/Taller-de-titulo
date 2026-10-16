import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUserOptions } from '@/api/UserAPI'
import type { UserSummary } from '@/types/index'
import { DELETED_USER_NAME, isAnonymizedUser } from '@/helpers/userDisplay'
import { usePermissions } from './usePermissions'

export const USER_OPTIONS_QUERY_KEY = ['users', 'options'] as const

interface UserOptionsResult {
  /** Usuarios elegibles como anfitrión / propietario (`{ id, name, family }`). */
  options: UserSummary[]
  isLoading: boolean
  isError: boolean
}

/**
 * Opciones de usuario para los selectores de visitas y vehículos.
 *
 * Con `users.read` se piden a `GET /users` (detalle o proyección mínima según
 * el actor). Sin ese permiso (el Residente) `GET /users` respondería 403: no se
 * pide y la única opción es el propio usuario, que es para quien el backend le
 * deja crear visitas y vehículos.
 */
export function useUserOptions(): UserOptionsResult {
  const { hasPermission, user, isLoading: isLoadingAuth } = usePermissions()
  const canListUsers = hasPermission('users.read')

  const query = useQuery({
    queryKey: USER_OPTIONS_QUERY_KEY,
    queryFn: getUserOptions,
    enabled: canListUsers,
  })

  const options = useMemo<UserSummary[]>(() => {
    if (canListUsers) {
      return query.data ?? []
    }
    if (!user) {
      return []
    }
    return [
      {
        id: user.id,
        name: user.name,
        family: user.family ? { id: user.family.id, name: user.family.name } : null,
      },
    ]
  }, [canListUsers, query.data, user])

  return {
    options,
    isLoading: canListUsers ? query.isLoading : isLoadingAuth,
    isError: canListUsers && query.isError,
  }
}

/**
 * Agrega el usuario ya asignado (anfitrión de la visita o dueño del vehículo
 * que se edita) si no está entre las opciones, para que el <select> lo muestre.
 */
export function withAssignedUser(
  options: ReadonlyArray<UserSummary>,
  assigned: UserSummary | null | undefined,
): UserSummary[] {
  if (!assigned || options.some((option) => option.id === assigned.id)) {
    return [...options]
  }
  return [
    ...options,
    { id: assigned.id, name: assigned.name, family: assigned.family ?? null, anonymizedAt: assigned.anonymizedAt },
  ]
}

/**
 * Texto de la opción: nombre y, si la tiene, su familia. Una cuenta
 * anonimizada (p. ej. el anfitrión de una visita antigua) se muestra solo
 * como "Usuario eliminado", sin la familia que la volvería identificable.
 */
export function formatUserOptionLabel(option: UserSummary): string {
  // La proyección `{ id, name }` no trae `anonymizedAt`: ahí basta el nombre que deja el backend.
  if (isAnonymizedUser(option) || option.name === DELETED_USER_NAME) {
    return DELETED_USER_NAME
  }
  return option.family ? `${option.name} · ${option.family.name}` : option.name
}
