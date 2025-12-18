import { useMemo } from 'react'
import { useAuth } from './useAuth'

/**
 * Hook personalizado para verificar permisos del usuario autenticado
 * 
 * Uso:
 * const { hasPermission, hasAnyPermission, hasAllPermissions, userPermissions } = usePermissions()
 * 
 * if (hasPermission('users.create')) {
 *   // Mostrar botón de crear usuario
 * }
 */
export const usePermissions = () => {
  const { data: user, isLoading } = useAuth()

  // Extraer todos los permisos del usuario de sus roles
  const userPermissions = useMemo(() => {
    if (!user?.roles) return []
    
    const permissions = new Set<string>()
    
    user.roles.forEach(role => {
      role.permissions?.forEach(permission => {
        permissions.add(permission.name)
      })
    })
    
    return Array.from(permissions)
  }, [user?.roles])

  /**
   * Verifica si el usuario tiene un permiso específico
   */
  const hasPermission = (permission: string): boolean => {
    return userPermissions.includes(permission)
  }

  /**
   * Verifica si el usuario tiene AL MENOS UNO de los permisos especificados
   */
  const hasAnyPermission = (...permissions: string[]): boolean => {
    return permissions.some(permission => userPermissions.includes(permission))
  }

  /**
   * Verifica si el usuario tiene TODOS los permisos especificados
   */
  const hasAllPermissions = (...permissions: string[]): boolean => {
    return permissions.every(permission => userPermissions.includes(permission))
  }

  /**
   * Verifica si el usuario tiene un rol específico
   */
  const hasRole = (roleName: string): boolean => {
    return user?.roles?.some(role => role.name === roleName) ?? false
  }

  /**
   * Verifica si el usuario tiene AL MENOS UNO de los roles especificados
   */
  const hasAnyRole = (...roleNames: string[]): boolean => {
    return roleNames.some(roleName => hasRole(roleName))
  }

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,
    userPermissions,
    user,
    isLoading,
  }
}
