import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OnboardingService } from './onboarding.service';
import { CreateCondominiumDto } from './dto/create-condominium.dto';
import { CreateCondominiumMemberDto } from './dto/create-condominium-member.dto';
import { CurrentActor, type TenantActor } from '../common/tenant/tenant-actor';

/**
 * Onboarding / creación de cuentas en cascada (Fase 0, tarea #19 —
 * docs/modulos/auth-multitenant.md §7b). Ver docstring de OnboardingService
 * para el detalle del flujo y por qué NO se usan invitaciones nativas.
 */
@ApiTags('Onboarding (Multi-tenant)')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({
  description: 'Token JWT/sesión inválida o expirada',
})
@ApiForbiddenResponse({
  description: 'No tiene permisos suficientes para esta operación',
})
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('condominiums')
  // Fase 4 · P5.C: selector de condominio del super-admin (crear usuarios y
  // recursos con `organizationId`). Exclusivo de la plataforma.
  @RequirePermissions('platform.manage-organizations')
  @ApiOperation({
    summary: 'Listar condominios (super-admin)',
    description:
      'Todos los condominios como { id, name, slug }[], ordenados por nombre. Exclusivo de la plataforma (403 para cualquier otro).',
  })
  @ApiResponse({
    status: 200,
    description: 'Condominios',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', example: 'Condominio San Lorenzo' },
          slug: { type: 'string', example: 'condominio-san-lorenzo' },
        },
      },
    },
  })
  listCondominiums(@CurrentActor() actor: TenantActor) {
    return this.onboardingService.listCondominiums(actor);
  }

  @Post('condominiums')
  // Exclusivo de la plataforma — SOLO el rol Super Administrador tiene este
  // permiso (dinámico, ver DataInitializationService). "Administrador" (rol
  // de UN condominio) NO lo tiene.
  @RequirePermissions('platform.manage-organizations')
  @ApiOperation({
    summary: 'Crear un condominio (super-admin)',
    description:
      'Crea una organización (condominio) y su Administrador (owner) en cascada. Exclusivo de la plataforma.',
  })
  @ApiResponse({
    status: 201,
    description: 'Condominio y administrador creados exitosamente',
  })
  createCondominium(
    @Body() dto: CreateCondominiumDto,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.onboardingService.createCondominium(dto, actor);
  }

  @Post('members')
  // Mismo permiso que ya usa la gestión de usuarios existente
  // (asignado a "Administrador" en default-roles.constant.ts) — el scoping
  // por tenant (a qué condominio se agrega el usuario) lo resuelve
  // membresía del caller (TenantActor), no el body. Los roles pasan por
  // RoleAssignmentPolicy y la familia debe ser del condominio (P5).
  @RequirePermissions('users.create')
  @ApiOperation({
    summary:
      'Crear/dar de alta un usuario en MI condominio (admin de condominio)',
    description:
      'Crea un usuario (residente, conserje) dentro del condominio del Administrador autenticado.',
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado y agregado al condominio',
  })
  createMember(
    @Body() dto: CreateCondominiumMemberDto,
    @CurrentActor() actor: TenantActor,
  ) {
    return this.onboardingService.createCondominiumMember(dto, actor);
  }
}
