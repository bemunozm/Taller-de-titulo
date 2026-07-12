import {
  Controller,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import { PendingActionsService } from './pending-actions.service';

/** `Request` con el `user` que `AuthGuard` ya adjunta (sesión humana JWT/better-auth). */
type AuthenticatedRequest = Request & { user?: { id: string } };

/**
 * Endpoint de aprobación del mecanismo de autonomía (Fase 2, Bloque F2.1 —
 * docs/modulos/agente-cerebro.md §12). Deliberadamente usa `AuthGuard`
 * "plano" (sesión humana), NO `ConciergeAuthGuard`: un hub físico es quien
 * ESCALA una acción (vía `ToolDispatcherService`), pero solo un humano
 * (residente/conserje) puede aprobarla o rechazarla — igual criterio que
 * distingue "quien reporta" de "quien decide" en el resto del sistema.
 *
 * Reusa el permiso `digital-concierge.manage` (ya sembrado en
 * `DEFAULT_PERMISSIONS`, sin usar hasta este bloque) — "aprobar/rechazar una
 * acción del agente" encaja en "gestionar conserjería digital" más que en
 * `digital-concierge.access` (que es el baseline de "puede operar el
 * agente", ver `authorized-context.factory.ts`).
 *
 * Aislamiento de tenant: `TenantContextService` (request-scoped, ya resuelto
 * por `TenantInterceptor` global) arma el `TenantScope` que
 * `PendingActionsService.findForTenant` exige — mismo patrón
 * `findSessionForTenant` que ya usa `DigitalConciergeService`.
 */
@ApiTags('Agente-cerebro — mecanismo de autonomía')
@ApiBearerAuth('JWT-auth')
@Controller('concierge/pending-actions')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
export class PendingActionsController {
  private readonly logger = new Logger(PendingActionsController.name);

  constructor(
    private readonly pendingActionsService: PendingActionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * POST /concierge/pending-actions/:id/approve
   * Aprueba y ejecuta idempotentemente (ver docstring de
   * `PendingActionsService.approve`): una segunda llamada sobre una acción ya
   * `executed` devuelve el mismo `result`, sin re-ejecutar la tool.
   */
  @Post(':id/approve')
  @RequirePermissions('digital-concierge.manage')
  @ApiOperation({
    summary: 'Aprobar una acción del agente pendiente de autorización',
    description:
      'Ejecuta la tool escalada de forma idempotente por acción pendiente. Requiere el permiso "digital-concierge.manage".',
  })
  @ApiParam({ name: 'id', description: 'ID de la PendingAction' })
  @ApiForbiddenResponse({
    description:
      'La acción pendiente no pertenece al condominio del usuario, o falta el permiso requerido',
  })
  @ApiNotFoundResponse({ description: 'Acción pendiente no encontrada' })
  async approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const tenantScope = await this.resolveTenantScope();
    const resolvedByUserId = req.user?.id ?? 'unknown';

    this.logger.log(
      `Aprobando acción pendiente ${id} (resolvedBy=${resolvedByUserId})`,
    );

    const { result, alreadyExecuted } =
      await this.pendingActionsService.approve(
        id,
        tenantScope,
        resolvedByUserId,
      );

    return { approved: true, alreadyExecuted, result };
  }

  /**
   * POST /concierge/pending-actions/:id/reject
   * Rechaza — estado terminal, la tool nunca se ejecuta.
   */
  @Post(':id/reject')
  @RequirePermissions('digital-concierge.manage')
  @ApiOperation({
    summary: 'Rechazar una acción del agente pendiente de autorización',
    description:
      'Marca la acción pendiente como rechazada. Requiere el permiso "digital-concierge.manage".',
  })
  @ApiParam({ name: 'id', description: 'ID de la PendingAction' })
  @ApiForbiddenResponse({
    description:
      'La acción pendiente no pertenece al condominio del usuario, o falta el permiso requerido',
  })
  @ApiNotFoundResponse({ description: 'Acción pendiente no encontrada' })
  async reject(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const tenantScope = await this.resolveTenantScope();
    const resolvedByUserId = req.user?.id ?? 'unknown';

    this.logger.log(
      `Rechazando acción pendiente ${id} (resolvedBy=${resolvedByUserId})`,
    );

    const action = await this.pendingActionsService.reject(
      id,
      tenantScope,
      resolvedByUserId,
    );

    return { rejected: true, status: action.status };
  }

  /**
   * `TenantContext.organizationId` (better-auth/condominio) vs.
   * `TenantScope.tenantId` (mismo vocabulario que `AuthorizedContext` del
   * agente-cerebro, §5 del diseño) son el MISMO valor con nombre distinto en
   * cada subsistema — se traduce acá, en el borde del controller, para no
   * mezclar vocabularios dentro de `PendingActionsService`.
   */
  private async resolveTenantScope(): Promise<{
    tenantId: string | null;
    isSuperAdmin: boolean;
  }> {
    const ctx = await this.tenantContext.getContext();
    return { tenantId: ctx.organizationId, isSuperAdmin: ctx.isSuperAdmin };
  }
}
