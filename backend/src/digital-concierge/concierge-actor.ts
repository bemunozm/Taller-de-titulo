import { UnauthorizedException } from '@nestjs/common';
import type { AuthorizedContext } from '../agent/types/authorized-context.type';
import type { AuthenticatedHub } from '../hub/guards/hub-auth.guard';

/** Permiso de quien gestiona la conserjería (Administrador, Conserje). */
export const CONCIERGE_MANAGE_PERMISSION = 'digital-concierge.manage';

/**
 * Usuario humano (sesión de better-auth) que actúa sobre una sesión del
 * citófono. Sale de `AuthorizedContextFactory.fromRequest` (guards), nunca
 * del body.
 */
export interface HumanConciergeActor {
  kind: 'human';
  userId: string;
  scopes: readonly string[];
  tenantId: string | null;
  isSuperAdmin: boolean;
}

/**
 * Dispositivo autenticado por `HubAuthGuard` (hub físico o kiosko web).
 * `organizationId` es el ACTUAL del hub (se lee de la BD en cada request): un
 * hub que se movió de condominio deja de ser dueño de sus sesiones viejas.
 */
export interface DeviceConciergeActor {
  kind: 'device';
  hubId: string;
  organizationId: string | null;
}

export type ConciergeActor = HumanConciergeActor | DeviceConciergeActor;

/** Actor dispositivo a partir de `request.hub` (`HubAuthGuard`). */
export function toDeviceConciergeActor(
  hub: AuthenticatedHub,
): DeviceConciergeActor {
  return {
    kind: 'device',
    hubId: hub.hubId,
    organizationId: hub.organizationId,
  };
}

/**
 * ¿Puede leer el historial de visitas de una casa (`POST
 * /concierge/context/:houseNumber`)? Fase 4 · P4.B (cyber M4): el hub físico
 * (lo usa vigilia-hub) y los humanos con `digital-concierge.manage`. El
 * kiosko web (navegador público; el frontend no usa la ruta), un residente u
 * otro humano sin `manage`, no.
 */
export function canReadHouseContext(
  ctx: Pick<AuthorizedContext, 'channel' | 'scopes'>,
): boolean {
  switch (ctx.channel) {
    case 'physical-hub':
      return true;
    case 'human':
      return ctx.scopes.includes(CONCIERGE_MANAGE_PERMISSION);
    default:
      return false;
  }
}

/**
 * Actor humano a partir del contexto autorizado. Sin `userId` no hay sesión
 * humana (p. ej. un hub): 401.
 */
export function toHumanConciergeActor(
  ctx: AuthorizedContext,
): HumanConciergeActor {
  if (!ctx.userId) {
    throw new UnauthorizedException('Se requiere una sesión de usuario');
  }
  return {
    kind: 'human',
    userId: ctx.userId,
    scopes: ctx.scopes,
    tenantId: ctx.tenantId,
    isSuperAdmin: ctx.isSuperAdmin,
  };
}
