import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { IncomingHttpHeaders } from 'http';
import { Repository } from 'typeorm';
import type { TenantContext } from '../../common/tenant/tenant-context.types';
import { Hub, HubType } from '../entities/hub.entity';
import {
  HUB_AUTH_THROTTLED_MESSAGE,
  HubAuthFailureLimiter,
} from '../hub-auth-failure-limiter';
import { HubCredentialCache } from '../hub-credential-cache';
import {
  HUB_UNAUTHORIZED_MESSAGE,
  isValidHubId,
  verifyHubCredentials,
} from '../hub-credentials';

/**
 * Metadata del hub autenticado, expuesta en `request.hub` tras pasar el guard.
 *
 * Fase 4 · P4 (D6): `type` distingue el hub físico (Raspberry Pi con relés)
 * del kiosko web. No participa en la autenticación; lo consumen las reglas
 * que dependen del canal (p. ej. `GET /concierge/device` y, en P4.B, las
 * tools por canal).
 */
export interface AuthenticatedHub {
  hubId: string;
  type: HubType;
  organizationId: string | null;
}

/** Lo que el guard lee de la request HTTP y lo que deja en ella. */
interface HubAuthRequest {
  headers?: IncomingHttpHeaders;
  ip?: string;
  socket?: { remoteAddress?: string };
  hub?: AuthenticatedHub;
  tenantContext?: TenantContext;
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
 * Un hub sin organización asignada NO se bloquea, pero se loguea un warning:
 * desde la Fase 4 · P5.C un contexto sin condominio no ve ninguna fila
 * (`scopeWhere`/`applyTenantFilter`) ni puede crear recursos
 * (`resolveCreationOrganizationId` → 403), así que buscar_residente/
 * notificar_residente no encontrarán nada hasta que se asocie el hub a su
 * condominio.
 */
@Injectable()
export class HubAuthGuard implements CanActivate {
  private readonly logger = new Logger(HubAuthGuard.name);

  constructor(
    @InjectRepository(Hub)
    private readonly hubRepository: Repository<Hub>,
    private readonly failureLimiter: HubAuthFailureLimiter,
    private readonly credentialCache: HubCredentialCache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HubAuthRequest>();

    const providedSecret = this.extractHeader(request, 'x-hub-secret');
    const hubId = this.extractHeader(request, 'x-hub-id');

    if (!providedSecret) {
      throw new UnauthorizedException('Falta el header X-Hub-Secret');
    }
    if (!hubId) {
      throw new UnauthorizedException('Falta el header X-Hub-Id');
    }

    // Fase 4 · P4.B (cyber B7): formato de `hubId` ANTES de consultar la BD
    // o correr bcrypt. Mismo 401 genérico; el valor no se escribe en el log.
    if (!isValidHubId(hubId)) {
      this.logger.warn(
        'Credencial de hub rechazada: hubId con formato inválido',
      );
      throw new UnauthorizedException(HUB_UNAUTHORIZED_MESSAGE);
    }

    // Fase 4 · P4.B (cyber N1): una credencial ya verificada entra sin bcrypt
    // y sin tocar el limitador (el dispositivo legítimo no queda fuera por una
    // IP bloqueada o una ráfaga). Un secret distinto es un fallo normal.
    const cached = this.credentialCache.lookup(hubId, providedSecret);
    if (cached) {
      this.authenticate(request, cached);
      return true;
    }
    const cacheGeneration = this.credentialCache.generation(hubId);

    // Fase 4 · P4.B (D9, cyber M1/M2): el intento se reserva ANTES del bcrypt
    // (`verifyHubCredentials`). IP bloqueada, demasiadas verificaciones en
    // curso (de la IP o del backend) -> 429 sin gastar CPU, para cualquier
    // `hubId` (no revela cuáles existen).
    const clientIp = request.ip ?? request.socket?.remoteAddress;
    const reservation = this.failureLimiter.tryBegin(clientIp);
    if (!reservation.ok) {
      throw new HttpException(
        HUB_AUTH_THROTTLED_MESSAGE,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const { attempt } = reservation;

    // Fase 4 · P4: mismo 401 (y mismo costo de bcrypt, ver
    // `verifyHubCredentials`) para hub desconocido, inactivo, sin secret o con
    // secret inválido: no se pueden enumerar `hubId`. El motivo va al log.
    let result: Awaited<ReturnType<typeof verifyHubCredentials>>;
    try {
      result = await verifyHubCredentials(
        this.hubRepository,
        hubId,
        providedSecret,
      );
    } catch (error) {
      // Sin veredicto (p. ej. BD caída): no cuenta como fallo del cliente.
      attempt.abort();
      throw error;
    }
    if (!result.ok) {
      attempt.fail();
      this.logger.warn(
        `Credencial de hub rechazada (hubId=${hubId}, motivo=${result.reason})`,
      );
      throw new UnauthorizedException(HUB_UNAUTHORIZED_MESSAGE);
    }
    attempt.succeed();
    const { hub } = result;

    if (!hub.organizationId) {
      this.logger.warn(
        `Hub ${hubId} no tiene organizationId asignado — operará en el "cajón nulo" (sin condominio) hasta que se asocie a una organización.`,
      );
    }

    const authenticatedHub: AuthenticatedHub = {
      hubId: hub.hubId,
      type: hub.type,
      organizationId: hub.organizationId,
    };
    // Si el hub se revocó durante el bcrypt, `store` no guarda nada.
    this.credentialCache.store(
      authenticatedHub,
      providedSecret,
      cacheGeneration,
    );
    this.authenticate(request, authenticatedHub);

    return true;
  }

  /** Deja la identidad del dispositivo y su tenant en la request. */
  private authenticate(request: HubAuthRequest, hub: AuthenticatedHub): void {
    request.hub = {
      hubId: hub.hubId,
      type: hub.type,
      organizationId: hub.organizationId,
    };
    request.tenantContext = {
      organizationId: hub.organizationId,
      isSuperAdmin: false,
    };
  }

  private extractHeader(
    request: HubAuthRequest,
    name: string,
  ): string | undefined {
    const header = request.headers?.[name];
    return typeof header === 'string' && header.length > 0 ? header : undefined;
  }
}
