import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { WorkerNotifierService } from './worker-notifier.service';
import { AuthGuard } from '../auth/auth.guard';
import {
  ServiceApiKeyGuard,
  requireServiceKeyOrganizationId,
} from '../auth/guards/service-api-key.guard';
import type { ServiceKeyRequest } from '../auth/guards/service-api-key.guard';
import { CamerasService } from '../cameras/cameras.service';
import { CurrentTenant } from '../common/tenant/tenant-actor';
import type { TenantContext } from '../common/tenant/tenant-context.types';

/** Cámara tal como la ve el manager LPR: sin URL cifrada, roles ni zonas. */
export interface WorkerCameraView {
  id: string;
  name: string;
  mountPath: string | null;
  enableLpr: boolean;
  enableGuardian: boolean;
}

/** Un worker en el `GET /health` del manager LPR (`lpr/api/manager.py`). */
interface ManagerWorkerHealth {
  cameraId: string;
  alive?: boolean;
  [field: string]: unknown;
}

/** `details` de un health exitoso del manager: `{ ok, running_workers, workers }`. */
interface ManagerHealthDetails {
  workers: ManagerWorkerHealth[];
  [field: string]: unknown;
}

function isManagerHealthDetails(value: unknown): value is ManagerHealthDetails {
  return (
    typeof value === 'object' &&
    value !== null &&
    'workers' in value &&
    Array.isArray(value.workers) &&
    value.workers.every(
      (worker: unknown) =>
        typeof worker === 'object' &&
        worker !== null &&
        'cameraId' in worker &&
        typeof worker.cameraId === 'string',
    )
  );
}

/** Id de la cámara de un worker (el Guardián usa `<id>_guardia`). */
function workerCameraId(worker: ManagerWorkerHealth): string {
  return worker.cameraId.replace('_guardia', '');
}

/** Respuesta de `WorkerNotifierService.getHealth` (el `details` viene del manager). */
interface WorkerHealthResponse {
  ok?: boolean;
  status?: string | number;
  details?: unknown;
  message?: string;
}

@ApiTags('Workers')
@Controller('workers')
export class WorkersController {
  constructor(
    private readonly workerNotifier: WorkerNotifierService,
    private readonly camerasService: CamerasService,
  ) {}

  /**
   * Cámaras del condominio de la service API key (manager LPR, arranque).
   * Fail-closed: sin condominio de la key (`requireServiceKeyOrganizationId`) responde 403.
   */
  @Get('cameras')
  @UseGuards(ServiceApiKeyGuard)
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'Cámaras del condominio de la API key de servicio',
    description:
      'Para el manager LPR. Requiere header x-api-key con una key de servicio emitida para un condominio.',
  })
  @ApiResponse({ status: 200, description: 'Cámaras del condominio de la key' })
  @ApiUnauthorizedResponse({
    description: 'API key ausente, inválida o expirada',
  })
  @ApiForbiddenResponse({
    description:
      'La API key no está vinculada a un condominio o su dueño ya no es miembro',
  })
  async listCameras(
    @Req() req: ServiceKeyRequest,
  ): Promise<WorkerCameraView[]> {
    const organizationId = requireServiceKeyOrganizationId(req);
    const cameras =
      await this.camerasService.findAllByOrganization(organizationId);
    return cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      mountPath: camera.mountPath ?? null,
      enableLpr: camera.enableLpr,
      enableGuardian: camera.enableGuardian,
    }));
  }

  /** URL de origen (RTSP descifrada) de una cámara DEL CONDOMINIO de la key. */
  @Get('cameras/:id/source')
  @UseGuards(ServiceApiKeyGuard)
  @ApiSecurity('x-api-key')
  @ApiOperation({
    summary: 'URL de origen de una cámara del condominio de la API key',
    description:
      'Para el manager LPR. Una cámara de otro condominio responde 404.',
  })
  @ApiResponse({ status: 200, description: 'URL de origen desencriptada' })
  @ApiUnauthorizedResponse({
    description: 'API key ausente, inválida o expirada',
  })
  @ApiForbiddenResponse({
    description: 'La API key no tiene organización asociada',
  })
  @ApiNotFoundResponse({
    description: 'Cámara inexistente o de otro condominio',
  })
  async getCameraSource(
    @Req() req: ServiceKeyRequest,
    @Param('id') id: string,
  ): Promise<{ sourceUrl: string | null }> {
    const organizationId = requireServiceKeyOrganizationId(req);
    const sourceUrl =
      await this.camerasService.getDecryptedSourceUrlForOrganization(
        id,
        organizationId,
      );
    return { sourceUrl };
  }

  /**
   * Tarea #21 (docs/modulos/auth-multitenant.md §11+, hardening de ingesta
   * LPR): el audit original agrupó este endpoint junto a los de ingesta
   * (POST plates/attempts, POST/GET anomalies) porque hoy tampoco tiene
   * guard. A DIFERENCIA de esos, este endpoint NO lo llama el worker LPR —
   * lo consume el FRONTEND (CamerasPanel.tsx vía CameraAPI.getIAHealth) con
   * sesión de usuario humano (JWT/cookie), para mostrar el estado del worker
   * IA en el panel de cámaras. Protegerlo con ServiceApiKeyGuard rompería esa
   * pantalla (el frontend no manda x-api-key). Se protege en su lugar con
   * `AuthGuard` (sesión de better-auth, como el resto de la API autenticada) —
   * cierra el acceso anónimo sin requerir un permiso específico (ningún rol
   * salvo "Desarrollador" tiene hoy `workers.read`, y ese permiso no está
   * cableado a este endpoint — ver default-roles.constant.ts).
   */
  @Get('ia-health')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Estado del worker IA',
    description:
      'Requiere sesión de usuario autenticado. Los workers se acotan a las cámaras del condominio del usuario (super-admin: todos; sin condominio: ninguno).',
  })
  @ApiResponse({ status: 200, description: 'Estado del worker IA' })
  @ApiUnauthorizedResponse({
    description: 'Sesión/token inválido, expirado o ausente',
  })
  async getIaHealth(@CurrentTenant() tenant: TenantContext) {
    const res: WorkerHealthResponse = await this.workerNotifier.getHealth();
    // Normalizamos la respuesta para el frontend
    return {
      ok: !!res.ok,
      status: res.status,
      details: await this.scopeHealthDetails(res.details ?? null, tenant),
      message: res.message ?? null,
    };
  }

  /**
   * Corrección P5 (cyber B4): el manager LPR reporta los workers de TODOS los
   * condominios. Para quien no es super-admin solo quedan los de las cámaras
   * de su condominio (sin condominio: ninguno), y `running_workers` se
   * recalcula sobre esos. Un `details` con otra forma (el payload de error
   * del manager) se devuelve solo al super-admin.
   */
  private async scopeHealthDetails(
    details: unknown,
    tenant: TenantContext,
  ): Promise<unknown> {
    if (tenant.isSuperAdmin) {
      return details;
    }
    if (!isManagerHealthDetails(details)) {
      return null;
    }
    const ownCameraIds = new Set(
      tenant.organizationId
        ? await this.camerasService.findIdsByOrganization(tenant.organizationId)
        : [],
    );
    const workers = details.workers.filter((worker) =>
      ownCameraIds.has(workerCameraId(worker)),
    );
    return {
      ...details,
      workers,
      running_workers: workers.filter((worker) => worker.alive === true).length,
    };
  }
}
