import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  getUserPermissionNames,
  type UserWithPermissions,
} from '../auth/utils/permissions.util';
import type { AuthenticatedHub } from '../hub/guards/hub-auth.guard';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { AuthorizedContext } from './types/authorized-context.type';

/**
 * Permiso baseline que trae toda sesión de conserjería digital autenticada
 * por transporte (hub físico o usuario humano) que ya pasó `ConciergeAuthGuard`
 * — Fase 1, Bloque A2a (docs/modulos/agente-cerebro.md §5/§7/§11).
 *
 * DECISIÓN (a confirmar por Benjamin, ver reporte de la tarea): un hub físico
 * NO es un `User` con `roles`/`permissions` en BD (es una credencial de
 * máquina, ver `HubAuthGuard`), así que no hay RBAC fino que leerle. Como
 * `ConciergeAuthGuard` ya certificó que el hub es legítimo y pertenece al
 * condominio (`request.tenantContext.organizationId`), se le concede el
 * mismo permiso que ya existe en `DEFAULT_PERMISSIONS` para representar "el
 * conserje digital puede operar en este condominio":
 * `digital-concierge.access`. Una sesión humana, en cambio, SÍ usa su RBAC
 * real (`getUserPermissionNames`) — si un humano prueba el agente sin ese
 * permiso, se le deniega igual que a cualquier otro endpoint.
 */
const HUB_BASELINE_SCOPES = ['digital-concierge.access'];

/**
 * Forma mínima del `request` que necesita `fromRequest` — exportado para que
 * el controller pueda tipar `@Req()` sin `any` (evita `no-unsafe-argument`).
 */
export interface AuthorizedContextRequest {
  tenantContext?: TenantContext;
  hub?: AuthenticatedHub;
  user?: UserWithPermissions & {
    id: string;
    roles?: Array<{ name: string; permissions?: Array<{ name: string }> }>;
  };
}

/**
 * Arma el `AuthorizedContext` de una request para el agente-cerebro. Se llama
 * UNA vez por turno de conversación, en el controller — nunca dentro de una
 * tool ni a partir de datos del modelo (regla dura #1 del §5).
 *
 * Fuente de cada campo:
 *  - `tenantId`/`isSuperAdmin`: `request.tenantContext` (poblado por
 *    `HubAuthGuard` o por `TenantInterceptor` a partir de la sesión humana —
 *    ver sus docstrings, mismo patrón que el resto de Fase 0).
 *  - `userId`/`role`/`scopes`: `request.hub` (sesión de hub) o `request.user`
 *    (sesión humana) — mutuamente excluyentes, ver `ConciergeAuthGuard`.
 */
@Injectable()
export class AuthorizedContextFactory {
  fromRequest(request: AuthorizedContextRequest): AuthorizedContext {
    const tenantContext = request.tenantContext ?? {
      organizationId: null,
      isSuperAdmin: false,
    };

    if (request.hub) {
      return {
        tenantId: tenantContext.organizationId,
        isSuperAdmin: false,
        userId: undefined,
        role: 'hub',
        scopes: [...HUB_BASELINE_SCOPES],
        requestId: uuidv4(),
      };
    }

    if (request.user) {
      return {
        tenantId: tenantContext.organizationId,
        isSuperAdmin: tenantContext.isSuperAdmin,
        userId: request.user.id,
        role: request.user.roles?.[0]?.name ?? 'user',
        scopes: getUserPermissionNames(request.user),
        requestId: uuidv4(),
      };
    }

    // ConciergeAuthGuard exige uno de los dos transportes — llegar acá sería
    // un bug del guard, no un caso de negocio válido. Se devuelve un
    // contexto sin scopes (deniega todo) en vez de lanzar, para que el
    // dispatcher sea el único punto de decisión de autorización.
    return {
      tenantId: null,
      isSuperAdmin: false,
      userId: undefined,
      role: 'unknown',
      scopes: [],
      requestId: uuidv4(),
    };
  }
}
