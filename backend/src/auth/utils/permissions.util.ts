/**
 * Fase 1, Bloque A2a (docs/modulos/agente-cerebro.md §5/§10.2): extraído de
 * `AuthorizationGuard.canActivate` para centralizar en un solo lugar "qué
 * permisos tiene un usuario" (`getUserPermissionNames`) y "tiene alguno de
 * los requeridos" (`hasAnyPermission`) para las rutas HTTP protegidas por
 * `@RequirePermissions`/`AuthorizationGuard`.
 *
 * IMPORTANTE (revisión de calidad, corrige el docstring original): el
 * catálogo de tools del agente-cerebro (`ToolDispatcherService`, ver
 * tool-dispatcher.service.ts) NO llama a `hasAnyPermission` — implementa su
 * propio `hasRequiredScopes` privado, con una semántica de "vacío"
 * deliberadamente distinta (`requiredScopes: []` ejecuta; ver el docstring de
 * `hasAnyPermission` más abajo para el porqué). Son dos funciones separadas a
 * propósito, no una duplicación pendiente de unificar.
 */

/** Forma mínima que necesitamos de `User` (con `roles.permissions` poblado). */
export interface UserWithPermissions {
  roles?: Array<{
    name?: string;
    permissions?: Array<{ name: string }>;
  }>;
}

/**
 * Aplana los permisos de todos los roles de un usuario en una lista de
 * nombres (`module.action`), sin duplicados no-relevantes (se conserva el
 * comportamiento previo de `AuthorizationGuard`: no deduplica, pero
 * `.includes`/`.some` son insensibles a duplicados).
 */
export function getUserPermissionNames(
  user: UserWithPermissions | null | undefined,
): string[] {
  if (!user?.roles || user.roles.length === 0) {
    return [];
  }

  return user.roles.reduce<string[]>((allPermissions, role) => {
    const rolePermissions = role.permissions?.map((p) => p.name) ?? [];
    return [...allPermissions, ...rolePermissions];
  }, []);
}

/**
 * `true` si `granted` (los permisos que efectivamente tiene el sujeto) cubre
 * al menos uno de `required`.
 *
 * Revisión de calidad (Fase 1, Bloque A2a): con `required` vacío (`[]`) esta
 * función DENIEGA (`false`). Antes de este fix devolvía `true` — una
 * regresión respecto del código ORIGINAL de `AuthorizationGuard`
 * (`requiredPermissions.some(...)`, que sobre `[]` ya daba `false`). Importa
 * porque `requiredPermissions` viene de `SetMetadata(PERMISSIONS_KEY,
 * permissions)` (ver permissions.decorator.ts): un `@RequirePermissions()`
 * sin argumentos produce `[]`, que es un array TRUTHY en JS —
 * `AuthorizationGuard.canActivate` NO lo trata como "sin restricción" (esa
 * rama solo dispara con `undefined`, cuando el decorador directamente no se
 * usó), así que con el bug caía en `hasAnyPermission(userPermissions, [])` y
 * CUALQUIER usuario autenticado pasaba, aunque `@RequirePermissions()`
 * claramente buscaba exigir algo. `undefined` (decorador no aplicado) sigue
 * sin pasar por acá — lo maneja `AuthorizationGuard` antes de llamar a esta
 * función (no hay usos actuales de `@RequirePermissions()` sin argumentos en
 * el código, así que este fix no cambia el comportamiento de ninguna ruta
 * existente — solo cierra el gap para el día en que alguien la use así).
 *
 * Con `required` no vacío, el criterio no cambia: basta con tener alguno de
 * los permisos pedidos ("alguno de los requeridos").
 *
 * IMPORTANTE — semántica DISTINTA a la de
 * `ToolDispatcherService.hasRequiredScopes` (tool-dispatcher.service.ts): ahí
 * un `requiredScopes: []` SÍ debe ejecutar (una tool sin scopes declarados no
 * tiene gate de permisos, cualquier `AuthorizedContext` autenticado puede
 * llamarla) — por eso esa función NO reusa esta ni comparte su semántica de
 * "vacío". Son dos funciones deliberadamente separadas para dos contratos
 * distintos (rutas HTTP vs. catálogo de tools del agente), no una
 * duplicación a corregir.
 */
export function hasAnyPermission(
  granted: string[],
  required: string[] | undefined,
): boolean {
  if (!required || required.length === 0) {
    return false;
  }
  return required.some((permission) => granted.includes(permission));
}
