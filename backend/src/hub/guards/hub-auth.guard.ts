import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { checkPassword } from '../../auth/utils/auth.util';
import { Hub } from '../entities/hub.entity';

/** Metadata del hub autenticado, expuesta en `request.hub` tras pasar el guard. */
export interface AuthenticatedHub {
  hubId: string;
  organizationId: string | null;
}

/**
 * Guard de credenciales de máquina para el HUB físico (Raspberry Pi) — Fase 1,
 * Bloque A1/A1.1 (docs/modulos/agente-cerebro.md §7/§11). Cierra dos gaps:
 *  - A1: el hub ya enviaba `X-Hub-Secret` en sus llamadas HTTP a
 *    `/concierge/*` (vigilia-hub/src/services/websocket-client.service.ts)
 *    pero el backend nunca lo validaba.
 *  - A1.1 (hallazgo H1 de la auditoría de seguridad): el secret validado era
 *    un `HUB_SECRET` COMPARTIDO por TODOS los hubs — la identidad del
 *    condominio viajaba en `X-Hub-Id` pero sin estar atada a un secret
 *    por-hub, así que un hub del condominio A podía mandar el `X-Hub-Id` del
 *    condominio B y suplantarlo. Ahora cada `Hub` tiene su propio
 *    `secretHash` (bcrypt, generado por `HubsService.provision`/
 *    `rotateSecret` — ver su docstring sobre por qué NO se reusó el plugin
 *    `apiKey` de better-auth aquí) — el hubId identifica CUÁL hub, y su
 *    secretHash propio es lo único que puede autenticarlo como tal.
 *
 * Puebla DOS cosas en el request:
 *  - `request.hub`: metadata del hub autenticado (trazabilidad).
 *  - `request.tenantContext`: el MISMO shape que `TenantContext` (ver
 *    common/tenant/tenant-context.types.ts), poblado DIRECTAMENTE. Esto
 *    importa porque `TenantInterceptor` (global, corre DESPUÉS de los guards)
 *    solo llama a `resolveTenantContext(request.user, ...)` si
 *    `request.tenantContext` AÚN no existe (ver su docstring) — al setearlo
 *    acá, el resto del pipeline (`TenantContextService`, `scopeWhere`,
 *    `stampOrganizationId`, ya usados por FamiliesService/UnitsService/etc.)
 *    funciona para sesiones de hub SIN NINGÚN cambio en esos servicios.
 *
 * Un hub sin organización asignada NO se bloquea (mismo criterio permisivo de
 * `stampOrganizationId`: cae en el "cajón nulo"), pero se loguea un warning
 * porque buscar_residente/notificar_residente no encontrarán nada hasta que
 * se asocie el hub a su condominio.
 */
@Injectable()
export class HubAuthGuard implements CanActivate {
  private readonly logger = new Logger(HubAuthGuard.name);

  constructor(
    @InjectRepository(Hub)
    private readonly hubRepository: Repository<Hub>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const providedSecret = this.extractHeader(request, 'x-hub-secret');
    const hubId = this.extractHeader(request, 'x-hub-id');

    if (!providedSecret) {
      throw new UnauthorizedException('Falta el header X-Hub-Secret');
    }
    if (!hubId) {
      throw new UnauthorizedException('Falta el header X-Hub-Id');
    }

    const hub = await this.hubRepository.findOne({ where: { hubId, active: true } });
    if (!hub) {
      this.logger.warn(`Hub desconocido o inactivo intentó autenticarse: ${hubId}`);
      throw new UnauthorizedException('Hub desconocido o inactivo');
    }

    if (!hub.secretHash) {
      this.logger.warn(`Hub ${hubId} no tiene secret propio provisionado — rechazado.`);
      throw new UnauthorizedException('Hub sin secret configurado (falta provisioning)');
    }

    // bcrypt ya compara sobre el hash derivado (no el secret en claro) de
    // forma robusta a timing attacks — no hace falta un timingSafeEqual
    // adicional como en el esquema anterior de secret compartido en texto
    // plano contra `ConfigService`.
    const secretMatches = await checkPassword(providedSecret, hub.secretHash);
    if (!secretMatches) {
      this.logger.warn(`Intento de autenticación con secret inválido para hub: ${hubId}`);
      throw new UnauthorizedException('Hub secret inválido');
    }

    if (!hub.organizationId) {
      this.logger.warn(
        `Hub ${hubId} no tiene organizationId asignado — operará en el "cajón nulo" (sin condominio) hasta que se asocie a una organización.`,
      );
    }

    const authenticatedHub: AuthenticatedHub = { hubId: hub.hubId, organizationId: hub.organizationId };
    request.hub = authenticatedHub;
    request.tenantContext = { organizationId: hub.organizationId, isSuperAdmin: false };

    return true;
  }

  private extractHeader(request: any, name: string): string | undefined {
    const header = request.headers?.[name];
    return typeof header === 'string' && header.length > 0 ? header : undefined;
  }
}
