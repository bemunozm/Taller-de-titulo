import { Controller, Post, Body, Get, Param, Put, Delete, Query, UseGuards, UseInterceptors, Logger, Req } from '@nestjs/common';
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
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { AuthGuard } from 'src/auth/auth.guard';
import { AuthorizationGuard } from 'src/auth/guards/authorization.guard';
import { RequirePermissions } from 'src/auth/decorators/permissions.decorator';
import { FilterByUser } from '../common/decorators/filter-by-user.decorator';
import { UserFilterInterceptor } from '../common/interceptors/user-filter.interceptor';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';

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
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Registrar nuevo vehículo',
    description: 'Crea un nuevo registro de vehículo en el sistema con su patente, marca, modelo y color.'
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
          familyId: '123e4567-e89b-12d3-a456-426614174000'
        }
      }
    }
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
        createdAt: '2025-11-27T10:00:00.000Z'
      }
    }
  })
  @ApiBadRequestResponse({ description: '❌ Datos inválidos o patente duplicada' })
  @ApiForbiddenResponse({ description: '❌ No tiene permiso para registrar vehículos (requiere vehicles.create)' })
  create(@Body() dto: CreateVehicleDto) {
    this.logger.log(`🚗 Registrando nuevo vehículo con patente: ${dto.plate}`);
    return this.svc.create(dto);
  }

  @Get()
  @FilterByUser('family')
  @UseInterceptors(UserFilterInterceptor)
  @RequirePermissions('vehicles.read')
  @ApiOperation({ 
    summary: 'Listar vehículos',
    description: 'Admins ven todos los vehículos. Residentes ven solo los vehículos de su familia.'
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
          familyId: '123e4567-e89b-12d3-a456-426614174000'
        }
      ]
    }
  })
  @ApiForbiddenResponse({ description: '❌ No tiene permiso para ver vehículos (requiere vehicles.read)' })
  list(@Req() request: any) {
    // El interceptor agrega filterFamilyId al request si el usuario no es admin
    const familyId = request.filterFamilyId;
    this.logger.log(`📋 Listando vehículos con filtros - familyId: ${familyId}`);
    return this.svc.listAll({ familyId });
  }

  @Get('plate/:plate')
  @RequirePermissions('vehicles.read')
  @ApiOperation({ 
    summary: 'Buscar vehículo por patente',
    description: 'Busca un vehículo específico utilizando su número de patente.'
  })
  @ApiParam({ 
    name: 'plate', 
    description: 'Patente del vehículo a buscar',
    example: 'ABC123'
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
        familyId: '123e4567-e89b-12d3-a456-426614174000'
      }
    }
  })
  @ApiNotFoundResponse({ description: '❌ Vehículo no encontrado con esa patente' })
  @ApiForbiddenResponse({ description: '❌ No tiene permiso para ver vehículos (requiere vehicles.read)' })
  findByPlate(@Param('plate') plate: string) {
    this.logger.log(`🔍 Buscando vehículo con patente: ${plate}`);
    return this.svc.findByPlate(plate);
  }

  @Put(':id')
  @RequirePermissions('vehicles.update')
  @Auditable({
    module: AuditModule.VEHICLES,
    action: AuditAction.UPDATE,
    entityType: 'Vehicle',
    description: 'Información de vehículo actualizada',
    captureOldValue: true,
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Actualizar datos de vehículo',
    description: 'Actualiza la información de un vehículo existente (patente, marca, modelo, color).'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'ID del vehículo a actualizar',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @ApiBody({ 
    type: CreateVehicleDto,
    description: 'Datos parciales o completos del vehículo a actualizar',
    examples: {
      ejemplo1: {
        value: {
          color: 'Negro',
          model: 'Corolla 2024'
        }
      }
    }
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
        updatedAt: '2025-11-27T11:00:00.000Z'
      }
    }
  })
  @ApiNotFoundResponse({ description: '❌ Vehículo no encontrado' })
  @ApiBadRequestResponse({ description: '❌ Datos de actualización inválidos' })
  @ApiForbiddenResponse({ description: '❌ No tiene permiso para actualizar vehículos (requiere vehicles.update)' })
  update(@Param('id') id: string, @Body() dto: Partial<CreateVehicleDto>) {
    this.logger.log(`✏️ Actualizando vehículo ID: ${id}`);
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('vehicles.delete')
  @Auditable({
    module: AuditModule.VEHICLES,
    action: AuditAction.DELETE,
    entityType: 'Vehicle',
    description: 'Vehículo eliminado del sistema',
    captureOldValue: true
  })
  @ApiOperation({ 
    summary: 'Eliminar vehículo',
    description: 'Elimina un vehículo del sistema. Puede ser eliminación física o soft delete según configuración.'
  })
  @ApiParam({ 
    name: 'id', 
    description: 'ID del vehículo a eliminar',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @ApiResponse({ 
    status: 200, 
    description: '✅ Vehículo eliminado exitosamente',
    schema: {
      example: {
        message: 'Vehículo eliminado exitosamente',
        id: '123e4567-e89b-12d3-a456-426614174000'
      }
    }
  })
  @ApiNotFoundResponse({ description: '❌ Vehículo no encontrado' })
  @ApiForbiddenResponse({ description: '❌ No tiene permiso para eliminar vehículos (requiere vehicles.delete)' })
  remove(@Param('id') id: string) {
    this.logger.log(`🗑️ Eliminando vehículo ID: ${id}`);
    return this.svc.remove(id);
  }
}
