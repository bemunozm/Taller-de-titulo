import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
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
import { CreateHubDto } from './dto/create-hub.dto';
import { UpdateHubDto } from './dto/update-hub.dto';
import { HubsService } from './hub.service';

/**
 * Provisioning/gestión de hubs físicos (Fase 1, Bloque A1.1 —
 * docs/modulos/agente-cerebro.md §7/§11, hallazgo H1). Sesión humana
 * (AuthGuard) + RBAC — exclusivo de plataforma, igual que
 * `OnboardingController` para condominios. NO confundir con `HubAuthGuard`
 * (credenciales de MÁQUINA del hub físico contra `/concierge/*` y
 * `/units/ai-enabled`) ni con el handshake WS de `HubGateway`.
 */
@ApiTags('Hubs (Fase 1)')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT/sesión inválida o expirada' })
@ApiForbiddenResponse({ description: 'No tiene permisos suficientes para esta operación' })
@Controller('hubs')
export class HubController {
  constructor(private readonly hubsService: HubsService) {}

  @Post()
  @RequirePermissions('platform.manage-hubs')
  @ApiOperation({
    summary: 'Provisionar un hub físico (super-admin)',
    description:
      'Crea el hub y genera su secret propio — se devuelve en TEXTO PLANO una única vez en la respuesta; el backend solo guarda su hash.',
  })
  @ApiResponse({ status: 201, description: 'Hub provisionado exitosamente (incluye el secret en claro)' })
  @ApiResponse({ status: 409, description: 'Ya existe un hub con ese hubId' })
  provision(@Body() dto: CreateHubDto) {
    return this.hubsService.provision(dto);
  }

  @Get()
  @RequirePermissions('platform.manage-hubs')
  @ApiOperation({ summary: 'Listar hubs físicos (super-admin)' })
  @ApiResponse({ status: 200, description: 'Lista de hubs (sin el hash del secret)' })
  findAll() {
    return this.hubsService.findAll();
  }

  @Get(':hubId')
  @RequirePermissions('platform.manage-hubs')
  @ApiOperation({ summary: 'Obtener un hub por hubId (super-admin)' })
  @ApiResponse({ status: 200, description: 'Hub encontrado' })
  @ApiResponse({ status: 404, description: 'Hub no encontrado' })
  findOne(@Param('hubId') hubId: string) {
    return this.hubsService.findByHubId(hubId);
  }

  @Patch(':hubId')
  @RequirePermissions('platform.manage-hubs')
  @ApiOperation({ summary: 'Actualizar un hub (super-admin)' })
  @ApiResponse({ status: 200, description: 'Hub actualizado' })
  @ApiResponse({ status: 404, description: 'Hub no encontrado' })
  update(@Param('hubId') hubId: string, @Body() dto: UpdateHubDto) {
    return this.hubsService.update(hubId, dto);
  }

  @Post(':hubId/rotate-secret')
  @RequirePermissions('platform.manage-hubs')
  @ApiOperation({
    summary: 'Rotar el secret de un hub (super-admin)',
    description: 'Invalida el secret anterior y genera uno nuevo — se devuelve en texto plano una única vez.',
  })
  @ApiResponse({ status: 200, description: 'Secret rotado exitosamente (incluye el nuevo secret en claro)' })
  @ApiResponse({ status: 404, description: 'Hub no encontrado' })
  rotateSecret(@Param('hubId') hubId: string) {
    return this.hubsService.rotateSecret(hubId);
  }
}
