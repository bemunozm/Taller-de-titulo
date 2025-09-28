import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiParam, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { TokensService } from './tokens.service';
import { CreateTokenDto } from './dto/create-token.dto';
import { UpdateTokenDto } from './dto/update-token.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Gestión de Tokens')
@Controller('tokens')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
export class TokensController {
  constructor(private readonly tokensService: TokensService) {}

  @Post()
  @RequirePermissions('tokens.create')
  @ApiOperation({
    summary: 'Crear nuevo token de verificación',
    description: 'Crea un nuevo token de 6 dígitos asociado a un usuario. Los tokens expiran automáticamente en 10 minutos. Requiere permiso "tokens.create".'
  })
  @ApiResponse({
    status: 201,
    description: 'Token creado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', example: 'token-uuid-123' },
        token: { type: 'string', example: '123456' },
        userId: { type: 'string', format: 'uuid', example: 'user-uuid-123' },
        createdAt: { type: 'string', format: 'date-time', example: '2024-01-01T12:00:00Z' },
        expiresAt: { type: 'string', format: 'date-time', example: '2024-01-01T12:10:00Z' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Juan Pérez' },
            email: { type: 'string', example: 'juan@example.com' }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Datos inválidos o usuario no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Usuario no encontrado' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @ApiBody({ type: CreateTokenDto })
  create(@Body() createTokenDto: CreateTokenDto) {
    return this.tokensService.create(createTokenDto);
  }

  @Get()
  @RequirePermissions('tokens.read')
  @ApiOperation({
    summary: 'Obtener todos los tokens',
    description: 'Retorna la lista completa de tokens del sistema incluyendo información del usuario asociado. Solo muestra tokens válidos (no expirados). Requiere permiso "tokens.read".'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de tokens obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          token: { type: 'string', example: '123456' },
          userId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string', example: 'Juan Pérez' },
              email: { type: 'string', example: 'juan@example.com' }
            }
          }
        }
      }
    }
  })
  findAll() {
    return this.tokensService.findAll();
  }

  @Get(':id')
  @RequirePermissions('tokens.read')
  @ApiOperation({
    summary: 'Obtener token por ID',
    description: 'Retorna la información detallada de un token específico incluyendo su estado de expiración y usuario asociado.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del token',
    example: 'token-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Token encontrado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        token: { type: 'string', example: '123456' },
        userId: { type: 'string', format: 'uuid' },
        createdAt: { type: 'string', format: 'date-time', example: '2024-01-01T12:00:00Z' },
        expiresAt: { type: 'string', format: 'date-time', example: '2024-01-01T12:10:00Z' },
        isExpired: { type: 'boolean', example: false, description: 'Indica si el token ha expirado' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string', example: 'Juan Pérez' },
            email: { type: 'string', example: 'juan@example.com' }
          }
        }
      }
    }
  })
  @ApiNotFoundResponse({
    description: 'Token no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no encontrado' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  findOne(@Param('id') id: string) {
    return this.tokensService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('tokens.update')
  @ApiOperation({
    summary: 'Actualizar token',
    description: 'Actualiza la información de un token existente. Nota: Generalmente no se recomienda modificar tokens después de su creación por seguridad.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del token a actualizar',
    example: 'token-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Token actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        affected: { type: 'number', example: 1, description: 'Número de registros afectados' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Token no encontrado' })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  @ApiBody({ type: UpdateTokenDto })
  update(@Param('id') id: string, @Body() updateTokenDto: UpdateTokenDto) {
    return this.tokensService.update(id, updateTokenDto);
  }

  @Delete(':id')
  @RequirePermissions('tokens.delete')
  @ApiOperation({
    summary: 'Eliminar token',
    description: 'Elimina un token específico del sistema. Útil para invalidar tokens de verificación o revocar acceso.'
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    description: 'ID único del token a eliminar',
    example: 'token-uuid-123'
  })
  @ApiResponse({
    status: 200,
    description: 'Token eliminado exitosamente',
    schema: {
      type: 'object',
      properties: {
        affected: { type: 'number', example: 1, description: 'Número de registros eliminados' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Token no encontrado' })
  remove(@Param('id') id: string) {
    return this.tokensService.remove(id);
  }

  @Delete('cleanup/expired')
  @RequirePermissions('tokens.cleanup')
  @ApiOperation({
    summary: 'Limpiar tokens expirados',
    description: 'Elimina automáticamente todos los tokens que han expirado del sistema. Esta operación ayuda a mantener la base de datos limpia.'
  })
  @ApiResponse({
    status: 200,
    description: 'Tokens expirados eliminados exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          example: 'Se eliminaron 15 tokens expirados' 
        },
        removedCount: { 
          type: 'number', 
          example: 15, 
          description: 'Cantidad de tokens expirados eliminados' 
        }
      }
    }
  })
  async cleanupExpiredTokens() {
    const removedCount = await this.tokensService.cleanupExpiredTokens();
    return {
      message: removedCount > 0 
        ? `Se eliminaron ${removedCount} tokens expirados` 
        : 'No se encontraron tokens expirados',
      removedCount
    };
  }
}
