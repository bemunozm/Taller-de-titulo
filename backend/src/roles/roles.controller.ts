import { Controller, Get, Post, Body, Patch, Param, Delete, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Gestión de Roles')
@Controller('roles')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermissions('roles.create')
  @ApiOperation({
    summary: 'Crear nuevo rol',
    description: 'Crea un nuevo rol en el sistema con los permisos especificados. Requiere permiso "roles.create".'
  })
  @ApiResponse({
    status: 201,
    description: 'Rol creado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', example: 'role-uuid-123' },
        name: { type: 'string', example: 'Administrador' },
        description: { type: 'string', example: 'Administrador del sistema' },
        permissions: { type: 'array', items: { type: 'object' } }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o rol ya existe',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El rol ya existe' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @ApiBody({ type: CreateRoleDto })
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto);
  }

  @Get()
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener todos los roles',
    description: 'Retorna la lista completa de roles del sistema con sus permisos. Requiere permiso "roles.read".'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de roles obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Administrador' },
          description: { type: 'string', example: 'Administrador del sistema' },
          permissions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string', example: 'users.create' },
                description: { type: 'string', example: 'Crear usuarios' },
                module: { type: 'string', example: 'users' },
                action: { type: 'string', example: 'create' }
              }
            }
          }
        }
      }
    }
  })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get('permissions/available')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener permisos disponibles',
    description: 'Retorna todos los permisos disponibles en el sistema para asignar a roles.'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de permisos disponibles',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'users.create' },
          description: { type: 'string', example: 'Crear usuarios' },
          module: { type: 'string', example: 'users' },
          action: { type: 'string', example: 'create' }
        }
      }
    }
  })
  getAvailablePermissions() {
    return this.rolesService.getAllPermissions();
  }

  @Get('permissions/by-module')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener permisos agrupados por módulo',
    description: 'Retorna los permisos organizados por módulos del sistema para facilitar la asignación.'
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
          { id: 'perm-2', name: 'users.read', description: 'Ver usuarios', action: 'read' }
        ],
        roles: [
          { id: 'perm-3', name: 'roles.create', description: 'Crear roles', action: 'create' }
        ]
      }
    }
  })
  getPermissionsByModule() {
    return this.rolesService.getPermissionsByModule();
  }

  @Get(':id')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener rol por ID',
    description: 'Retorna la información detallada de un rol específico incluyendo sus permisos.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol',
    example: 'role-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Rol encontrado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'Administrador' },
        description: { type: 'string', example: 'Administrador del sistema' },
        permissions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string', example: 'users.create' },
              description: { type: 'string', example: 'Crear usuarios' },
              module: { type: 'string', example: 'users' },
              action: { type: 'string', example: 'create' }
            }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Rol no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Rol no encontrado' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(+id);
  }

  @Get(':id/permissions')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener permisos de un rol',
    description: 'Retorna únicamente los permisos asignados a un rol específico.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol',
    example: 'role-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Permisos del rol obtenidos exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'users.create' },
          description: { type: 'string', example: 'Crear usuarios' },
          module: { type: 'string', example: 'users' },
          action: { type: 'string', example: 'create' }
        }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  getRolePermissions(@Param('id') id: string) {
    return this.rolesService.getRolePermissions(+id);
  }

  @Patch(':id')
  @RequirePermissions('roles.update')
  @ApiOperation({
    summary: 'Actualizar rol',
    description: 'Actualiza la información básica de un rol (nombre y descripción). Para actualizar permisos usar el endpoint PUT /:id/permissions.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol a actualizar',
    example: 'role-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Rol actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'Administrador Actualizado' },
        description: { type: 'string', example: 'Nueva descripción del rol' },
        permissions: { type: 'array', items: { type: 'object' } }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  @ApiBody({ type: UpdateRoleDto })
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.rolesService.update(+id, updateRoleDto);
  }

  @Put(':id/permissions')
  @RequirePermissions('roles.update')
  @ApiOperation({
    summary: 'Actualizar permisos de un rol',
    description: 'Reemplaza completamente los permisos asignados a un rol con una nueva lista de permisos.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol',
    example: 'role-uuid-123'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        permissionIds: {
          type: 'array',
          items: { type: 'string', format: 'uuid' },
          example: ['perm-uuid-1', 'perm-uuid-2', 'perm-uuid-3'],
          description: 'Array de IDs de permisos a asignar al rol'
        }
      },
      required: ['permissionIds']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Permisos del rol actualizados exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'Administrador' },
        description: { type: 'string', example: 'Administrador del sistema' },
        permissions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string', example: 'users.create' },
              description: { type: 'string', example: 'Crear usuarios' }
            }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  @ApiBadRequestResponse({ description: 'IDs de permisos inválidos' })
  updateRolePermissions(
    @Param('id') id: string,
    @Body('permissionIds') permissionIds: string[]
  ) {
    return this.rolesService.updateRolePermissions(+id, permissionIds);
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  @ApiOperation({
    summary: 'Eliminar rol',
    description: 'Elimina un rol del sistema. No se puede eliminar un rol que esté asignado a usuarios activos.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol a eliminar',
    example: 'role-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Rol eliminado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Rol eliminado exitosamente' },
        deleted: { type: 'boolean', example: true }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  @ApiBadRequestResponse({
    description: 'No se puede eliminar: rol asignado a usuarios activos',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'No se puede eliminar el rol porque está asignado a usuarios activos' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  remove(@Param('id') id: string) {
    return this.rolesService.remove(+id);
  }
}
