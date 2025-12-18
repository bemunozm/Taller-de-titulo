import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { FamiliesService } from './families.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { AddMemberDto, RemoveMemberDto, AddMembersDto } from './dto/manage-members.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiBody, ApiUnauthorizedResponse, ApiForbiddenResponse, ApiNotFoundResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';

@ApiTags('Gestión de Familias')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
@Controller('families')
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Post()
  @RequirePermissions('families.create')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.CREATE,
    entityType: 'Family',
    description: 'Familia creada',
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Crear una nueva familia', 
    description: 'Crea un nuevo grupo familiar en el sistema. Requiere permiso "families.create".'
  })
  @ApiBody({ type: CreateFamilyDto })
  @ApiResponse({ 
    status: 201, 
    description: 'Familia creada exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        members: { type: 'array', items: { type: 'object' } }
      }
    }
  })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  create(@Body() createFamilyDto: CreateFamilyDto) {
    return this.familiesService.create(createFamilyDto);
  }

  @Get()
  @RequirePermissions('families.read')
  @ApiOperation({ 
    summary: 'Obtener todas las familias', 
    description: 'Retorna la lista completa de familias registradas en el sistema con sus miembros. Requiere permiso "families.read".'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lista de familias obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          members: { 
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' }
              }
            }
          }
        }
      }
    }
  })
  findAll() {
    return this.familiesService.findAll();
  }

  @Get('available-users')
  @RequirePermissions('families.read')
  @ApiOperation({ 
    summary: 'Obtener usuarios disponibles', 
    description: 'Retorna la lista de usuarios que no tienen familia asignada y pueden ser agregados a una familia. Requiere permiso "families.read".'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Lista de usuarios disponibles obtenida exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          rut: { type: 'string' }
        }
      }
    }
  })
  getAvailableUsers() {
    return this.familiesService.getAvailableUsers();
  }

  @Get(':id')
  @RequirePermissions('families.read')
  @ApiOperation({ 
    summary: 'Obtener familia por ID', 
    description: 'Retorna la información detallada de una familia específica con todos sus miembros. Requiere permiso "families.read".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Familia encontrada exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        members: { type: 'array', items: { type: 'object' } }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Familia no encontrada' })
  findOne(@Param('id') id: string) {
    return this.familiesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('families.update')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Familia actualizada',
    captureOldValue: true,
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Actualizar familia', 
    description: 'Actualiza la información de una familia existente (nombre u otros datos básicos). Para gestionar miembros usar los endpoints específicos. Requiere permiso "families.update".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiBody({ 
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nuevo nombre de la familia' }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Familia actualizada exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Familia no encontrada' })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  update(@Param('id') id: string, @Body() updateFamilyDto: Partial<CreateFamilyDto>) {
    return this.familiesService.update(id, updateFamilyDto);
  }

  @Delete(':id')
  @RequirePermissions('families.delete')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.DELETE,
    entityType: 'Family',
    description: 'Familia eliminada',
    captureOldValue: true
  })
  @ApiOperation({ 
    summary: 'Eliminar familia', 
    description: 'Elimina una familia del sistema. Los usuarios miembros quedarán sin familia asignada. Requiere permiso "families.delete".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Familia eliminada exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Familia eliminada exitosamente' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Familia no encontrada' })
  remove(@Param('id') id: string) {
    return this.familiesService.remove(id);
  }

  @Post(':id/members')
  @RequirePermissions('families.add-member')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Miembro agregado a familia',
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Agregar miembro a familia', 
    description: 'Agrega un usuario como miembro de una familia existente. El usuario no debe pertenecer a otra familia. Requiere permiso "families.add-member".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiBody({ type: AddMemberDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Miembro agregado exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        members: { type: 'array' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Familia o usuario no encontrado' })
  @ApiBadRequestResponse({ description: 'El usuario ya pertenece a otra familia' })
  addMember(@Param('id') id: string, @Body() addMemberDto: AddMemberDto) {
    return this.familiesService.addMember(id, addMemberDto.userId);
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('families.remove-member')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Miembro removido de familia',
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Remover miembro de familia', 
    description: 'Remueve un usuario de una familia. El usuario quedará sin familia asignada. Requiere permiso "families.remove-member".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiParam({ name: 'userId', description: 'ID del usuario a remover', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Miembro removido exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        members: { type: 'array' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Familia o usuario no encontrado' })
  @ApiBadRequestResponse({ description: 'El usuario no pertenece a esta familia' })
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.familiesService.removeMember(id, userId);
  }

  @Post(':id/members/bulk')
  @RequirePermissions('families.add-member')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Múltiples miembros agregados a familia',
    captureResponse: true
  })
  @ApiOperation({ 
    summary: 'Agregar múltiples miembros a familia', 
    description: 'Agrega varios usuarios como miembros de una familia en una sola operación. Requiere permiso "families.add-member".'
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiBody({ type: AddMembersDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Miembros agregados exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        members: { type: 'array' }
      }
    }
  })
  @ApiNotFoundResponse({ description: 'Familia o algún usuario no encontrado' })
  @ApiBadRequestResponse({ description: 'Algunos usuarios ya pertenecen a otra familia' })
  addMembers(@Param('id') id: string, @Body() addMembersDto: AddMembersDto) {
    return this.familiesService.addMembers(id, addMembersDto.userIds);
  }
}