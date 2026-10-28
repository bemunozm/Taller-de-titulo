import type { Visit } from './entities/visit.entity';

/** Lo mínimo que se necesita de `UsersService` para verificar al anfitrión. */
export interface ActiveMemberChecker {
  isActiveMemberOfOrganization(
    userId: string,
    organizationId: string,
  ): Promise<boolean>;
}

/**
 * `validateAccess` valida el estado y la ventana de la visita, pero NO que su
 * anfitrión siga activo (solo se validó al crearla). Una visita cuyo anfitrión
 * fue deshabilitado (el join lo excluye: `visit.host` null) o dejó el
 * condominio no abre sola. Criterio compartido por el LPR
 * (`DetectionsService`) y el canje de QR del kiosko (`KioskQrService`).
 */
export async function hasActiveVisitHost(
  visit: Visit,
  organizationId: string,
  users: ActiveMemberChecker,
): Promise<boolean> {
  const hostId = visit.host?.id ?? null;
  if (!hostId) {
    return false;
  }
  return users.isActiveMemberOfOrganization(hostId, organizationId);
}
