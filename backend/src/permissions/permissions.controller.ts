import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Gestión de Permisos')
@Controller('permissions')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @RequirePermissions('permissions.create')
  @ApiOperation({
    summary: 'Crear nuevo permiso',
    description: 'Crea un nuevo permiso en el sistema especificando el módulo y la acción. Requiere permiso "permissions.create".'
  })
  @ApiResponse({
    status: 201,
    description: 'Permiso creado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', example: 'perm-uuid-123' },
        name: { type: 'string', example: 'users.create' },
        description: { type: 'string', example: 'Crear usuarios en el sistema' },
        module: { type: 'string', example: 'users' },
        action: { type: 'string', example: 'create' }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o permiso ya existe',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El permiso ya existe' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @ApiBody({ type: CreatePermissionDto })
  create(@Body() createPermissionDto: CreatePermissionDto) {
    return this.permissionsService.create(createPermissionDto);
  }

  @Get()
  @RequirePermissions('permissions.read')
  @ApiOperation({
    summary: 'Obtener todos los permisos',
    description: 'Retorna la lista completa de permisos disponibles en el sistema. Requiere permiso "permissions.read".'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de permisos obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'users.create' },
          description: { type: 'string', example: 'Crear usuarios en el sistema' },
          module: { type: 'string', example: 'users' },
          action: { type: 'string', example: 'create' },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string', example: 'Administrador' }
              }
            }
          }
        }
      }
    }
  })
  findAll() {
    return this.permissionsService.findAll();
  }

  @Get('by-module')
  @RequirePermissions('permissions.read')
  @ApiOperation({
    summary: 'Obtener permisos agrupados por módulo',
    description: 'Retorna los permisos organizados por módulos del sistema para facilitar la gestión.'
  })
  @ApiResponse({
    status: 200,
    description: 'Permisos agrupados por módulo',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'users.create' },
            description: { type: 'string', example: 'Crear usuarios' },
            action: { type: 'string', example: 'create' }
          }
        }
      },
      example: {
        users: [
          { id: 'perm-1', name: 'users.create', description: 'Crear usuarios', action: 'create' },
          { id: 'perm-2', name: 'users.read', description: 'Ver usuarios', action: 'read' },
          { id: 'perm-3', name: 'users.update', description: 'Actualizar usuarios', action: 'update' },
          { id: 'perm-4', name: 'users.delete', description: 'Eliminar usuarios', action: 'delete' }
        ],
        roles: [
          { id: 'perm-5', name: 'roles.create', description: 'Crear roles', action: 'create' },
          { id: 'perm-6', name: 'roles.read', description: 'Ver roles', action: 'read' }
        ]
      }
    }
  })
  findByModule() {
    return this.permissionsService.findByModule();
  }

  @Get(':id')
  @RequirePermissions('permissions.read')
  @ApiOperation({
    summary: 'Obtener permiso por ID',
    description: 'Retorna la información detallada de un permiso específico incluyendo los roles que lo tienen asignado.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del permiso',
    example: 'perm-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Permiso encontrado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'users.create' },
        description: { type: 'string', example: 'Crear usuarios en el sistema' },
        module: { type: 'string', example: 'users' },
        action: { type: 'string', example: 'create' },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string', example: 'Administrador' },
              description: { type: 'string', example: 'Administrador del sistema' }
            }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Permiso no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Permiso no encontrado' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  findOne(@Param('id') id: string) {
    return this.permissionsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('permissions.update')
  @ApiOperation({
    summary: 'Actualizar permiso',
    description: 'Actualiza la información de un permiso existente (nombre, descripción, módulo, acción).'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del permiso a actualizar',
    example: 'perm-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Permiso actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'users.create' },
        description: { type: 'string', example: 'Crear usuarios en el sistema (actualizado)' },
        module: { type: 'string', example: 'users' },
        action: { type: 'string', example: 'create' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Permiso no encontrado' })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  @ApiBody({ type: UpdatePermissionDto })
  update(@Param('id') id: string, @Body() updatePermissionDto: UpdatePermissionDto) {
    return this.permissionsService.update(id, updatePermissionDto);
  }

  @Delete(':id')
  @RequirePermissions('permissions.delete')
  @ApiOperation({
    summary: 'Eliminar permiso',
    description: 'Elimina un permiso del sistema. No se puede eliminar un permiso que esté asignado a roles activos.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del permiso a eliminar',
    example: 'perm-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Permiso eliminado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Permiso eliminado exitosamente' },
        deleted: { type: 'boolean', example: true }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Permiso no encontrado' })
  @ApiBadRequestResponse({
    description: 'No se puede eliminar: permiso asignado a roles activos',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'No se puede eliminar el permiso porque está asignado a roles activos' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}