import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  Delete,
  UseGuards,
  Logger,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiBadRequestResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { AuthGuard } from 'src/auth/auth.guard';
import { AuthorizationGuard } from 'src/auth/guards/authorization.guard';
import { RequirePermissions } from 'src/auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';
import {
  CurrentActor,
  familyScopeOf,
  type TenantActor,
} from '../common/tenant/tenant-actor';
import { optionalEmbeddedUserFor } from '../users/user-summary';
import type { Vehicle } from './entities/vehicle.entity';
import { maskPlate } from '../common/privacy/pii-mask';

/**
 * Corrección P5 (cyber B3): el propietario embebido va como `{ id, name }`
 * para quien no ve el detalle de usuarios (sin `users.update`).
 */
function presentVehicle(vehicle: Vehicle, actor: TenantActor): Vehicle {
  vehicle.owner = optionalEmbeddedUserFor(vehicle.owner, actor);
  return vehicle;
}

/**
 * Vehículos. Fase 4 · P5.C (D12): cada ruta pasa el alcance por familia del
 * actor (`familyScopeOf`) al servicio. Sin `condominium.view-all` (el
 * Residente) solo ve y opera los vehículos suyos y de su familia; fuera de
 * alcance → 404. Reemplaza a `@FilterByUser`/`UserFilterInterceptor`.
 */
@ApiTags('Gestión de Vehículos')
@ApiBearerAuth('JWT-auth')
@Controller('vehicles')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
export class VehiclesController {
  private readonly logger = new Logger(VehiclesController.name);

  constructor(private readonly svc: VehiclesService) {}

  @Post()
  @RequirePermissions('vehicles.create')
  @Auditable({
    module: AuditModule.VEHICLES,
    action: AuditAction.CREATE,
    entityType: 'Vehicle',
    description: 'Vehículo registrado en el sistema',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Registrar nuevo vehículo',
    description:
      'Crea un nuevo registro de vehículo en el sistema con su patente, marca, modelo y color.',
  })
  @ApiBody({
    type: CreateVehicleDto,
    description: 'Datos del vehículo a registrar',
    examples: {
      ejemplo1: {
        value: {
          plate: 'ABC123',
          brand: 'Toyota',
          model: 'Corolla',
          color: 'Blanco',
          familyId: '123e4567-e89b-12d3-a456-426614174000',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: '✅ Vehículo registrado exitosamente',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        color: 'Blanco',
        familyId: '123e4567-e89b-12d3-a456-426614174000',
        createdAt: '2025-11-27T10:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      '❌ Datos inválidos (incluye vehicleType/accessLevel fuera del enum)',
  })
  @ApiConflictResponse({
    description: '❌ Ya existe un vehículo con esa patente en el condominio',
  })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para registrar vehículos (requiere vehicles.create)',
  })
  async create(
    @Body() dto: CreateVehicleDto,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(
      `🚗 Registrando nuevo vehículo con patente: ${maskPlate(dto.plate)}`,
    );
    return presentVehicle(
      await this.svc.create(dto, familyScopeOf(actor)),
      actor,
    );
  }

  @Get()
  @RequirePermissions('vehicles.read')
  @ApiOperation({
    summary: 'Listar vehículos',
    description:
      'Con "condominium.view-all" (o super-admin): todos los vehículos del condominio. Sin él: solo los suyos y los de su familia.',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Listado de vehículos obtenido',
    schema: {
      example: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          plate: 'ABC123',
          brand: 'Toyota',
          model: 'Corolla',
          color: 'Blanco',
          familyId: '123e4567-e89b-12d3-a456-426614174000',
        },
      ],
    },
  })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para ver vehículos (requiere vehicles.read)',
  })
  async list(@CurrentActor() actor: TenantActor) {
    const vehicles = await this.svc.listAll(familyScopeOf(actor));
    return vehicles.map((vehicle) => presentVehicle(vehicle, actor));
  }

  @Get('plate/:plate')
  @RequirePermissions('vehicles.read')
  @ApiOperation({
    summary: 'Buscar vehículo por patente',
    description:
      'Busca un vehículo específico utilizando su número de patente.',
  })
  @ApiParam({
    name: 'plate',
    description: 'Patente del vehículo a buscar',
    example: 'ABC123',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Vehículo encontrado',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla',
        color: 'Blanco',
        familyId: '123e4567-e89b-12d3-a456-426614174000',
      },
    },
  })
  @ApiNotFoundResponse({
    description: '❌ Vehículo no encontrado con esa patente',
  })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para ver vehículos (requiere vehicles.read)',
  })
  async findByPlate(
    @Param('plate') plate: string,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`🔍 Buscando vehículo con patente: ${maskPlate(plate)}`);
    // P5.B: acotado al condominio del actor; P5.C: y a su familia si no tiene
    // "condominium.view-all". Fuera de alcance o inexistente → 404.
    return presentVehicle(
      await this.svc.findByPlateForActorOrFail(plate, familyScopeOf(actor)),
      actor,
    );
  }

  @Get(':id')
  @RequirePermissions('vehicles.read')
  @ApiOperation({
    summary: 'Obtener vehículo por ID',
    description:
      'Vehículo del condominio del usuario. Sin "condominium.view-all": solo si es suyo o de su familia. Fuera de alcance o inexistente → 404.',
  })
  @ApiParam({ name: 'id', description: 'ID del vehículo (UUID)' })
  @ApiResponse({ status: 200, description: '✅ Vehículo encontrado' })
  @ApiBadRequestResponse({ description: '❌ El id no es un UUID' })
  @ApiNotFoundResponse({ description: '❌ Vehículo no encontrado' })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para ver vehículos (requiere vehicles.read)',
  })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentVehicle(
      await this.svc.findOneForActorOrFail(id, familyScopeOf(actor)),
      actor,
    );
  }

  @Put(':id')
  @RequirePermissions('vehicles.update')
  @Auditable({
    module: AuditModule.VEHICLES,
    action: AuditAction.UPDATE,
    entityType: 'Vehicle',
    description: 'Información de vehículo actualizada',
    captureOldValue: true,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Actualizar datos de vehículo',
    description:
      'Actualiza la información de un vehículo existente (patente, marca, modelo, color).',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del vehículo a actualizar',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    type: UpdateVehicleDto,
    description: 'Datos parciales o completos del vehículo a actualizar',
    examples: {
      ejemplo1: {
        value: {
          color: 'Negro',
          model: 'Corolla 2024',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '✅ Vehículo actualizado exitosamente',
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        plate: 'ABC123',
        brand: 'Toyota',
        model: 'Corolla 2024',
        color: 'Negro',
        familyId: '123e4567-e89b-12d3-a456-426614174000',
        updatedAt: '2025-11-27T11:00:00.000Z',
      },
    },
  })
  @ApiNotFoundResponse({ description: '❌ Vehículo no encontrado' })
  @ApiBadRequestResponse({ description: '❌ Datos de actualización inválidos' })
  @ApiConflictResponse({
    description: '❌ Ya existe un vehículo con esa patente en el condominio',
  })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para actualizar vehículos (requiere vehicles.update)',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`✏️ Actualizando vehículo ID: ${id}`);
    return presentVehicle(
      await this.svc.update(id, dto, familyScopeOf(actor)),
      actor,
    );
  }

  @Delete(':id')
  @RequirePermissions('vehicles.delete')
  @Auditable({
    module: AuditModule.VEHICLES,
    action: AuditAction.DELETE,
    entityType: 'Vehicle',
    description: 'Vehículo eliminado del sistema',
    captureOldValue: true,
  })
  @ApiOperation({
    summary: 'Eliminar vehículo',
    description:
      'Elimina un vehículo del sistema. Puede ser eliminación física o soft delete según configuración.',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del vehículo a eliminar',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: '✅ Vehículo eliminado exitosamente',
    schema: {
      example: {
        message: 'Vehículo eliminado exitosamente',
        id: '123e4567-e89b-12d3-a456-426614174000',
      },
    },
  })
  @ApiNotFoundResponse({ description: '❌ Vehículo no encontrado' })
  @ApiConflictResponse({
    description: '❌ El vehículo está asociado a una o más visitas',
  })
  @ApiForbiddenResponse({
    description:
      '❌ No tiene permiso para eliminar vehículos (requiere vehicles.delete)',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    this.logger.log(`🗑️ Eliminando vehículo ID: ${id}`);
    return this.svc.remove(id, familyScopeOf(actor));
  }
}
