import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  Patch,
  Query,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AnomaliesService } from './anomalies.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentActor, type TenantActor } from '../common/tenant/tenant-actor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';
import { ListAnomaliesQueryDto } from './dto/list-anomalies-query.dto';
import { UpdateAnomalyStatusDto } from './dto/update-anomaly-status.dto';
import type { AnomalyIngestPayload } from './anomalies.service';
import {
  ServiceApiKeyGuard,
  requireServiceKeyOrganizationId,
} from '../auth/guards/service-api-key.guard';
import type { ServiceKeyRequest } from '../auth/guards/service-api-key.guard';

// Tarea #21 (docs/modulos/auth-multitenant.md §11+): `POST /anomalies` y
// `GET /anomalies/cameras/:id/zones` los consume el worker LPR/Guardián —
// protegidos con la API key de servicio (header x-api-key, ver
// ServiceApiKeyGuard) y acotados al condominio de la key (Fase 4 · P5.B).
//
// Fase 4 · P5.C: `GET /anomalies` pasa a SESIÓN HUMANA. Ningún worker lo
// llama con key (`lpr/` solo hace POST /anomalies y GET .../zones); su único
// consumidor es la UI (`AnomalyTable`), que recibía 401 desde la P2.
@ApiTags('Anomalías')
@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomaliesService: AnomaliesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.read')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Listar anomalías',
    description:
      'Página de anomalías del condominio del usuario (super-admin: de todos), de la más nueva a la más antigua, SIN foto. Filtros opcionales: status, type, cameraId; paginación limit (50 por defecto, máx. 100) y offset. Devuelve { items, total }. Requiere "detections.read"; sin "condominium.view-all" la lista va vacía.',
  })
  @ApiResponse({
    status: 200,
    description: 'Página { items, total } de anomalías',
  })
  @ApiUnauthorizedResponse({ description: 'Sesión inválida o ausente' })
  @ApiForbiddenResponse({
    description:
      'No tiene permiso para ver detecciones (requiere detections.read)',
  })
  async getAnomalies(
    @CurrentActor() actor: TenantActor,
    @Query() query: ListAnomaliesQueryDto,
  ) {
    return await this.anomaliesService.findAllForActor(actor, query);
  }

  // Fase 4 · P6.R (D13): la foto de una anomalía. `security:anomaly_highlight`
  // ya no la lleva; la vista del conserje la pide acá con su sesión.
  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.read')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Obtener una anomalía (con su foto)',
    description:
      'Anomalía del condominio del usuario (super-admin: de cualquiera) con `snapshotJpegB64`. Requiere "detections.read" y "condominium.view-all"; ajena, inexistente o sin "condominium.view-all": 404.',
  })
  @ApiResponse({ status: 200, description: 'Anomalía con su snapshot' })
  @ApiUnauthorizedResponse({ description: 'Sesión inválida o ausente' })
  @ApiForbiddenResponse({
    description:
      'No tiene permiso para ver detecciones (requiere detections.read)',
  })
  @ApiNotFoundResponse({
    description:
      'La anomalía no existe, es de otro condominio o el usuario no ve el condominio completo',
  })
  async getAnomaly(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return await this.anomaliesService.findOneForActor(id, actor);
  }

  // Revisión de la anomalía (open | reviewed | dismissed | false_alarm). Va
  // antes de `@Post` y es PATCH con sufijo `/status`: no choca con `GET :id`.
  @Patch(':id/status')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('anomalies.resolve')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.UPDATE,
    entityType: 'AnomalyEvent',
    description: 'Revisión de una anomalía del Guardián',
    // La nota es texto libre (puede nombrar personas): no se copia a la bitácora.
    captureRequest: false,
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Cambiar el estado de revisión de una anomalía',
    description:
      'Marca la anomalía como revisada, descartada o falsa alarma (o la reabre con "open"). Registra quién y cuándo, y una nota opcional (máx. 500). Requiere "anomalies.resolve" y "condominium.view-all"; ajena, inexistente o sin "condominium.view-all": 404. Devuelve la anomalía sin foto.',
  })
  @ApiResponse({ status: 200, description: 'Anomalía actualizada (sin foto)' })
  @ApiUnauthorizedResponse({ description: 'Sesión inválida o ausente' })
  @ApiForbiddenResponse({
    description: 'No tiene permiso para resolver anomalías (anomalies.resolve)',
  })
  @ApiNotFoundResponse({
    description:
      'La anomalía no existe, es de otro condominio o el usuario no ve el condominio completo',
  })
  async updateAnomalyStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnomalyStatusDto,
    @CurrentActor() actor: TenantActor,
    // El interceptor de auditoría lee `auditNewValue` de la request.
    @Req() req: { auditNewValue?: unknown },
  ) {
    const { anomaly, previousStatus } =
      await this.anomaliesService.updateStatus(id, dto, actor);
    // Solo el cambio de estado: la nota (texto libre) no va a la bitácora.
    req.auditNewValue = { status: anomaly.status, previousStatus };
    return anomaly;
  }

  @Post()
  @UseGuards(ServiceApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar anomalía',
    description:
      'Registra una anomalía detectada por el worker LPR. Requiere API key de servicio (header x-api-key).',
  })
  @ApiResponse({
    status: 201,
    description: 'Anomalía registrada correctamente',
  })
  @ApiUnauthorizedResponse({
    description: 'API key de servicio inválida, expirada o ausente',
  })
  @ApiForbiddenResponse({
    description:
      'La cámara no existe o no pertenece al condominio de la API key (no se registra ni se notifica nada)',
  })
  async handleAnomaly(
    @Req() req: ServiceKeyRequest,
    @Body() payload: AnomalyIngestPayload,
  ) {
    const anomaly = await this.anomaliesService.createAnomaly(
      payload,
      requireServiceKeyOrganizationId(req),
    );
    // El worker solo mira el código HTTP: no se le devuelve la entidad con la
    // foto (80-400 KB en base64).
    return {
      id: anomaly.id,
      aiStatus: anomaly.aiStatus,
      status: anomaly.status,
    };
  }

  // Lo llama el worker Guardián (`lpr/processor/guardian_worker.py`) para
  // descargar los polígonos de intrusión de su cámara: credencial de máquina,
  // no sesión humana (el frontend lee las zonas de `GET /cameras`).
  @Get('cameras/:id/zones')
  @UseGuards(ServiceApiKeyGuard)
  @ApiOperation({
    summary: 'Zonas del Guardián Visual de una cámara',
    description:
      'Requiere API key de servicio (header x-api-key); la cámara debe ser del condominio de la key.',
  })
  @ApiResponse({ status: 200, description: 'Zonas de la cámara' })
  @ApiUnauthorizedResponse({
    description: 'API key de servicio inválida, expirada o ausente',
  })
  @ApiNotFoundResponse({
    description: 'La cámara no existe o es de otro condominio',
  })
  async getCameraZones(@Req() req: ServiceKeyRequest, @Param('id') id: string) {
    return await this.anomaliesService.getCameraZones(
      id,
      requireServiceKeyOrganizationId(req),
    );
  }
}
