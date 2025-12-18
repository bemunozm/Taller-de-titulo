import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, UseInterceptors, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { CreateAccountByAdminDto } from './dto/create-account-by-admin.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';
import { FilterByUser } from '../common/decorators/filter-by-user.decorator';
import { UserFilterInterceptor } from '../common/interceptors/user-filter.interceptor';

@ApiTags('Gestión de Usuarios')
@Controller('users')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('users.create')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.CREATE,
    entityType: 'User',
    description: 'Usuario creado en el sistema',
    captureResponse: true,
    captureRequest: false
  })
  @ApiOperation({
    summary: 'Crear nuevo usuario',
    description: 'Crea un nuevo usuario en el sistema con los datos proporcionados. La contraseña será automáticamente encriptada antes del almacenamiento. Requiere permiso "users.create".'
  })
  @ApiBody({ 
    type: CreateUserDto,
    description: 'Datos del usuario a crear'
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'User created successfully' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: 'user-uuid-123' },
            rut: { type: 'string', example: '12345678-9' },
            name: { type: 'string', example: 'Juan Carlos Pérez González' },
            email: { type: 'string', example: 'juan.perez@universidad.cl' },
            age: { type: 'number', example: 22 },
            confirmed: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
            roles: { type: 'array', items: { type: 'object' } }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ 
    description: 'Datos inválidos o RUT/email ya existe',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Error creating user' }
      }
    }
  })
  async create(@Body() createUserDto: CreateUserDto) {
    console.log(createUserDto);
    const newUser = await this.usersService.create(createUserDto);
    if (newUser) {
      return { message: 'User created successfully', user: newUser };
    } else {
      return { message: 'Error creating user' };
    }
  }

  @Post('create-by-admin')
  @RequirePermissions('users.create')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.CREATE,
    entityType: 'User',
    description: 'Cuenta de usuario creada por administrador',
    captureResponse: true,
    captureRequest: false
  })
  @ApiOperation({
    summary: 'Crear cuenta de usuario por administrador',
    description: 'Crea una cuenta de usuario desde el panel de administración. Se genera automáticamente una contraseña temporal y se envía un email al usuario con un token para establecer su propia contraseña. Permite asignar roles y familia opcional. Requiere permiso "users.create".'
  })
  @ApiBody({ 
    type: CreateAccountByAdminDto,
    description: 'Datos del usuario a crear por admin'
  })
  @ApiResponse({
    status: 201,
    description: 'Cuenta creada exitosamente y email enviado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Account created successfully. Email sent to user.' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            rut: { type: 'string', example: '12345678-9' },
            name: { type: 'string', example: 'Juan Carlos Pérez González' },
            email: { type: 'string', example: 'juan.perez@universidad.cl' },
            age: { type: 'number', example: 22 },
            confirmed: { type: 'boolean', example: false },
            createdAt: { type: 'string', format: 'date-time' },
            roles: { type: 'array', items: { type: 'object' } },
            family: { type: 'object', nullable: true }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({ 
    description: 'Email ya existe, roles inválidos o familia no encontrada',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El email ya está en uso' }
      }
    }
  })
  async createAccountByAdmin(@Body() createAccountByAdminDto: CreateAccountByAdminDto) {
    const newUser = await this.usersService.createAccountByAdmin(createAccountByAdminDto);
    return { 
      message: 'Account created successfully. Email sent to user.',
      user: newUser 
    };
  }

  @Get()
  @FilterByUser('self')
  @UseInterceptors(UserFilterInterceptor)
  @RequirePermissions('users.read')
  @ApiOperation({
    summary: 'Obtener todos los usuarios',
    description: 'Retorna la lista completa de usuarios registrados en el sistema. Admin ve todos los usuarios, residentes solo ven su propio usuario (filtrado automático por rol). Requiere permiso "users.read".'
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
          confirmed: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string', example: 'student' },
                description: { type: 'string' }
              }
            }
          }
        }
      }
    }
  })
  findAll(@Req() request: any) {
    // El interceptor agrega filterUserId al request si el usuario no es admin
    const userId = request.filterUserId;
    return this.usersService.findAll(userId);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({
    summary: 'Obtener usuario por ID',
    description: 'Retorna la información detallada de un usuario específico incluyendo sus roles y relaciones. Útil para perfiles de usuario y gestión administrativa.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del usuario (UUID)',
    example: 'user-uuid-123'
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
        confirmed: { type: 'boolean', example: true },
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
              permissions: { type: 'array', items: { type: 'object' } }
            }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Información de usuario actualizada',
    captureOldValue: true,
    captureResponse: true
  })
  @ApiOperation({
    summary: 'Actualizar usuario',
    description: 'Actualiza la información de un usuario existente. Solo se modificarán los campos proporcionados (actualización parcial). La contraseña será encriptada automáticamente si se proporciona. Requiere permiso "users.update".'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del usuario a actualizar',
    example: 'user-uuid-123'
  })
  @ApiBody({ 
    type: UpdateUserDto,
    description: 'Datos del usuario a actualizar (todos los campos son opcionales)'
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        affected: { type: 'number', example: 1, description: 'Número de registros afectados' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiBadRequestResponse({ description: 'Datos inválidos o RUT/email ya existe en otro usuario' })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @RequirePermissions('users.delete')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.DELETE,
    entityType: 'User',
    description: 'Usuario eliminado del sistema',
    captureOldValue: true
  })
  @ApiOperation({
    summary: 'Eliminar usuario',
    description: 'Realiza una eliminación lógica (soft delete) del usuario. El usuario será marcado como eliminado pero mantenido en la base de datos para auditoría. Esta operación es irreversible desde la API.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del usuario a eliminar',
    example: 'user-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario eliminado exitosamente',
    schema: {
      type: 'object',
      properties: {
        affected: { type: 'number', example: 1, description: 'Número de registros eliminados' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado o ya eliminado' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Patch(':id/disable')
  @RequirePermissions('users.update')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario deshabilitado temporalmente',
    captureResponse: true
  })
  @ApiOperation({
    summary: 'Deshabilitar usuario',
    description: 'Deshabilita temporalmente una cuenta de usuario mediante soft delete. El usuario no podrá iniciar sesión pero sus datos se conservan. Requiere permiso "users.update".'
  })
  @ApiParam({ name: 'id', description: 'ID único del usuario', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Usuario deshabilitado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Usuario deshabilitado exitosamente' },
        affected: { type: 'number', example: 1 }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  disable(@Param('id') id: string) {
    return this.usersService.disable(id);
  }

  @Patch(':id/enable')
  @RequirePermissions('users.update')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario habilitado nuevamente',
    captureResponse: true
  })
  @ApiOperation({
    summary: 'Habilitar usuario',
    description: 'Reactiva una cuenta de usuario previamente deshabilitada. El usuario podrá volver a iniciar sesión. Requiere permiso "users.update".'
  })
  @ApiParam({ name: 'id', description: 'ID único del usuario', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Usuario habilitado exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Usuario habilitado exitosamente' },
        affected: { type: 'number', example: 1 }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado' })
  @ApiBadRequestResponse({ description: 'El usuario ya está habilitado' })
  enable(@Param('id') id: string) {
    return this.usersService.enable(id);
  }
}
