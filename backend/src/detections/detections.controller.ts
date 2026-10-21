import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Param,
  Patch,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
} from '@nestjs/swagger';
import { DetectionsService } from './detections.service';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { CreateAccessAttemptDto } from './dto/create-access-attempt.dto';
import { RespondPendingDetectionDto } from './dto/respond-pending-detection.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import {
  ServiceApiKeyGuard,
  requireServiceKeyOrganizationId,
} from '../auth/guards/service-api-key.guard';
import type { ServiceKeyRequest } from '../auth/guards/service-api-key.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import {
  CurrentActor,
  familyScopeOf,
  type TenantActor,
} from '../common/tenant/tenant-actor';
import { optionalEmbeddedUserFor } from '../users/user-summary';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';

/** Request HTTP de las rutas con sesión humana (AuthGuard puebla `user`). */
interface DetectionsHttpRequest {
  user: { id: string; name: string };
}

/** Máximo de intentos de acceso por consulta de `GET /plates/attempts`. */
const LIST_ATTEMPTS_LIMIT = 50;

/**
 * Fase 4 · P5.B (D12): las rutas de lectura y respuesta con sesión humana se
 * acotan al condominio del actor (`TenantContextService`; super-admin:
 * todo). El contexto se resuelve acá y se pasa al servicio, que no es
 * request-scoped por sí mismo. La ingesta (API key) ya estaba acotada al
 * condominio de la key.
 *
 * Fase 4 · P5.C: las lecturas de detecciones e intentos pasan además el
 * alcance por familia (`familyScopeOf`): sin `condominium.view-all` (el
 * Residente) solo las patentes de los vehículos de su familia. Reemplaza a
 * `@FilterByUser`/`UserFilterInterceptor`.
 */
@ApiTags('Detecciones y Control de Acceso')
@Controller('detections')
export class DetectionsController {
  constructor(
    private readonly plates: DetectionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ============================================
  // ENDPOINTS PARA WORKER LPR (protegidos con API key de servicio)
  // Estos endpoints son llamados por el sistema de IA Python usando la API key
  // de servicio (header x-api-key, ver ServiceApiKeyGuard — tarea #21).
  // ============================================

  @Post('plates')
  @UseGuards(ServiceApiKeyGuard)
  @ApiOperation({
    summary: 'Crear detección de patente',
    description:
      'Registra una detección de placa proveniente del worker LPR. Requiere API key de servicio (header x-api-key).',
  })
  @ApiBody({ type: CreatePlateDetectionDto })
  @ApiResponse({ status: 201, description: 'Detección creada correctamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiUnauthorizedResponse({
    description: 'API key de servicio inválida, expirada o ausente',
  })
  @ApiForbiddenResponse({
    description:
      'La cámara no existe o no pertenece al condominio de la API key (no se registra ni se abre nada)',
  })
  createDetection(
    @Req() req: ServiceKeyRequest,
    @Body() dto: CreatePlateDetectionDto,
  ) {
    return this.plates.createDetection(
      dto,
      requireServiceKeyOrganizationId(req),
    );
  }

  @Post('plates/attempts')
  @UseGuards(ServiceApiKeyGuard)
  @ApiOperation({
    summary: 'Registrar intento de acceso',
    description:
      'Guarda la decisión tomada (allow/deny) asociada a una detección previamente registrada. Requiere API key de servicio (header x-api-key).',
  })
  @ApiBody({ type: CreateAccessAttemptDto })
  @ApiResponse({
    status: 201,
    description: 'Intento de acceso registrado correctamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o detección no encontrada',
  })
  @ApiUnauthorizedResponse({
    description: 'API key de servicio inválida, expirada o ausente',
  })
  @ApiNotFoundResponse({
    description: 'La detección no existe o es de otro condominio',
  })
  createAttempt(
    @Req() req: ServiceKeyRequest,
    @Body() dto: CreateAccessAttemptDto,
  ) {
    return this.plates.createAttempt(dto, requireServiceKeyOrganizationId(req));
  }

  // ============================================
  // ENDPOINTS PARA FRONTEND (protegidos con permisos)
  // Estos endpoints requieren autenticación y permiso detections.read
  // ============================================

  @Get('plates')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.read')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.READ,
    description: 'Consulta de detecciones de placas',
    captureResponse: false,
  })
  @ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
  @ApiForbiddenResponse({
    description: 'No tiene permisos suficientes para esta operación',
  })
  @ApiOperation({
    summary: 'Listar detecciones de patentes',
    description:
      'Con "condominium.view-all" (o super-admin): todas las detecciones del condominio. Sin él: solo las de las patentes de los vehículos de su familia (sin familia: ninguna). Requiere permiso "detections.read".',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de detecciones obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          cameraId: { type: 'string' },
          plate: { type: 'string' },
          det_confidence: { type: 'number' },
          ocr_confidence: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
          attempts: { type: 'array' },
        },
      },
    },
  })
  async listDetections(@CurrentActor() actor: TenantActor) {
    return this.plates.listDetections(
      await this.tenantContext.getContext(),
      familyScopeOf(actor),
    );
  }

  @Get('plates/attempts')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.read')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.READ,
    description: 'Consulta de intentos de acceso',
    captureResponse: false,
  })
  @ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
  @ApiForbiddenResponse({
    description: 'No tiene permisos suficientes para esta operación',
  })
  @ApiOperation({
    summary: 'Listar intentos de acceso',
    description:
      'Lista los intentos de acceso registrados por el sistema de IA y las decisiones tomadas (permitir/denegar). Sin "condominium.view-all": solo los de las patentes de los vehículos de su familia. Requiere permiso "detections.read".',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de intentos de acceso obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          decision: { type: 'string', enum: ['allow', 'deny'] },
          reason: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          detection: { type: 'object' },
        },
      },
    },
  })
  async listAttempts(@CurrentActor() actor: TenantActor) {
    const attempts = await this.plates.listAttempts(
      LIST_ATTEMPTS_LIMIT,
      await this.tenantContext.getContext(),
      familyScopeOf(actor),
    );
    // Corrección P5 (cyber B3): el residente embebido va como `{ id, name }`
    // para quien no ve el detalle de usuarios (sin `users.update`).
    for (const attempt of attempts) {
      attempt.residente = optionalEmbeddedUserFor(attempt.residente, actor);
    }
    return attempts;
  }

  // ============================================
  // ENDPOINTS PARA APROBACIÓN DEL CONSERJE
  // ============================================

  @Get('pending')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.approve')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.READ,
    description: 'Consulta de detecciones pendientes',
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Listar detecciones pendientes de aprobación',
    description:
      'Lista las detecciones de vehículos no reconocidos que requieren aprobación manual del conserje. Requiere permiso "detections.approve".',
  })
  @ApiResponse({ status: 200, description: 'Lista de detecciones pendientes' })
  async listPendingDetections() {
    return this.plates.listPendingDetections(
      await this.tenantContext.getContext(),
    );
  }

  // Fase 4 · P5.B: antes solo `AuthGuard` (cualquier usuario consultaba
  // cualquier intento). Ahora permiso y condominio del actor.
  @Get('pending/:id/status')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.check-status', 'detections.approve')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'id', description: 'ID de la detección pendiente' })
  @ApiOperation({
    summary: 'Verificar estado de detección pendiente',
    description:
      'Verifica si una detección pendiente del condominio del usuario sigue activa o ya fue procesada/expirada. Requiere permiso "detections.check-status" o "detections.approve".',
  })
  @ApiResponse({
    status: 200,
    description: 'Estado de la detección',
    schema: {
      type: 'object',
      properties: {
        active: { type: 'boolean' },
        reason: { type: 'string', nullable: true },
      },
    },
  })
  async checkPendingDetectionStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.plates.checkPendingDetectionStatus(
      id,
      await this.tenantContext.getContext(),
    );
  }

  @Patch('pending/:id/respond')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.approve')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.UPDATE,
    description: 'Respuesta a detección pendiente',
    captureResponse: true,
  })
  @ApiParam({ name: 'id', description: 'ID de la detección pendiente' })
  @ApiBody({ type: RespondPendingDetectionDto })
  @ApiOperation({
    summary: 'Responder a detección pendiente',
    description:
      'Permite al conserje aprobar o rechazar una detección de vehículo no reconocido. Requiere permiso "detections.approve".',
  })
  @ApiResponse({
    status: 200,
    description: 'Respuesta registrada exitosamente',
  })
  @ApiResponse({
    status: 404,
    description: 'Detección pendiente no encontrada (o de otro condominio)',
  })
  @ApiResponse({ status: 400, description: 'Detección expirada' })
  @ApiResponse({
    status: 409,
    description: 'Detección ya respondida (otra respuesta ganó el claim)',
  })
  async respondToPendingDetection(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: DetectionsHttpRequest,
    @Body() dto: RespondPendingDetectionDto,
  ) {
    return this.plates.respondToPendingDetection(
      id,
      { id: req.user.id, name: req.user.name },
      dto,
      await this.tenantContext.getContext(),
    );
  }
}
