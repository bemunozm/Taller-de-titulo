import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { isActiveMemberOfOrganization } from '../../common/tenant/tenant-context.util';
import { extractServiceKeyOrganizationId } from '../service-api-key.permissions';
import {
  extractServiceApiKey,
  previousServiceApiKeyVerification,
  type ServiceApiKeyVerification,
  type ServiceApiKeyVerificationCarrier,
  type VerifiedServiceApiKey,
  verifyServiceApiKey,
} from '../service-api-key.verification';

/**
 * Identidad de la API key de servicio verificada, expuesta como
 * `request.serviceKey`. `organizationId` sale de los `permissions` de la key
 * (server-only, ver service-api-key.permissions.ts) y el guard ya comprobó que
 * el dueño de la key sigue siendo miembro activo de ese condominio.
 */
export interface ServiceKeyContext {
  keyId: string;
  organizationId: string;
  ownerUserId: string;
}

/**
 * Request con la identidad de la service key (la puebla `ServiceApiKeyGuard`).
 * Puede traer la verificación que ya hizo el parser del body (ver
 * service-api-key.verification.ts).
 */
export interface ServiceKeyRequest extends ServiceApiKeyVerificationCarrier {
  headers?: Record<string, string | string[] | undefined>;
  serviceKey?: ServiceKeyContext;
  serviceApiKey?: unknown;
}

/**
 * Condominio de la service key de la request. Fail-closed: si el handler se
 * alcanzó sin `ServiceApiKeyGuard` (o sin condominio), responde 403 en vez de
 * operar sin tenant.
 */
export function requireServiceKeyOrganizationId(
  request: ServiceKeyRequest,
): string {
  const organizationId = request.serviceKey?.organizationId;
  if (!organizationId) {
    throw new ForbiddenException(
      'La API key de servicio no está vinculada a un condominio',
    );
  }
  return organizationId;
}

/**
 * Guard de credenciales de máquina (worker y manager LPR, sin sesión de
 * usuario humano). Protege:
 *   - POST /api/v1/detections/plates
 *   - POST /api/v1/detections/plates/attempts
 *   - POST /api/v1/anomalies y GET /api/v1/anomalies
 *   - GET  /api/v1/workers/cameras y /api/v1/workers/cameras/:id/source
 *
 * Verifica el header `x-api-key` con `auth.api.verifyApiKey`, exigiendo el
 * permiso `service:lpr` (una key creada desde el cliente, sin `permissions`,
 * no pasa). Fase 4 · P9: en las rutas de ingesta con body grande, el parser
 * del body ya verificó la key (para decidir si acepta 10 MB) y dejó el
 * resultado en la request; el guard lo reutiliza en vez de verificar dos
 * veces (verificar escribe en la fila `apikey`, ver
 * service-api-key.verification.ts). El guard sigue siendo la autoridad: un
 * resultado previo inválido o fallido responde 401 igual. Las keys solo las
 * emite el backend en
 * `POST /api/v1/auth/service-api-keys` (AuthService.createServiceApiKey); los
 * endpoints de cliente `/api/auth/api-key/*` no responden por HTTP (lista
 * blanca de better-auth, ver auth/better-auth-http-allowlist.ts).
 *
 * Después de verificar, revalida el vínculo key↔condominio: el dueño de la key
 * (`referenceId`) debe seguir siendo miembro del condominio de la key y no
 * estar deshabilitado; si no, 403.
 *
 * No puebla `request.user`: deja `request.serviceApiKey` (la key verificada,
 * sin el hash) y `request.serviceKey` (ver `ServiceKeyContext`).
 */
@Injectable()
export class ServiceApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ServiceApiKeyGuard.name);

  constructor(
    private readonly betterAuthService: BetterAuthService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ServiceKeyRequest>();
    const apiKey = extractServiceApiKey(request.headers);

    if (!apiKey) {
      throw new UnauthorizedException(
        'Falta la API key de servicio (header x-api-key)',
      );
    }

    const verification =
      previousServiceApiKeyVerification(request, apiKey) ??
      (await verifyServiceApiKey(this.betterAuthService, apiKey));
    const key = this.acceptedKey(verification);

    const organizationId = extractServiceKeyOrganizationId(key.permissions);
    if (!organizationId) {
      this.logger.warn(`API key de servicio ${key.id} sin condominio`);
      throw new ForbiddenException(
        'La API key de servicio no está vinculada a un condominio',
      );
    }

    const ownerUserId = key.referenceId;
    const isMember =
      typeof ownerUserId === 'string' &&
      ownerUserId.length > 0 &&
      (await isActiveMemberOfOrganization(
        ownerUserId,
        organizationId,
        this.dataSource,
      ));
    if (!isMember) {
      this.logger.warn(
        `API key de servicio ${key.id}: su dueño ya no es miembro activo del condominio`,
      );
      throw new ForbiddenException(
        'La API key de servicio ya no es válida para este condominio',
      );
    }

    request.serviceApiKey = key;
    request.serviceKey = { keyId: key.id, organizationId, ownerUserId };
    return true;
  }

  /** Key aceptada por better-auth; si no, 401 (fail-closed). */
  private acceptedKey(
    verification: ServiceApiKeyVerification,
  ): VerifiedServiceApiKey {
    switch (verification.status) {
      case 'valid':
        return verification.key;
      case 'rejected':
        this.logger.warn(`API key de servicio rechazada: ${verification.code}`);
        throw new UnauthorizedException(
          'API key de servicio inválida o expirada',
        );
      case 'failed':
        this.logger.warn(
          `Error verificando API key de servicio: ${verification.reason}`,
        );
        throw new UnauthorizedException('API key de servicio inválida');
    }
  }
}
