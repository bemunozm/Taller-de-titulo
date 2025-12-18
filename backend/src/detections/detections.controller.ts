import { Controller, Post, Body, Get, Query, UseGuards, UseInterceptors, Req, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiParam } from '@nestjs/swagger';
import { DetectionsService } from './detections.service';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { CreateAccessAttemptDto } from './dto/create-access-attempt.dto';
import { RespondPendingDetectionDto } from './dto/respond-pending-detection.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { FilterByUser } from '../common/decorators/filter-by-user.decorator';
import { UserFilterInterceptor } from '../common/interceptors/user-filter.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';

@ApiTags('Detecciones y Control de Acceso')
@Controller('detections')
export class DetectionsController {
  constructor(private readonly plates: DetectionsService) {}

  // ============================================
  // ENDPOINTS PARA WORKER LPR (sin protección de permisos)
  // Estos endpoints son llamados por el sistema de IA Python usando token de servicio
  // ============================================

  @Post('plates')
  @ApiOperation({ 
    summary: 'Crear detección de patente', 
    description: 'Registra una detección de placa proveniente del worker LPR. Este endpoint es usado por el sistema de IA y no requiere permisos de usuario (usa token de servicio).'
  })
  @ApiBody({ type: CreatePlateDetectionDto })
  @ApiResponse({ status: 201, description: 'Detección creada correctamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  createDetection(@Body() dto: CreatePlateDetectionDto) {
    return this.plates.createDetection(dto);
  }

  @Post('plates/attempts')
  @ApiOperation({ 
    summary: 'Registrar intento de acceso', 
    description: 'Guarda la decisión tomada (allow/deny) asociada a una detección previamente registrada. Usado por el sistema de IA con token de servicio.'
  })
  @ApiBody({ type: CreateAccessAttemptDto })
  @ApiResponse({ status: 201, description: 'Intento de acceso registrado correctamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o detección no encontrada' })
  createAttempt(@Body() dto: CreateAccessAttemptDto) {
    return this.plates.createAttempt(dto);
  }

  // ============================================
  // ENDPOINTS PARA FRONTEND (protegidos con permisos)
  // Estos endpoints requieren autenticación y permiso detections.read
  // ============================================

  @Get('plates')
  @FilterByUser('family')
  @UseInterceptors(UserFilterInterceptor)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.read')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.READ,
    description: 'Consulta de detecciones de placas',
    captureResponse: false
  })
  @ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
  @ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
  @ApiOperation({ 
    summary: 'Listar detecciones de patentes', 
    description: 'Admins ven todas las detecciones. Residentes ven solo detecciones de vehículos de su familia. Requiere permiso "detections.read".'
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
          attempts: { type: 'array' }
        }
      }
    }
  })
  listDetections(@Req() request: any) {
    // El interceptor agrega filterFamilyId al request si el usuario no es admin
    const familyId = request.filterFamilyId;
    return this.plates.listDetections({ familyId });
  }

  @Get('plates/attempts')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.read')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.READ,
    description: 'Consulta de intentos de acceso',
    captureResponse: false
  })
  @ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
  @ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
  @ApiOperation({ 
    summary: 'Listar intentos de acceso', 
    description: 'Lista los intentos de acceso registrados por el sistema de IA y las decisiones tomadas (permitir/denegar). Requiere permiso "detections.read".'
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
          detection: { type: 'object' }
        }
      }
    }
  })
  listAttempts() {
    return this.plates.listAttempts();
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
    captureResponse: false
  })
  @ApiOperation({ 
    summary: 'Listar detecciones pendientes de aprobación', 
    description: 'Lista las detecciones de vehículos no reconocidos que requieren aprobación manual del conserje. Requiere permiso "detections.approve".'
  })
  @ApiResponse({ status: 200, description: 'Lista de detecciones pendientes' })
  listPendingDetections() {
    return this.plates.listPendingDetections();
  }

  @Get('pending/:id/status')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'id', description: 'ID de la detección pendiente' })
  @ApiOperation({ 
    summary: 'Verificar estado de detección pendiente', 
    description: 'Verifica si una detección pendiente sigue activa o ya fue procesada/expirada.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Estado de la detección',
    schema: {
      type: 'object',
      properties: {
        active: { type: 'boolean' },
        reason: { type: 'string', nullable: true }
      }
    }
  })
  checkPendingDetectionStatus(@Param('id') id: string) {
    return this.plates.checkPendingDetectionStatus(id);
  }

  @Patch('pending/:id/respond')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('detections.approve')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.DETECTIONS,
    action: AuditAction.UPDATE,
    description: 'Respuesta a detección pendiente',
    captureResponse: true
  })
  @ApiParam({ name: 'id', description: 'ID de la detección pendiente' })
  @ApiBody({ type: RespondPendingDetectionDto })
  @ApiOperation({ 
    summary: 'Responder a detección pendiente', 
    description: 'Permite al conserje aprobar o rechazar una detección de vehículo no reconocido. Requiere permiso "detections.approve".'
  })
  @ApiResponse({ status: 200, description: 'Respuesta registrada exitosamente' })
  @ApiResponse({ status: 404, description: 'Detección pendiente no encontrada' })
  @ApiResponse({ status: 400, description: 'Detección ya procesada o expirada' })
  respondToPendingDetection(
    @Param('id') id: string,
    @Req() req: any,
    @Body() dto: RespondPendingDetectionDto,
  ) {
    return this.plates.respondToPendingDetection(id, req.user.id, dto);
  }
}
