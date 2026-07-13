/**
 * Multi-tenant (Fase 0, tarea #19 — docs/modulos/auth-multitenant.md §7/§10.4).
 * tenant = condominio = `organization` de better-auth. Ver tenant-context.util.ts
 * para cómo se resuelve y tenant-context.service.ts para cómo se consume.
 */

/**
 * Nombre EXACTO del rol app-side (tabla `role`, RBAC fino) que representa a la
 * plataforma/nosotros — NO al administrador de un condominio ("Administrador",
 * que es un rol acotado a SU organización). Debe calzar con
 * src/common/constants/default-roles.constant.ts. Solo este rol bypassa el
 * scoping por tenant (cross-tenant real); "Administrador" sigue acotado a la
 * organización que resuelva su membresía.
 */
export const PLATFORM_SUPER_ADMIN_ROLE = 'Super Administrador';

export interface TenantContext {
  /**
   * Organización (condominio) del usuario autenticado, resuelta desde su
   * membresía (tabla `member` de better-auth) — NO desde `activeOrganizationId`
   * de la sesión (ver docstring de tenant-context.util.ts para el porqué).
   * `null` si el usuario no pertenece a ninguna organización todavía (cuenta
   * legacy pre-#19, o super-admin sin condominio propio).
   */
  organizationId: string | null;
  /** true solo para el rol PLATFORM_SUPER_ADMIN_ROLE — bypassa todo el scoping. */
  isSuperAdmin: boolean;
}

/** Contexto usado antes de que el AuthGuard poblara `request.user` (rutas @Public / worker). */
export const EMPTY_TENANT_CONTEXT: TenantContext = {
  organizationId: null,
  isSuperAdmin: false,
};

/**
 * Forma mínima que necesitan `DigitalConciergeService.findSessionForTenant` y
 * `PendingActionsService.findForTenant`/`approve`/`reject` para revalidar
 * tenant (limpieza post-auditoría, dedup DUP3 — antes vivía duplicada como
 * interface local en ambos servicios).
 *
 * Usa el vocabulario del agente-cerebro (`tenantId`, NO `organizationId`) a
 * propósito — mismo valor que `TenantContext.organizationId` pero con nombre
 * distinto en este subsistema (ver docstring de
 * `PendingActionsController.resolveTenantScope`, que traduce entre ambos
 * vocabularios en el borde del controller). Cualquier objeto con estos dos
 * campos (incluido un `AuthorizedContext` completo) es asignable acá por
 * tipado estructural.
 */
export interface TenantScope {
  tenantId: string | null;
  isSuperAdmin: boolean;
}
