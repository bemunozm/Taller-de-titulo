import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { usePermissions } from '@/hooks/usePermissions'
import { useAuth } from '@/hooks/useAuth'

interface ProtectedRouteProps {
  children: ReactElement
  /** Permiso requerido para acceder a la ruta */
  permission?: string
  /** Lista de permisos - el usuario debe tener AL MENOS UNO */
  anyPermission?: string[]
  /** Lista de permisos - el usuario debe tener TODOS */
  allPermissions?: string[]
  /** Rol requerido para acceder a la ruta */
  role?: string
  /** Lista de roles - el usuario debe tener AL MENOS UNO */
  anyRole?: string[]
  /** Ruta a redirigir si no tiene permisos (default: '/') */
  redirectTo?: string
}

/**
 * Componente para proteger rutas completas basado en permisos o roles
 * 
 * Ejemplos de uso en router.tsx:
 * 
 * <Route 
 *   path="/users" 
 *   element={
 *     <ProtectedRoute permission="users.read">
 *       <UsersView />
 *     </ProtectedRoute>
 *   } 
 * />
 * 
 * <Route 
 *   path="/admin" 
 *   element={
 *     <ProtectedRoute anyRole={['Administrador', 'Super Administrador']}>
 *       <AdminPanel />
 *     </ProtectedRoute>
 *   } 
 * />
 */
export function ProtectedRoute({
  children,
  permission,
  anyPermission,
  allPermissions,
  role,
  anyRole,
  redirectTo = '/403' // Redirigir a página de acceso prohibido por defecto
}: ProtectedRouteProps) {
  const { isLoading } = useAuth()
  const { hasPermission, hasAnyPermission, hasAllPermissions, hasRole, hasAnyRole } = usePermissions()

  // Mientras carga, no redirigir
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="mt-2 text-sm text-gray-600">Verificando permisos...</p>
        </div>
      </div>
    )
  }

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
    return <Navigate to={redirectTo} replace />
  }

  return children
}
