import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { CreateBulkUnitsDto } from './dto/create-bulk-units.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { HubAuthGuard } from '../hub/guards/hub-auth.guard';
import type { AuthenticatedHub } from '../hub/guards/hub-auth.guard';
import {
  CurrentActor,
  canViewWholeCondominium,
  type TenantActor,
} from '../common/tenant/tenant-actor';
import { embeddedUserFor } from '../users/user-summary';
import type { Unit } from './entities/unit.entity';

/** Request de `GET /units/ai-enabled` tras `HubAuthGuard`. */
interface HubRequest {
  hub?: AuthenticatedHub;
}

/**
 * Corrección P5 (cyber M2 / B3): los miembros de las familias de la unidad
 * solo se cargan con `condominium.view-all` y, para quien no ve el detalle
 * de usuarios (sin `users.update`), van como `{ id, name }`.
 */
function presentUnit(unit: Unit, actor: TenantActor): Unit {
  for (const family of unit.families ?? []) {
    if (family.members) {
      family.members = family.members.map((member) =>
        embeddedUserFor(member, actor),
      );
    }
  }
  return unit;
}

/**
 * Fase 4 · P5.B: antes la clase solo tenía `AuthGuard`, así que los
 * `@RequirePermissions` NO se evaluaban (y además nombraban permisos
 * inexistentes: `manage_units`/`view_units`). Ahora `AuthorizationGuard` y
 * los permisos reales `units.*` de `DEFAULT_PERMISSIONS`. Las lecturas y
 * escrituras se acotan al condominio del actor en `UnitsService`.
 */
@ApiTags('Units')
@ApiBearerAuth()
@UseGuards(AuthGuard, AuthorizationGuard)
@Controller('units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Post()
  @RequirePermissions('units.create')
  @ApiOperation({ summary: 'Crear nueva unidad' })
  @ApiResponse({ status: 201, description: 'Unidad creada exitosamente' })
  @ApiResponse({
    status: 409,
    description: 'Identificador de unidad duplicado',
  })
  create(@Body() createUnitDto: CreateUnitDto) {
    return this.unitsService.create(createUnitDto);
  }

  @Post('bulk')
  @RequirePermissions('units.create')
  @ApiOperation({ summary: 'Crear múltiples unidades en rango' })
  @ApiResponse({
    status: 201,
    description: 'Unidades creadas exitosamente',
    schema: {
      example: {
        created: [
          { id: 'uuid', identifier: 'A-101', block: 'A', number: '101' },
        ],
        skipped: ['A-105'],
        total: 10,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Rango inválido' })
  createBulk(@Body() createBulkUnitsDto: CreateBulkUnitsDto) {
    return this.unitsService.createBulk(createBulkUnitsDto);
  }

  @Get()
  @RequirePermissions('units.read')
  @ApiOperation({ summary: 'Obtener todas las unidades' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Lista de unidades' })
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.unitsService.findAll(includeInactive === 'true');
  }

  @Get('available')
  @RequirePermissions('units.view-available')
  @ApiOperation({
    summary: 'Obtener unidades disponibles (sin familia asignada)',
  })
  @ApiResponse({ status: 200, description: 'Lista de unidades disponibles' })
  findAvailable() {
    return this.unitsService.findAvailable();
  }

  @Get('stats')
  @RequirePermissions('units.view-stats')
  @ApiOperation({ summary: 'Obtener estadísticas de unidades' })
  @ApiResponse({ status: 200, description: 'Estadísticas de ocupación' })
  getStats() {
    return this.unitsService.getStats();
  }

  /**
   * Endpoint para sincronización de cache del Hub (Raspberry Pi).
   *
   * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgo H1
   * de la auditoría): antes validaba el header `X-Hub-Secret` a mano contra
   * un `HUB_SECRET` global compartido (sin `X-Hub-Id`, así que ni siquiera
   * sabía QUÉ hub llamaba). Ahora reusa `HubAuthGuard` — mismo mecanismo de
   * credenciales por-hub que `/concierge/*` — para consistencia (un solo
   * guard de credenciales de máquina de hub, no dos implementaciones
   * distintas del mismo concepto). `@Public()` sigue siendo necesario para
   * que el `AuthGuard` de clase (sesión humana) no bloquee esta ruta.
   */
  @Public()
  @UseGuards(HubAuthGuard)
  @Get('ai-enabled')
  @ApiOperation({
    summary: 'Obtener unidades con Conserje Digital habilitado (para Hub)',
  })
  @ApiHeader({
    name: 'X-Hub-Secret',
    description: 'Secret propio del Hub (provisionado vía POST /hubs)',
    required: true,
  })
  @ApiHeader({
    name: 'X-Hub-Id',
    description: 'Identificador del Hub físico',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de unidades con IA habilitada',
    schema: {
      example: [{ houseNumber: 'A-504', hasAI: true, familyId: 'uuid-123' }],
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Hub secret/hubId inválido o faltante',
  })
  async getAIEnabledUnits(@Req() req: HubRequest) {
    // P5.B: solo las unidades del condominio del hub autenticado (sin
    // condominio asignado → lista vacía).
    return this.unitsService.findWithAIEnabled(req.hub?.organizationId ?? null);
  }

  @Get('search')
  @RequirePermissions('units.search')
  @ApiOperation({ summary: 'Buscar unidades por término' })
  @ApiQuery({ name: 'term', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Resultados de búsqueda' })
  search(@Query('term') term: string) {
    return this.unitsService.search(term);
  }

  @Get('block/:block')
  @RequirePermissions('units.read')
  @ApiOperation({ summary: 'Obtener unidades por bloque' })
  @ApiResponse({ status: 200, description: 'Unidades del bloque especificado' })
  findByBlock(@Param('block') block: string) {
    return this.unitsService.findByBlock(block);
  }

  @Get('floor/:floor')
  @RequirePermissions('units.read')
  @ApiOperation({ summary: 'Obtener unidades por piso' })
  @ApiResponse({ status: 200, description: 'Unidades del piso especificado' })
  findByFloor(@Param('floor') floor: string) {
    return this.unitsService.findByFloor(parseInt(floor, 10));
  }

  @Get('identifier/:identifier')
  @RequirePermissions('units.read')
  @ApiOperation({ summary: 'Buscar unidad por identificador (ej: A-303)' })
  @ApiResponse({ status: 200, description: 'Unidad encontrada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  async findByIdentifier(
    @Param('identifier') identifier: string,
    @CurrentActor() actor: TenantActor,
  ) {
    const unit = await this.unitsService.findByIdentifier(identifier, {
      includeMembers: canViewWholeCondominium(actor),
    });
    return unit ? presentUnit(unit, actor) : unit;
  }

  @Get(':id')
  @RequirePermissions('units.read')
  @ApiOperation({ summary: 'Obtener unidad por ID' })
  @ApiResponse({ status: 200, description: 'Unidad encontrada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: TenantActor,
  ) {
    return presentUnit(
      await this.unitsService.findOne(id, {
        includeMembers: canViewWholeCondominium(actor),
      }),
      actor,
    );
  }

  @Patch(':id')
  @RequirePermissions('units.update')
  @ApiOperation({ summary: 'Actualizar unidad' })
  @ApiResponse({ status: 200, description: 'Unidad actualizada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'Identificador de unidad duplicado',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateUnitDto: UpdateUnitDto,
  ) {
    return this.unitsService.update(id, updateUnitDto);
  }

  @Delete(':id')
  @RequirePermissions('units.delete')
  @ApiOperation({ summary: 'Eliminar (desactivar) unidad' })
  @ApiResponse({ status: 200, description: 'Unidad desactivada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'No se puede eliminar unidad con familia asignada',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.unitsService.remove(id);
  }
}
