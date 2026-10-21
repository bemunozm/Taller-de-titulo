import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiParam,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { CurrentTenant } from '../common/tenant/tenant-actor';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';

/**
 * Roles (Fase 4 · P5, D10): crear, editar, borrar y cambiar permisos es solo
 * del super-admin (chequeo explícito en RolesService, 403) y los roles de
 * sistema son inmutables (403). La lectura sigue con `roles.read`.
 */
@ApiTags('Gestión de Roles')
@Controller('roles')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({
  description: 'No tiene permisos suficientes para esta operación',
})
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @RequirePermissions('roles.create')
  @Auditable({
    module: AuditModule.ROLES,
    action: AuditAction.CREATE,
    entityType: 'Role',
    description: 'Rol creado en el sistema',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Crear nuevo rol',
    description:
      'Crea un rol personalizado. Solo super-admin (403 para el resto, aun con "roles.create"). Un nombre de rol de sistema responde 403.',
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
        permissions: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o rol ya existe',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El rol ya existe' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
      },
    },
  })
  @ApiBody({ type: CreateRoleDto })
  create(
    @Body() createRoleDto: CreateRoleDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.rolesService.create(createRoleDto, tenant);
  }

  @Get()
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener todos los roles',
    description:
      'Retorna la lista completa de roles del sistema con sus permisos. Requiere permiso "roles.read".',
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
                action: { type: 'string', example: 'create' },
              },
            },
          },
        },
      },
    },
  })
  findAll() {
    return this.rolesService.findAll();
  }

  @Get('permissions/available')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener permisos disponibles',
    description:
      'Retorna todos los permisos disponibles en el sistema para asignar a roles. Requiere permiso "roles.read".',
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
          action: { type: 'string', example: 'create' },
        },
      },
    },
  })
  getAvailablePermissions() {
    return this.rolesService.getAllPermissions();
  }

  @Get('permissions/by-module')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener permisos agrupados por módulo',
    description:
      'Retorna los permisos organizados por módulos del sistema para facilitar la asignación. Requiere permiso "roles.read".',
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
            action: { type: 'string', example: 'create' },
          },
        },
      },
      example: {
        users: [
          {
            id: 'perm-1',
            name: 'users.create',
            description: 'Crear usuarios',
            action: 'create',
          },
          {
            id: 'perm-2',
            name: 'users.read',
            description: 'Ver usuarios',
            action: 'read',
          },
        ],
        roles: [
          {
            id: 'perm-3',
            name: 'roles.create',
            description: 'Crear roles',
            action: 'create',
          },
        ],
      },
    },
  })
  getPermissionsByModule() {
    return this.rolesService.getPermissionsByModule();
  }

  @Get(':id')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener rol por ID',
    description:
      'Retorna un rol con sus permisos (sin sus usuarios). Requiere permiso "roles.read".',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol',
    example: 'role-uuid-123',
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
              action: { type: 'string', example: 'create' },
            },
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Rol no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Rol no encontrado' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.findOne(id);
  }

  @Get(':id/permissions')
  @RequirePermissions('roles.read')
  @ApiOperation({
    summary: 'Obtener permisos de un rol',
    description:
      'Retorna únicamente los permisos asignados a un rol específico. Requiere permiso "roles.read".',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol',
    example: 'role-uuid-123',
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
          action: { type: 'string', example: 'create' },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  getRolePermissions(@Param('id', ParseUUIDPipe) id: string) {
    return this.rolesService.getRolePermissions(id);
  }

  @Patch(':id')
  @RequirePermissions('roles.update')
  @Auditable({
    module: AuditModule.ROLES,
    action: AuditAction.UPDATE,
    entityType: 'Role',
    description: 'Información de rol actualizada',
    captureOldValue: true,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Actualizar rol',
    description:
      'Actualiza nombre y descripción de un rol personalizado y lo devuelve. Solo super-admin; un rol de sistema responde 403. Para los permisos usar PUT /:id/permissions.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol a actualizar',
    example: 'role-uuid-123',
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
        permissions: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  @ApiBody({ type: UpdateRoleDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.rolesService.update(id, updateRoleDto, tenant);
  }

  @Put(':id/permissions')
  @RequirePermissions('roles.assign-permissions')
  @Auditable({
    module: AuditModule.ROLES,
    action: AuditAction.PERMISSION_GRANT,
    entityType: 'Role',
    description: 'Permisos de rol actualizados',
    captureOldValue: true,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Actualizar permisos de un rol',
    description:
      'Reemplaza los permisos de un rol personalizado. Solo super-admin; un rol de sistema responde 403 (sus permisos se definen en el código).',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol',
    example: 'role-uuid-123',
  })
  @ApiBody({ type: UpdateRolePermissionsDto })
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
              description: { type: 'string', example: 'Crear usuarios' },
            },
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  @ApiBadRequestResponse({ description: 'IDs de permisos inválidos' })
  updateRolePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.rolesService.updateRolePermissions(
      id,
      dto.permissionIds,
      tenant,
    );
  }

  @Delete(':id')
  @RequirePermissions('roles.delete')
  @Auditable({
    module: AuditModule.ROLES,
    action: AuditAction.DELETE,
    entityType: 'Role',
    description: 'Rol eliminado del sistema',
    captureOldValue: true,
  })
  @ApiOperation({
    summary: 'Eliminar rol',
    description:
      'Elimina un rol personalizado. Solo super-admin; un rol de sistema responde 403 y un rol asignado a usuarios, 409.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del rol a eliminar',
    example: 'role-uuid-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Rol eliminado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Rol eliminado exitosamente' },
        deleted: { type: 'boolean', example: true },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Rol no encontrado' })
  @ApiConflictResponse({
    description: 'El rol está asignado a usuarios (o en uso por cámaras)',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.rolesService.remove(id, tenant);
  }
}
