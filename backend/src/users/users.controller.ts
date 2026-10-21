import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
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
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateAccountByAdminDto } from './dto/create-account-by-admin.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';
import { CurrentActor, type TenantActor } from '../common/tenant/tenant-actor';

/**
 * Gestión de usuarios (Fase 4 · P5, D12): cada ruta pasa el actor
 * (`@CurrentActor()`) a las variantes `*ForActor` de UsersService, que acotan
 * por condominio (super-admin: todo; resto: usuarios con membresía en su
 * condominio, o solo él mismo sin `condominium.view-all`). Un usuario fuera
 * de ese alcance responde 404.
 *
 * `POST /users` se retiró (P5): creaba usuarios sin contraseña ni membresía y
 * la UI no lo usaba. El alta es `POST /users/create-by-admin`.
 */
@ApiTags('Gestión de Usuarios')
@Controller('users')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({
  description: 'No tiene permisos suficientes para esta operación',
})
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('create-by-admin')
  @RequirePermissions('users.create')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.CREATE,
    entityType: 'User',
    description: 'Cuenta de usuario creada por administrador',
    captureResponse: true,
    captureRequest: false,
  })
  @ApiOperation({
    summary: 'Crear cuenta de usuario por administrador',
    description:
      'Crea una cuenta de usuario desde el panel de administración y su membresía en el condominio del actor (el super-admin indica `organizationId`). Envía un email para que el usuario defina su contraseña. Los roles pasan por RoleAssignmentPolicy (403) y la familia debe ser del condominio (403). Si la membresía falla, la cuenta no se crea (500). Requiere permiso "users.create".',
  })
  @ApiBody({
    type: CreateAccountByAdminDto,
    description: 'Datos del usuario a crear por admin',
  })
  @ApiResponse({
    status: 201,
    description: 'Cuenta creada exitosamente y email enviado',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Account created successfully. Email sent to user.',
        },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            rut: { type: 'string', example: '12345678-9' },
            name: { type: 'string', example: 'Juan Carlos Pérez González' },
            email: { type: 'string', example: 'juan.perez@universidad.cl' },
            age: { type: 'number', example: 22 },
            emailVerified: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
            roles: { type: 'array', items: { type: 'object' } },
            family: { type: 'object', nullable: true },
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Email ya existe, roles inválidos o familia no encontrada',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El email ya está en uso' },
      },
    },
  })
  async createAccountByAdmin(
    @Body() createAccountByAdminDto: CreateAccountByAdminDto,
    @CurrentActor() actor: TenantActor,
  ) {
    const newUser = await this.usersService.createAccountByAdmin(
      createAccountByAdminDto,
      actor,
    );
    return {
      message: 'Account created successfully. Email sent to user.',
      user: newUser,
    };
  }

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({
    summary: 'Obtener todos los usuarios',
    description:
      'Super-admin: todos los usuarios. Con "condominium.view-all": los usuarios con membresía en su condominio. Sin él: solo el propio. Requiere permiso "users.read". Fase 4 · P5.C: con "users.update" (o super-admin) cada usuario va completo; sin él, cada usuario que no es el propio va como { id, name, family: { id, name } | null }.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de usuarios obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', example: 'user-uuid-123' },
          rut: { type: 'string', example: '12345678-9' },
          name: { type: 'string', example: 'Juan Carlos Pérez González' },
          email: { type: 'string', example: 'juan.perez@universidad.cl' },
          phone: { type: 'string', example: '+56912345678' },
          age: { type: 'number', example: 22 },
          emailVerified: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string', example: 'student' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
    },
  })
  findAll(@CurrentActor() actor: TenantActor) {
    return this.usersService.findAllForActor(actor);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({
    summary: 'Obtener usuario por ID',
    description:
      'Retorna la información detallada de un usuario específico incluyendo sus roles y relaciones. Fase 4 · P5.C: sin "users.update" (y sin ser super-admin), otro usuario va como { id, name, family: { id, name } | null }; el propio, completo.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del usuario (UUID)',
    example: 'user-uuid-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario encontrado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', example: 'user-uuid-123' },
        rut: { type: 'string', example: '12345678-9' },
        name: { type: 'string', example: 'Juan Carlos Pérez González' },
        email: { type: 'string', example: 'juan.perez@universidad.cl' },
        phone: { type: 'string', example: '+56912345678' },
        age: { type: 'number', example: 22 },
        emailVerified: { type: 'boolean', example: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string', example: 'student' },
              description: { type: 'string' },
              permissions: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.usersService.findOneForActor(id, actor);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Información de usuario actualizada',
    captureOldValue: true,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Actualizar usuario',
    description:
      'Actualiza la información de un usuario existente. Solo se modificarán los campos proporcionados (actualización parcial). La contraseña será encriptada automáticamente si se proporciona. Requiere permiso "users.update".',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del usuario a actualizar',
    example: 'user-uuid-123',
  })
  @ApiBody({
    type: UpdateUserDto,
    description:
      'Datos del usuario a actualizar (todos los campos son opcionales)',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        affected: {
          type: 'number',
          example: 1,
          description: 'Número de registros afectados',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o RUT/email ya existe en otro usuario',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.usersService.updateForActor(id, updateUserDto, actor);
  }

  @Delete(':id')
  @RequirePermissions('users.delete')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.DELETE,
    entityType: 'User',
    description: 'Usuario eliminado del sistema',
    captureOldValue: true,
  })
  @ApiOperation({
    summary: 'Eliminar usuario',
    description:
      'Elimina definitivamente al usuario (para suspenderlo usar PATCH /:id/disable). Nadie se elimina a sí mismo; solo el super-admin elimina a otro super-admin (403). Si tiene registros asociados (visitas, vehículos...) responde 409: deshabilitarlo. Requiere permiso "users.delete".',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del usuario a eliminar',
    example: 'user-uuid-123',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario eliminado exitosamente',
    schema: {
      type: 'object',
      properties: {
        affected: {
          type: 'number',
          example: 1,
          description: 'Número de registros eliminados',
        },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado o ya eliminado' })
  @ApiResponse({
    status: 409,
    description:
      'El usuario tiene registros asociados: deshabilitarlo (PATCH /:id/disable) en vez de eliminarlo',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.usersService.removeForActor(id, actor);
  }

  @Patch(':id/disable')
  @RequirePermissions('users.update')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario deshabilitado temporalmente',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Deshabilitar usuario',
    description:
      'Deshabilita temporalmente una cuenta de usuario mediante soft delete. El usuario no podrá iniciar sesión pero sus datos se conservan. Requiere permiso "users.update".',
  })
  @ApiParam({ name: 'id', description: 'ID único del usuario', type: String })
  @ApiResponse({
    status: 200,
    description: 'Usuario deshabilitado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Usuario deshabilitado exitosamente',
        },
        affected: { type: 'number', example: 1 },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  disable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.usersService.disableForActor(id, actor);
  }

  @Patch(':id/enable')
  @RequirePermissions('users.update')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario habilitado nuevamente',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Habilitar usuario',
    description:
      'Reactiva una cuenta de usuario previamente deshabilitada. El usuario podrá volver a iniciar sesión. Requiere permiso "users.update".',
  })
  @ApiParam({ name: 'id', description: 'ID único del usuario', type: String })
  @ApiResponse({
    status: 200,
    description: 'Usuario habilitado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Usuario habilitado exitosamente' },
        affected: { type: 'number', example: 1 },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiBadRequestResponse({ description: 'El usuario ya está habilitado' })
  enable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.usersService.enableForActor(id, actor);
  }
}
