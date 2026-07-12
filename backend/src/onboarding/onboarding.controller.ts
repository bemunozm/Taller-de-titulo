import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiOperation, ApiResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OnboardingService } from './onboarding.service';
import { CreateCondominiumDto } from './dto/create-condominium.dto';
import { CreateCondominiumMemberDto } from './dto/create-condominium-member.dto';

/**
 * Onboarding / creación de cuentas en cascada (Fase 0, tarea #19 —
 * docs/modulos/auth-multitenant.md §7b). Ver docstring de OnboardingService
 * para el detalle del flujo y por qué NO se usan invitaciones nativas.
 */
@ApiTags('Onboarding (Multi-tenant)')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT/sesión inválida o expirada' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

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
  @ApiResponse({ status: 201, description: 'Condominio y administrador creados exitosamente' })
  createCondominium(@Body() dto: CreateCondominiumDto) {
    return this.onboardingService.createCondominium(dto);
  }

  @Post('members')
  // Mismo permiso que ya usa la gestión de usuarios existente
  // (asignado a "Administrador" en default-roles.constant.ts) — el scoping
  // por tenant (a qué condominio se agrega el usuario) lo resuelve
  // TenantContextService a partir de la membresía del caller, no el body.
  @RequirePermissions('users.create')
  @ApiOperation({
    summary: 'Crear/dar de alta un usuario en MI condominio (admin de condominio)',
    description:
      'Crea un usuario (residente, conserje) dentro del condominio del Administrador autenticado.',
  })
  @ApiResponse({ status: 201, description: 'Usuario creado y agregado al condominio' })
  createMember(@Body() dto: CreateCondominiumMemberDto) {
    return this.onboardingService.createCondominiumMember(dto);
  }
}
