import { Controller, Get, Query, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuditService, type AuditReader } from './audit.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { TenantContext } from '../common/tenant/tenant-context.types';

/** Request con el `tenantContext` que deja `TenantInterceptor` (global). */
type AuditRequest = Request & { tenantContext?: TenantContext };

/**
 * Quién lee (Fase 4 · P5): super-admin, todo; el resto, solo su condominio
 * (ver `AuditReader`). Sin `tenantContext` resuelto: ni super-admin ni
 * condominio, así que no lee nada (fail-closed).
 */
export function auditReaderOf(req: AuditRequest): AuditReader {
  return {
    isSuperAdmin: req.tenantContext?.isSuperAdmin === true,
    organizationId: req.tenantContext?.organizationId ?? null,
  };
}

@Controller('audit')
@UseGuards(AuthGuard, AuthorizationGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  findAll(@Query() query: QueryAuditLogsDto, @Req() req: AuditRequest) {
    return this.auditService.findAll(query, auditReaderOf(req));
  }

  @Get('stats')
  @RequirePermissions('audit.read')
  getStats(
    @Req() req: AuditRequest,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.auditService.getStats(auditReaderOf(req), start, end);
  }

  @Get('entity/:entityType/:entityId')
  @RequirePermissions('audit.read')
  getEntityHistory(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Req() req: AuditRequest,
  ) {
    return this.auditService.getEntityHistory(
      entityType,
      entityId,
      auditReaderOf(req),
    );
  }

  @Get(':id')
  @RequirePermissions('audit.read')
  findOne(@Param('id') id: string, @Req() req: AuditRequest) {
    return this.auditService.findOne(id, auditReaderOf(req));
  }
}
