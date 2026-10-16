/**
 * Rol de plataforma. Es el mismo literal que usa el backend
 * (`PLATFORM_SUPER_ADMIN_ROLE`): ahí `isSuperAdmin` también se decide por el
 * nombre del rol del usuario autenticado.
 */
export const SUPER_ADMIN_ROLE_NAME = 'Super Administrador'

interface NamedRole {
  name: string
}

interface UserWithRoles {
  roles?: ReadonlyArray<NamedRole> | null
}

/**
 * `true` si el usuario tiene el rol "Super Administrador". Es la única fuente
 * del frontend para las acciones reservadas al super-admin (roles
 * personalizados, logs del sistema, elegir condominio al crear usuarios).
 */
export function isSuperAdmin(user: UserWithRoles | null | undefined): boolean {
  return user?.roles?.some((role) => role.name === SUPER_ADMIN_ROLE_NAME) ?? false
}

interface IdentifiedRole extends NamedRole {
  id: string
}

/** `true` si entre los `roleIds` elegidos está el rol "Super Administrador". */
export function includesSuperAdminRole(
  roles: ReadonlyArray<IdentifiedRole>,
  roleIds: ReadonlyArray<string>,
): boolean {
  const selected = new Set(roleIds)
  return roles.some((role) => selected.has(role.id) && role.name === SUPER_ADMIN_ROLE_NAME)
}

interface SystemFlaggedRole {
  isSystem?: boolean | null
}

/**
 * Un rol de sistema es inmutable por la API (403): nunca se ofrece editarlo,
 * borrarlo ni cambiarle permisos. Solo el super-admin gestiona los demás.
 */
export function canManageRole(role: SystemFlaggedRole, actorIsSuperAdmin: boolean): boolean {
  return actorIsSuperAdmin && role.isSystem !== true
}

interface AssignableRoleCandidate extends IdentifiedRole {
  permissions?: ReadonlyArray<{ name: string }> | null
}

interface RoleAssignmentActor {
  isSuperAdmin: boolean
  /** Nombres de los permisos del actor (`usePermissions().userPermissions`). */
  permissions: ReadonlyArray<string>
}

/**
 * Espejo de `RoleAssignmentPolicy` del backend: el super-admin asigna todo;
 * cualquier otro actor, nunca "Super Administrador" ni un rol con permisos
 * `platform.*`, y solo roles cuyos permisos son un subconjunto de los suyos.
 * Un rol sin la lista de permisos se ofrece y decide el backend (403).
 */
export function canAssignRole(role: AssignableRoleCandidate, actor: RoleAssignmentActor): boolean {
  if (actor.isSuperAdmin) return true
  if (role.name === SUPER_ADMIN_ROLE_NAME) return false
  if (!role.permissions) return true
  const actorPermissions = new Set(actor.permissions)
  return role.permissions.every(
    (permission) => !permission.name.startsWith('platform.') && actorPermissions.has(permission.name),
  )
}

/** Roles que el actor puede asignar, en el orden recibido. */
export function getAssignableRoles<T extends AssignableRoleCandidate>(
  roles: ReadonlyArray<T>,
  actor: RoleAssignmentActor,
): T[] {
  return roles.filter((role) => canAssignRole(role, actor))
}

/**
 * ¿Puede el actor escribir sobre un usuario (editar, deshabilitar, habilitar,
 * borrar)? El backend exige que los permisos actuales del destino sean un
 * subconjunto de los del actor (403 si no), salvo el super-admin: equivale a
 * que el actor pudiera asignar cada rol actual del destino. `catalog` (p.ej.
 * `GET /roles`) completa los permisos de los roles que llegan sin ellos; si
 * aun así un rol no los trae, la acción se ofrece y decide el backend.
 */
export function canManageUserWithRoles(
  targetRoles: ReadonlyArray<AssignableRoleCandidate> | null | undefined,
  actor: RoleAssignmentActor,
  catalog: ReadonlyArray<AssignableRoleCandidate> = [],
): boolean {
  if (actor.isSuperAdmin) return true
  const byId = new Map(catalog.map((role) => [role.id, role]))
  return (targetRoles ?? []).every((role) => canAssignRole(byId.get(role.id) ?? role, actor))
}
