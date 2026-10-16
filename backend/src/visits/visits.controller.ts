import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { ValidateAccessDto } from './dto/validate-access.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { VisitStatus, VisitType } from './entities/visit.entity';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';
import { CurrentActor, type TenantActor } from '../common/tenant/tenant-actor';

/**
 * Visitas. Fase 4 · P5.C (D12): cada ruta pasa el actor (`@CurrentActor()`)
 * a las variantes `*ForActor` de VisitsService:
 *  - sin `condominium.view-all` (el Residente), solo ve y opera las visitas
 *    de su familia o en las que es el anfitrión (sin familia: solo las
 *    suyas); fuera de alcance → 404. Al crear, el anfitrión debe ser él o
 *    alguien de su familia (403);
 *  - el `qrCode` solo se devuelve al anfitrión o a su familia; para el resto
 *    (incluidos Conserje y Administrador) va `null`. La respuesta de
 *    `POST /visits` sí lo incluye: es para quien la creó.
 * Reemplaza a `@FilterByUser`/`UserFilterInterceptor`.
 */
@ApiTags('Gestión de Visitas')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@Controller('visits')
export class VisitsController {
  private readonly logger = new Logger(VisitsController.name);

  constructor(private readonly visitsService: VisitsService) {}

  @Post()
  @RequirePermissions('visits.create')
  @Auditable({
    module: AuditModule.VISITS,
    action: AuditAction.CREATE,
    entityType: 'Visit',
    description: 'Visita registrada en el sistema',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Crear nueva visita (vehicular o peatonal)',
    description:
      'Registra una nueva visita en el sistema. Para visitas peatonales se genera automáticamente un código QR para validación de acceso.',
  })
  @ApiBody({
    type: CreateVisitDto,
    description: 'Datos de la visita a crear',
    examples: {
      peatonal: {
        value: {
          type: 'pedestrian',
          visitorName: 'Juan Pérez',
          visitorRut: '12345678-9',
          hostId: '123e4567-e89b-12d3-a456-426614174000',
          familyId: '123e4567-e89b-12d3-a456-426614174001',
          scheduledDate: '2025-11-27T15:00:00Z',
          purpose: 'Visita social',
        },
      },
      vehicular: {
        value: {
          type: 'vehicular',
          visitorName: 'María García',
          visitorRut: '98765432-1',
          vehiclePlate: 'ABC123',
          hostId: '123e4567-e89b-12d3-a456-426614174000',
          familyId: '123e4567-e89b-12d3-a456-426614174001',
          scheduledDate: '2025-11-27T16:00:00Z',
          purpose: 'Entrega de paquete',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description:
      '✅ Visita creada exitosamente (incluye código QR para visitas peatonales)',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'pedestrian',
        visitorName: 'Juan Pérez',
        visitorRut: '12345678-9',
        qrCode: 'QR-abc123xyz',
        status: 'scheduled',
        scheduledDate: '2025-11-27T15:00:00Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: '❌ Datos inválidos o faltantes' })
  @ApiNotFoundResponse({ description: '❌ Anfitrión o familia no encontrados' })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para crear visitas (requiere visits.create)',
  })
  create(
    @Body() createVisitDto: CreateVisitDto,
    @CurrentActor() actor: TenantActor,
  ) {
    // Fase 4 · P7.L: sin el nombre del visitante.
    this.logger.log(`👤 Creando nueva visita ${createVisitDto.type}`);
    return this.visitsService.createForActor(createVisitDto, actor);
  }

  @Get()
  @RequirePermissions('visits.read')
  @ApiOperation({
    summary: 'Listar visitas',
    description:
      'Con "condominium.view-all" (o super-admin): todas las visitas del condominio. Sin él: las de su familia o en las que es anfitrión. Filtros opcionales por estado, tipo o anfitrión. El qrCode va null si el usuario no es de la familia del anfitrión.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: VisitStatus,
    description:
      'Filtrar por estado (scheduled, in_progress, completed, cancelled)',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: VisitType,
    description: 'Filtrar por tipo (pedestrian, vehicular)',
  })
  @ApiQuery({
    name: 'hostId',
    required: false,
    type: String,
    description: 'Filtrar por ID del anfitrión',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Lista de visitas obtenida',
    schema: {
      example: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          type: 'pedestrian',
          visitorName: 'Juan Pérez',
          status: 'scheduled',
          scheduledDate: '2025-11-27T15:00:00Z',
        },
      ],
    },
  })
  @ApiForbiddenResponse({
    description: '❌ No tiene permiso para ver visitas (requiere visits.read)',
  })
  findAll(
    @CurrentActor() actor: TenantActor,
    @Query('status') status?: VisitStatus,
    @Query('type') type?: VisitType,
    @Query('hostId') hostId?: string,
  ) {
    return this.visitsService.findAllForActor({ status, type, hostId }, actor);
  }

  @Get('active')
  @RequirePermissions('visits.read')
  @ApiOperation({
    summary: 'Listar visitas activas',
    description:
      'Obtiene todas las visitas que están actualmente en curso (estado in_progress).',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Lista de visitas activas obtenida',
    schema: {
      example: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          visitorName: 'Juan Pérez',
          status: 'in_progress',
          checkInTime: '2025-11-27T15:00:00Z',
        },
      ],
    },
  })
  @ApiForbiddenResponse({
    description: '❌ No tiene permiso para ver visitas (requiere visits.read)',
  })
  findActive(@CurrentActor() actor: TenantActor) {
    return this.visitsService.findActiveForActor(actor);
  }

  @Get('pending')
  @RequirePermissions('visits.read')
  @ApiOperation({
    summary: 'Listar visitas pendientes',
    description:
      'Obtiene todas las visitas programadas que aún no han iniciado (estado scheduled).',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Lista de visitas pendientes obtenida',
    schema: {
      example: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          visitorName: 'María García',
          status: 'scheduled',
          scheduledDate: '2025-11-27T16:00:00Z',
        },
      ],
    },
  })
  @ApiForbiddenResponse({
    description: '❌ No tiene permiso para ver visitas (requiere visits.read)',
  })
  findPending(@CurrentActor() actor: TenantActor) {
    return this.visitsService.findPendingForActor(actor);
  }

  @Get('qr/:qrCode')
  @RequirePermissions('visits.read')
  @ApiOperation({
    summary: 'Buscar visita por código QR',
    description:
      'Busca una visita peatonal utilizando su código QR único generado al momento de creación.',
  })
  @ApiParam({
    name: 'qrCode',
    description: 'Código QR de la visita',
    example: 'QR-abc123xyz',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Visita encontrada por código QR',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'pedestrian',
        visitorName: 'Juan Pérez',
        qrCode: 'QR-abc123xyz',
        status: 'scheduled',
      },
    },
  })
  @ApiNotFoundResponse({
    description: '❌ Visita no encontrada con ese código QR',
  })
  @ApiForbiddenResponse({
    description: '❌ No tiene permiso para ver visitas (requiere visits.read)',
  })
  findByQRCode(
    @Param('qrCode') qrCode: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.visitsService.findByQRCodeForActor(qrCode, actor);
  }

  @Get('plate/:plate')
  @RequirePermissions('visits.read')
  @ApiOperation({
    summary: 'Buscar visita por patente vehicular',
    description:
      'Busca una visita vehicular utilizando el número de patente del vehículo.',
  })
  @ApiParam({
    name: 'plate',
    description: 'Patente del vehículo',
    example: 'ABC123',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Visita encontrada por patente',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'vehicular',
        visitorName: 'María García',
        vehiclePlate: 'ABC123',
        status: 'scheduled',
      },
    },
  })
  @ApiNotFoundResponse({
    description: '❌ Visita no encontrada con esa patente',
  })
  @ApiForbiddenResponse({
    description: '❌ No tiene permiso para ver visitas (requiere visits.read)',
  })
  findByPlate(
    @Param('plate') plate: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.visitsService.findByPlateForActor(plate, actor);
  }

  @Post('validate')
  @RequirePermissions('visits.validate-qr')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    module: AuditModule.VISITS,
    action: AuditAction.VISIT_QR_VALIDATE,
    entityType: 'Visit',
    description: 'Acceso de visita validado',
    captureRequest: true,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Validar acceso de visita',
    description:
      'Valida si una visita tiene acceso autorizado mediante código QR (peatonal) o patente (vehicular). Usado por sistemas de control de acceso.',
  })
  @ApiBody({
    type: ValidateAccessDto,
    description: 'Datos para validación de acceso',
    examples: {
      qr: {
        value: { identifier: 'QR-abc123xyz', type: 'qr' },
      },
      patente: {
        value: { identifier: 'ABC123', type: 'plate' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '✅ Validación completada',
    schema: {
      example: {
        valid: true,
        visit: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          visitorName: 'Juan Pérez',
          status: 'scheduled',
        },
        message: 'Acceso autorizado',
      },
    },
  })
  @ApiBadRequestResponse({ description: '❌ Datos de validación inválidos' })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para validar accesos (requiere visits.validate-qr)',
  })
  validateAccess(
    @Body() validateAccessDto: ValidateAccessDto,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`✅ Validando acceso - ${validateAccessDto.type}`);
    return this.visitsService.validateAccessForActor(
      validateAccessDto.identifier,
      validateAccessDto.type,
      actor,
    );
  }

  @Get(':id')
  @RequirePermissions('visits.read')
  @ApiOperation({
    summary: 'Obtener detalle de visita por ID',
    description: 'Obtiene la información completa de una visita específica.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la visita',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Visita encontrada',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'pedestrian',
        visitorName: 'Juan Pérez',
        visitorRut: '12345678-9',
        status: 'scheduled',
        scheduledDate: '2025-11-27T15:00:00Z',
        qrCode: 'QR-abc123xyz',
      },
    },
  })
  @ApiNotFoundResponse({ description: '❌ Visita no encontrada' })
  @ApiForbiddenResponse({
    description: '❌ No tiene permiso para ver visitas (requiere visits.read)',
  })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.visitsService.findOneForActor(id, actor);
  }

  @Patch(':id')
  @RequirePermissions('visits.update')
  @Auditable({
    module: AuditModule.VISITS,
    action: AuditAction.UPDATE,
    entityType: 'Visit',
    description: 'Información de visita actualizada',
    captureOldValue: true,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Actualizar datos de visita',
    description:
      'Actualiza la información de una visita existente (nombre, rut, fecha programada, propósito, etc.).',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la visita a actualizar',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    type: UpdateVisitDto,
    description: 'Datos parciales o completos de la visita a actualizar',
    examples: {
      ejemplo1: {
        value: {
          visitorName: 'Juan Pérez Silva',
          scheduledDate: '2025-11-28T15:00:00Z',
          purpose: 'Reunión de trabajo',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '✅ Visita actualizada exitosamente',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        visitorName: 'Juan Pérez Silva',
        scheduledDate: '2025-11-28T15:00:00Z',
        updatedAt: '2025-11-27T12:00:00Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: '❌ Visita no encontrada' })
  @ApiBadRequestResponse({
    description:
      '❌ Datos de actualización inválidos (p. ej. inicio posterior al fin)',
  })
  @ApiResponse({
    status: 409,
    description:
      '❌ La visita no es editable en su estado (solo programada o lista para reingresar) o cambió durante la edición',
  })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para actualizar visitas (requiere visits.update)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateVisitDto: UpdateVisitDto,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`✏️ Actualizando visita ID: ${id}`);
    return this.visitsService.updateForActor(id, updateVisitDto, actor);
  }

  @Post(':id/check-in')
  @RequirePermissions('visits.check-in')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    module: AuditModule.VISITS,
    action: AuditAction.VISIT_CHECK_IN,
    entityType: 'Visit',
    description: 'Entrada de visita registrada',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Registrar entrada de visita',
    description:
      'Registra el momento en que una visita ingresa al recinto. Cambia el estado a in_progress.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la visita',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Entrada registrada exitosamente',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        visitorName: 'Juan Pérez',
        status: 'in_progress',
        checkInTime: '2025-11-27T15:00:00Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: '❌ Fuera de la ventana de validez o sin usos disponibles',
  })
  @ApiResponse({
    status: 409,
    description:
      '❌ La entrada ya está registrada o el estado no admite check-in (solo programada o lista para reingresar)',
  })
  @ApiNotFoundResponse({ description: '❌ Visita no encontrada' })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para registrar entradas (requiere visits.check-in)',
  })
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`🚪➡️ Registrando entrada de visita ID: ${id}`);
    return this.visitsService.checkInForActor(id, actor);
  }

  @Post(':id/check-out')
  @RequirePermissions('visits.check-out')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    module: AuditModule.VISITS,
    action: AuditAction.VISIT_CHECK_OUT,
    entityType: 'Visit',
    description: 'Salida de visita registrada',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Registrar salida de visita',
    description:
      'Registra el momento en que una visita sale del recinto. Cambia el estado a completed.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la visita',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Salida registrada exitosamente',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        visitorName: 'Juan Pérez',
        status: 'completed',
        checkInTime: '2025-11-27T15:00:00Z',
        checkOutTime: '2025-11-27T17:00:00Z',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      '❌ La visita no está en curso o cambió mientras se registraba la salida',
  })
  @ApiNotFoundResponse({ description: '❌ Visita no encontrada' })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para registrar salidas (requiere visits.check-out)',
  })
  checkOut(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`➡️🚪 Registrando salida de visita ID: ${id}`);
    return this.visitsService.checkOutForActor(id, actor);
  }

  @Post(':id/cancel')
  @RequirePermissions('visits.update')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    module: AuditModule.VISITS,
    action: AuditAction.UPDATE,
    entityType: 'Visit',
    description: 'Visita cancelada',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Cancelar visita programada',
    description:
      'Cancela una visita que aún no ha iniciado. Cambia el estado a cancelled.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la visita a cancelar',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Visita cancelada exitosamente',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        visitorName: 'Juan Pérez',
        status: 'cancelled',
        cancelledAt: '2025-11-27T12:00:00Z',
      },
    },
  })
  @ApiResponse({
    status: 409,
    description:
      '❌ La visita no puede ser cancelada: solo una programada sin usos (no iniciada, completada, expirada, rechazada ni pendiente de aprobación)',
  })
  @ApiNotFoundResponse({ description: '❌ Visita no encontrada' })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para cancelar visitas (requiere visits.update)',
  })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`❌ Cancelando visita ID: ${id}`);
    return this.visitsService.cancelForActor(id, actor);
  }

  @Delete(':id')
  @RequirePermissions('visits.delete')
  @Auditable({
    module: AuditModule.VISITS,
    action: AuditAction.DELETE,
    entityType: 'Visit',
    description: 'Visita eliminada del sistema',
    captureOldValue: true,
  })
  @ApiOperation({
    summary: 'Eliminar visita',
    description:
      'Elimina permanentemente un registro de visita del sistema. Puede ser eliminación física o soft delete según configuración.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID de la visita a eliminar',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Visita eliminada exitosamente',
    schema: {
      example: {
        message: 'Visita eliminada exitosamente',
        id: '123e4567-e89b-12d3-a456-426614174000',
      },
    },
  })
  @ApiNotFoundResponse({ description: '❌ Visita no encontrada' })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para eliminar visitas (requiere visits.delete)',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`🗑️ Eliminando visita ID: ${id}`);
    return this.visitsService.removeForActor(id, actor);
  }
}
