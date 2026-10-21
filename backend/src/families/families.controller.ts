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
import { FamiliesService } from './families.service';
import { CreateFamilyDto } from './dto/create-family.dto';
import { UpdateFamilyDto } from './dto/update-family.dto';
import type { Family } from './entities/family.entity';
import { embeddedUserFor } from '../users/user-summary';
import { AddMemberDto, AddMembersDto } from './dto/manage-members.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';
import {
  CurrentActor,
  familyScopeOf,
  type TenantActor,
} from '../common/tenant/tenant-actor';

/**
 * Corrección P5 (cyber B3): los miembros van como `{ id, name }` para quien no
 * ve el detalle de usuarios (sin `users.update`).
 */
function presentFamily(family: Family, actor: TenantActor): Family {
  if (family.members) {
    family.members = family.members.map((member) =>
      embeddedUserFor(member, actor),
    );
  }
  return family;
}

/**
 * Familias. Fase 4 · P5.C (D12): cada ruta pasa el alcance por familia del
 * actor (`familyScopeOf`). Sin `condominium.view-all` (el Residente) solo ve
 * su propia familia (otra → 404) y `available-users` responde vacío.
 */
@ApiTags('Gestión de Familias')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@ApiForbiddenResponse({
  description: 'No tiene permisos suficientes para esta operación',
})
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
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Crear una nueva familia',
    description:
      'Crea un nuevo grupo familiar en el sistema. Requiere permiso "families.create".',
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
        members: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  async create(
    @Body() createFamilyDto: CreateFamilyDto,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentFamily(
      await this.familiesService.create(createFamilyDto),
      actor,
    );
  }

  @Get()
  @RequirePermissions('families.read')
  @ApiOperation({
    summary: 'Obtener todas las familias',
    description:
      'Retorna la lista completa de familias registradas en el sistema con sus miembros. Requiere permiso "families.read".',
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
                email: { type: 'string' },
              },
            },
          },
        },
      },
    },
  })
  async findAll(@CurrentActor() actor: TenantActor) {
    const families = await this.familiesService.findAll(familyScopeOf(actor));
    return families.map((family) => presentFamily(family, actor));
  }

  @Get('available-users')
  @RequirePermissions('families.read')
  @ApiOperation({
    summary: 'Obtener usuarios disponibles',
    description:
      'Retorna la lista de usuarios que no tienen familia asignada y pueden ser agregados a una familia. Requiere permiso "families.read".',
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
          rut: { type: 'string' },
        },
      },
    },
  })
  async getAvailableUsers(@CurrentActor() actor: TenantActor) {
    const users = await this.familiesService.getAvailableUsers(
      familyScopeOf(actor),
    );
    // Corrección P5 (QA R3): `{ id, name }` (sin email ni RUT) para quien no
    // ve el detalle de usuarios (sin `users.update`, p. ej. Conserje).
    return users.map((user) => embeddedUserFor(user, actor));
  }

  @Get(':id')
  @RequirePermissions('families.read')
  @ApiOperation({
    summary: 'Obtener familia por ID',
    description:
      'Retorna la información detallada de una familia específica con todos sus miembros. Requiere permiso "families.read".',
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
        members: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Familia no encontrada' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentFamily(
      await this.familiesService.findOne(id, familyScopeOf(actor)),
      actor,
    );
  }

  @Patch(':id')
  @RequirePermissions('families.update')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Familia actualizada',
    captureOldValue: true,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Actualizar familia',
    description:
      'Actualiza la información de una familia existente (nombre u otros datos básicos). Para gestionar miembros usar los endpoints específicos. Requiere permiso "families.update".',
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiBody({ type: UpdateFamilyDto })
  @ApiResponse({
    status: 200,
    description: 'Familia actualizada exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Familia no encontrada' })
  @ApiBadRequestResponse({ description: 'Datos inválidos' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFamilyDto: UpdateFamilyDto,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentFamily(
      await this.familiesService.update(
        id,
        updateFamilyDto,
        familyScopeOf(actor),
      ),
      actor,
    );
  }

  @Delete(':id')
  @RequirePermissions('families.delete')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.DELETE,
    entityType: 'Family',
    description: 'Familia eliminada',
    captureOldValue: true,
  })
  @ApiOperation({
    summary: 'Eliminar familia',
    description:
      'Elimina una familia del sistema. Los usuarios miembros quedarán sin familia asignada. Requiere permiso "families.delete".',
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiResponse({
    status: 200,
    description: 'Familia eliminada exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Familia eliminada exitosamente' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Familia no encontrada' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.familiesService.remove(id, familyScopeOf(actor));
  }

  @Post(':id/members')
  @RequirePermissions('families.add-member')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Miembro agregado a familia',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Agregar miembro a familia',
    description:
      'Agrega un usuario como miembro de una familia existente. El usuario no debe pertenecer a otra familia. Requiere permiso "families.add-member".',
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
        members: { type: 'array' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Familia o usuario no encontrado' })
  @ApiBadRequestResponse({
    description: 'El usuario ya pertenece a otra familia',
  })
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() addMemberDto: AddMemberDto,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentFamily(
      await this.familiesService.addMember(
        id,
        addMemberDto.userId,
        familyScopeOf(actor),
      ),
      actor,
    );
  }

  @Delete(':id/members/:userId')
  @RequirePermissions('families.remove-member')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Miembro removido de familia',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Remover miembro de familia',
    description:
      'Remueve un usuario de una familia. El usuario quedará sin familia asignada. Requiere permiso "families.remove-member".',
  })
  @ApiParam({ name: 'id', description: 'ID único de la familia', type: String })
  @ApiParam({
    name: 'userId',
    description: 'ID del usuario a remover',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Miembro removido exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        members: { type: 'array' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Familia o usuario no encontrado' })
  @ApiBadRequestResponse({
    description: 'El usuario no pertenece a esta familia',
  })
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentFamily(
      await this.familiesService.removeMember(id, userId, familyScopeOf(actor)),
      actor,
    );
  }

  @Post(':id/members/bulk')
  @RequirePermissions('families.add-member')
  @Auditable({
    module: AuditModule.FAMILIES,
    action: AuditAction.UPDATE,
    entityType: 'Family',
    description: 'Múltiples miembros agregados a familia',
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Agregar múltiples miembros a familia',
    description:
      'Agrega varios usuarios como miembros de una familia en una sola operación. Requiere permiso "families.add-member".',
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
        members: { type: 'array' },
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Familia o algún usuario no encontrado' })
  @ApiBadRequestResponse({
    description: 'Algunos usuarios ya pertenecen a otra familia',
  })
  async addMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() addMembersDto: AddMembersDto,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentFamily(
      await this.familiesService.addMembers(
        id,
        addMembersDto.userIds,
        familyScopeOf(actor),
      ),
      actor,
    );
  }
}
