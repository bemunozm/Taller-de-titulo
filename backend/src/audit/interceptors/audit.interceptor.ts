import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../audit.service';
import {
  AUDITABLE_KEY,
  AuditableOptions,
} from '../decorators/auditable.decorator';
import { OrganizationMembershipService } from '../../organization-membership/organization-membership.service';
import type { TenantContext } from '../../common/tenant/tenant-context.types';
import {
  redactQuotedText,
  scrubPiiInText,
} from '../../common/privacy/pii-mask';
import { redactPersonalData } from '../../common/privacy/pii-redaction';

/** Request tal como la usa la auditoría. */
interface AuditedRequest {
  user?: { id?: string };
  params?: { id?: string };
  headers: { 'user-agent'?: string };
  ip?: string;
  connection?: { remoteAddress?: string };
  url: string;
  method: string;
  oldValue?: unknown;
  /**
   * `newValue` acotado que deja el handler (p. ej. `{ status, previousStatus }`)
   * cuando no conviene capturar la respuesta completa. Si está, tiene
   * prioridad sobre `captureResponse`; se sanea igual que cualquier valor.
   */
  auditNewValue?: unknown;
  /** Lo deja `TenantInterceptor` (o un guard de dispositivo) antes del handler. */
  tenantContext?: TenantContext;
}

/** Datos de la request que se repiten en el registro de éxito y de error. */
interface AuditRequestContext {
  config: AuditableOptions;
  request: AuditedRequest;
  userId: string | undefined;
  ip: string | undefined;
  userAgent: string | undefined;
  startTime: number;
}

/** `id` de la entidad devuelta por el handler, si la respuesta lo trae. */
function entityIdOf(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }
  const id = (response as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function errorStatusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 500;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fase 4 · P7.L: entidades de catálogo. En su objeto raíz, `name` es el
 * nombre del rol, permiso, cámara o API key (no de una persona) y se
 * conserva. Ver la decisión sobre `name` en `common/privacy/pii-redaction.ts`.
 *
 * La redacción de secretos (contraseñas, tokens, API keys, `qrCode`, URL de
 * las cámaras; corrección P5, cyber B1) se movió a ese mismo módulo junto con
 * la de datos personales: `redactPersonalData` hace ambas en una pasada.
 */
const CATALOG_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'Role',
  'Permission',
  'Camera',
  'Stream',
  'ApiKey',
]);

function isCatalogEntity(config: AuditableOptions): boolean {
  return CATALOG_ENTITY_TYPES.has(config.entityType ?? '');
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly membershipService: OrganizationMembershipService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const config = this.reflector.get<AuditableOptions>(
      AUDITABLE_KEY,
      context.getHandler(),
    );

    if (!config) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<AuditedRequest>();
    const audit: AuditRequestContext = {
      config,
      request,
      // Sesión humana: `request.user` es el User de la app (AuthGuard). El JWT
      // legacy (con `sub`) se retiró en P2.
      userId: request.user?.id,
      ip: request.ip || request.connection?.remoteAddress,
      userAgent: request.headers['user-agent'],
      startTime: Date.now(),
    };

    return next.handle().pipe(
      tap({
        next: (response: unknown) => {
          const { statusCode } = http.getResponse<{ statusCode: number }>();
          void this.recordSuccess(audit, response, statusCode);
        },
        error: (error: unknown) => {
          void this.recordFailure(audit, error);
        },
      }),
    );
  }

  /** Registra la operación exitosa. Nunca bloquea ni rompe la respuesta. */
  private async recordSuccess(
    audit: AuditRequestContext,
    response: unknown,
    statusCode: number,
  ): Promise<void> {
    const { config, request } = audit;
    try {
      await this.auditService.log({
        module: config.module,
        action: config.action,
        userId: audit.userId,
        organizationId: await this.organizationIdOf(audit),
        entityId: entityIdOf(response) ?? request.params?.id,
        entityType: config.entityType,
        newValue:
          request.auditNewValue !== undefined
            ? this.sanitizeData(request.auditNewValue, config)
            : config.captureResponse
              ? this.sanitizeData(response, config)
              : undefined,
        oldValue: config.captureOldValue
          ? this.sanitizeData(request.oldValue, config)
          : undefined,
        metadata: {
          ip: audit.ip,
          userAgent: audit.userAgent,
          // Fase 4 · P7.L: la URL puede traer una patente o un email.
          endpoint: scrubPiiInText(request.url),
          method: request.method,
          statusCode,
          duration: Date.now() - audit.startTime,
        },
        description: config.description,
      });
    } catch (error) {
      // No bloquear la respuesta si falla el logging
      this.logger.error(
        'Failed to log audit',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Registra la operación fallida. Nunca reemplaza el error original. */
  private async recordFailure(
    audit: AuditRequestContext,
    error: unknown,
  ): Promise<void> {
    const { config, request } = audit;
    try {
      await this.auditService.log({
        module: config.module,
        action: config.action,
        userId: audit.userId,
        organizationId: await this.organizationIdOf(audit),
        entityId: request.params?.id,
        entityType: config.entityType,
        metadata: {
          ip: audit.ip,
          userAgent: audit.userAgent,
          // Fase 4 · P7.L: la URL puede traer una patente o un email.
          endpoint: scrubPiiInText(request.url),
          method: request.method,
          statusCode: errorStatusOf(error),
          duration: Date.now() - audit.startTime,
        },
        // Fase 4 · P7.L: el mensaje de error puede repetir lo que mandó el
        // cliente ("Ya existe un vehículo con patente AB1234"). Corrección
        // P7 (cyber B4): fuera del catálogo, lo citado entre comillas (el
        // nombre de una familia) también se omite.
        description: `${config.description} - FAILED: ${this.failureMessage(error, config)}`,
      });
    } catch (logError) {
      this.logger.error(
        'Failed to log audit error',
        logError instanceof Error ? logError.stack : String(logError),
      );
    }
  }

  /**
   * Condominio del registro (Fase 4 · P5): el del `tenantContext` de la
   * request (se lee al registrar: `TenantInterceptor` ya corrió). Un
   * super-admin no tiene condominio → `null` (lo lee solo él). Sin contexto,
   * la membresía del usuario; sin usuario, `null`.
   */
  private async organizationIdOf(
    audit: AuditRequestContext,
  ): Promise<string | null> {
    const context = audit.request.tenantContext;
    if (context) {
      return context.organizationId;
    }
    if (!audit.userId) {
      return null;
    }
    return this.membershipService.getOrganizationIdForUser(audit.userId);
  }

  /**
   * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): `oldValue` y
   * `newValue` sin secretos NI datos personales: RUT, teléfono, email y
   * patente enmascarados; nombres, imágenes y texto libre omitidos. El `name`
   * de una entidad de catálogo (rol, permiso, cámara) se conserva.
   */
  /**
   * Mensaje del error, recortado (~2 KB) y sin datos personales: en una
   * entidad de catálogo lo citado es el nombre del rol o permiso y se
   * conserva; en las demás se omite (`redactQuotedText`).
   */
  private failureMessage(error: unknown, config: AuditableOptions): string {
    const message = errorMessageOf(error);
    return isCatalogEntity(config)
      ? scrubPiiInText(message)
      : redactQuotedText(message);
  }

  private sanitizeData(data: unknown, config: AuditableOptions): unknown {
    return redactPersonalData(data, {
      catalogRoot: isCatalogEntity(config),
    });
  }
}
