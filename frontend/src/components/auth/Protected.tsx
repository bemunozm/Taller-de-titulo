import type { ReactNode } from 'react'
import { usePermissions } from '@/hooks/usePermissions'

interface ProtectedProps {
  children: ReactNode
  /** Permiso requerido para ver el contenido */
  permission?: string
  /** Lista de permisos - el usuario debe tener AL MENOS UNO */
  anyPermission?: string[]
  /** Lista de permisos - el usuario debe tener TODOS */
  allPermissions?: string[]
  /** Rol requerido para ver el contenido */
  role?: string
  /** Lista de roles - el usuario debe tener AL MENOS UNO */
  anyRole?: string[]
  /** Contenido a mostrar si no tiene permisos (opcional) */
  fallback?: ReactNode
}

/**
 * Componente para proteger contenido basado en permisos o roles
 * 
 * Ejemplos de uso:
 * 
 * // Proteger por un permiso específico
 * <Protected permission="users.create">
 *   <Button>Crear Usuario</Button>
 * </Protected>
 * 
 * // Proteger por cualquiera de varios permisos
 * <Protected anyPermission={['users.create', 'users.update']}>
 *   <Button>Editar</Button>
 * </Protected>
 * 
 * // Proteger por todos los permisos
 * <Protected allPermissions={['users.read', 'users.update']}>
 *   <EditForm />
 * </Protected>
 * 
 * // Proteger por rol
 * <Protected role="Administrador">
 *   <AdminPanel />
 * </Protected>
 * 
 * // Con fallback
 * <Protected permission="users.delete" fallback={<p>No tienes permisos</p>}>
 *   <DeleteButton />
 * </Protected>
 */
export function Protected({
  children,
  permission,
  anyPermission,
  allPermissions,
  role,
  anyRole,
  fallback = null,
}: ProtectedProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions, hasRole, hasAnyRole } = usePermissions()

  let hasAccess = true

  // Verificar permiso único
  if (permission && !hasPermission(permission)) {
    hasAccess = false
  }

  // Verificar cualquier permiso de la lista
  if (anyPermission && !hasAnyPermission(...anyPermission)) {
    hasAccess = false
  }

  // Verificar todos los permisos de la lista
  if (allPermissions && !hasAllPermissions(...allPermissions)) {
    hasAccess = false
  }

  // Verificar rol único
  if (role && !hasRole(role)) {
    hasAccess = false
  }

  // Verificar cualquier rol de la lista
  if (anyRole && !hasAnyRole(...anyRole)) {
    hasAccess = false
  }

  if (!hasAccess) {
    return <>{fallback}</>
  }

  return <>{children}</>
}
