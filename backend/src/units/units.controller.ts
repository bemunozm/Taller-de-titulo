import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UnitsService } from './units.service';
import { CreateUnitDto } from './dto/create-unit.dto';
import { UpdateUnitDto } from './dto/update-unit.dto';
import { CreateBulkUnitsDto } from './dto/create-bulk-units.dto';
import { AuthGuard } from '../auth/auth.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('Units')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @Post()
  @RequirePermissions('manage_units')
  @ApiOperation({ summary: 'Crear nueva unidad' })
  @ApiResponse({ status: 201, description: 'Unidad creada exitosamente' })
  @ApiResponse({ status: 409, description: 'Identificador de unidad duplicado' })
  create(@Body() createUnitDto: CreateUnitDto) {
    return this.unitsService.create(createUnitDto);
  }

  @Post('bulk')
  @RequirePermissions('manage_units')
  @ApiOperation({ summary: 'Crear múltiples unidades en rango' })
  @ApiResponse({ 
    status: 201, 
    description: 'Unidades creadas exitosamente',
    schema: {
      example: {
        created: [{ id: 'uuid', identifier: 'A-101', block: 'A', number: '101' }],
        skipped: ['A-105'],
        total: 10
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Rango inválido' })
  createBulk(@Body() createBulkUnitsDto: CreateBulkUnitsDto) {
    return this.unitsService.createBulk(createBulkUnitsDto);
  }

  @Get()
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Obtener todas las unidades' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Lista de unidades' })
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.unitsService.findAll(includeInactive === 'true');
  }

  @Get('available')
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Obtener unidades disponibles (sin familia asignada)' })
  @ApiResponse({ status: 200, description: 'Lista de unidades disponibles' })
  findAvailable() {
    return this.unitsService.findAvailable();
  }

  @Get('stats')
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Obtener estadísticas de unidades' })
  @ApiResponse({ status: 200, description: 'Estadísticas de ocupación' })
  getStats() {
    return this.unitsService.getStats();
  }

  @Get('search')
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Buscar unidades por término' })
  @ApiQuery({ name: 'term', required: true, type: String })
  @ApiResponse({ status: 200, description: 'Resultados de búsqueda' })
  search(@Query('term') term: string) {
    return this.unitsService.search(term);
  }

  @Get('block/:block')
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Obtener unidades por bloque' })
  @ApiResponse({ status: 200, description: 'Unidades del bloque especificado' })
  findByBlock(@Param('block') block: string) {
    return this.unitsService.findByBlock(block);
  }

  @Get('floor/:floor')
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Obtener unidades por piso' })
  @ApiResponse({ status: 200, description: 'Unidades del piso especificado' })
  findByFloor(@Param('floor') floor: string) {
    return this.unitsService.findByFloor(parseInt(floor, 10));
  }

  @Get('identifier/:identifier')
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Buscar unidad por identificador (ej: A-303)' })
  @ApiResponse({ status: 200, description: 'Unidad encontrada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  findByIdentifier(@Param('identifier') identifier: string) {
    return this.unitsService.findByIdentifier(identifier);
  }

  @Get(':id')
  @RequirePermissions('view_units')
  @ApiOperation({ summary: 'Obtener unidad por ID' })
  @ApiResponse({ status: 200, description: 'Unidad encontrada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  findOne(@Param('id') id: string) {
    return this.unitsService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('manage_units')
  @ApiOperation({ summary: 'Actualizar unidad' })
  @ApiResponse({ status: 200, description: 'Unidad actualizada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  @ApiResponse({ status: 409, description: 'Identificador de unidad duplicado' })
  update(@Param('id') id: string, @Body() updateUnitDto: UpdateUnitDto) {
    return this.unitsService.update(id, updateUnitDto);
  }

  @Delete(':id')
  @RequirePermissions('manage_units')
  @ApiOperation({ summary: 'Eliminar (desactivar) unidad' })
  @ApiResponse({ status: 200, description: 'Unidad desactivada' })
  @ApiResponse({ status: 404, description: 'Unidad no encontrada' })
  @ApiResponse({ status: 409, description: 'No se puede eliminar unidad con familia asignada' })
  remove(@Param('id') id: string) {
    return this.unitsService.remove(id);
  }
}
