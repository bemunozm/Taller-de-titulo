import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

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

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({
    summary: 'Obtener todos los usuarios',
    description: 'Retorna la lista completa de usuarios registrados en el sistema incluyendo sus roles asignados. No incluye usuarios eliminados (soft delete). Requiere permiso "users.read".'
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
  findAll() {
    return this.usersService.findAll();
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
  @ApiOperation({
    summary: 'Actualizar usuario',
    description: 'Actualiza la información de un usuario existente. Solo se modificarán los campos proporcionados (actualización parcial). La contraseña será encriptada automáticamente si se proporciona.'
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
}
