import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { MediamtxService } from './mediamtx.service';

/** Request con el `tenantContext` que deja `TenantInterceptor` (global). */
type MediamtxRequest = Request & { tenantContext?: TenantContext };

/** Salud de MediaMTX para cualquier usuario con `cameras.read`. */
export interface MediamtxHealthResponse {
  ok: boolean;
  status: 'running' | 'unavailable';
  version: string | null;
  /** Solo si no está disponible: texto genérico, sin direcciones internas. */
  message?: string;
}

/** Detalle adicional que solo ve el super-admin. */
export interface MediamtxHealthAdminResponse extends MediamtxHealthResponse {
  started: string | null;
  uptimeSeconds: number | null;
  /** Respuesta de `/v3/info` tal cual. */
  details: unknown;
}

/** `started` como ISO y segundos de uptime, si la fecha es válida. */
function uptimeOf(started: string | null): {
  started: string | null;
  uptimeSeconds: number | null;
} {
  if (!started) {
    return { started: null, uptimeSeconds: null };
  }
  const parsed = Date.parse(started);
  if (Number.isNaN(parsed)) {
    return { started, uptimeSeconds: null };
  }
  return {
    started: new Date(parsed).toISOString(),
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - parsed) / 1000)),
  };
}

/**
 * Fase 4 · P6.M (D14): `GET /mediamtx/health` era público y devolvía el
 * `/v3/info` crudo. Ahora exige sesión humana con `cameras.read` (lo usa el
 * panel de cámaras) y responde solo `ok`, `status`, `version` y, si está
 * caído, un mensaje genérico. El detalle (`started`, uptime y la respuesta
 * cruda) queda para el super-admin.
 */
@ApiTags('MediaMTX')
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Sin sesión' })
@ApiForbiddenResponse({ description: 'Requiere el permiso cameras.read' })
@UseGuards(AuthGuard, AuthorizationGuard)
@Controller('mediamtx')
export class MediamtxController {
  constructor(private readonly mediamtxService: MediamtxService) {}

  @Get('health')
  @RequirePermissions('cameras.read')
  @ApiOperation({
    summary: 'Estado de MediaMTX',
    description:
      'Devuelve ok, status y version. El detalle de /v3/info solo se incluye para el super-admin.',
  })
  async getHealth(
    @Req() req: MediamtxRequest,
  ): Promise<MediamtxHealthResponse | MediamtxHealthAdminResponse> {
    const health = await this.mediamtxService.getHealth();

    if (!health.ok) {
      return {
        ok: false,
        status: health.status,
        version: null,
        message: health.message,
      };
    }

    const base: MediamtxHealthResponse = {
      ok: true,
      status: health.status,
      version: health.details.version,
    };
    if (req.tenantContext?.isSuperAdmin !== true) {
      return base;
    }
    return {
      ...base,
      ...uptimeOf(health.details.started),
      details: health.details.raw,
    };
  }
}
