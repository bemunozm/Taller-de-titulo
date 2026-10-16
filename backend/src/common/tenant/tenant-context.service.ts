import { BadRequestException, Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  organizationExists,
  requireOrganizationId,
  resolveCreationOrganizationId,
  resolveTenantContext,
} from './tenant-context.util';
import { TenantContext } from './tenant-context.types';

/**
 * Punto de acceso reutilizable al TenantContext dentro de un request.
 *
 * REQUEST-scoped a propósito (tarea #19): así cualquier servicio de dominio
 * puede inyectarlo por constructor y leer el tenant del usuario actual sin
 * pasar el `request`/`user` manualmente por cada método. Nest vuelve
 * request-scoped, en cascada, a cualquier provider que lo inyecte — costo
 * aceptado dado el tamaño del sistema (ver docstring de tenant.module.ts).
 *
 * `TenantInterceptor` (global) ya resuelve y cachea el contexto en
 * `request.tenantContext` ANTES de que el controller/servicio lo pida —  este
 * servicio normalmente solo lee ese valor cacheado (sin ir a BD de nuevo). Si
 * por algún motivo el interceptor no corrió (tests unitarios, invocación
 * fuera del ciclo HTTP normal), resuelve on-demand como fallback.
 */
/** Lo que este servicio lee y escribe de la request (user de AuthGuard, contexto cacheado). */
interface TenantRequest {
  user?: { id: string; roles?: Array<{ name: string }> } | null;
  tenantContext?: TenantContext;
}

@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private cached: TenantContext | null = null;

  constructor(
    @Inject(REQUEST) private readonly request: TenantRequest | undefined,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getContext(): Promise<TenantContext> {
    if (this.request?.tenantContext) {
      return this.request.tenantContext;
    }
    if (!this.cached) {
      this.cached = await resolveTenantContext(
        this.request?.user,
        this.dataSource,
      );
      if (this.request) {
        this.request.tenantContext = this.cached;
      }
    }
    return this.cached;
  }

  async isSuperAdmin(): Promise<boolean> {
    return (await this.getContext()).isSuperAdmin;
  }

  async getOrganizationId(): Promise<string | null> {
    return (await this.getContext()).organizationId;
  }

  /** Exige organización concreta (lanza ForbiddenException si no aplica). Ver tenant-context.util.ts. */
  async requireOrganizationId(): Promise<string> {
    return requireOrganizationId(await this.getContext());
  }

  /**
   * Condominio de un recurso NUEVO (Fase 4 · P5.C, creación estricta; ver
   * `resolveCreationOrganizationId`): el del actor, o el `organizationId`
   * explícito del super-admin, que además debe existir (si no, 400).
   */
  async resolveCreationOrganizationId(
    requestedOrganizationId?: string | null,
  ): Promise<string> {
    const ctx = await this.getContext();
    const organizationId = resolveCreationOrganizationId(
      ctx,
      requestedOrganizationId,
    );
    if (
      ctx.isSuperAdmin &&
      !(await organizationExists(organizationId, this.dataSource))
    ) {
      throw new BadRequestException('El condominio indicado no existe');
    }
    return organizationId;
  }
}
