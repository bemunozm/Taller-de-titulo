import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';

@ApiTags('Vehicles')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly svc: VehiclesService) {}

  @Post()
  @ApiOperation({ summary: 'Registrar vehículo' })
  @ApiBody({ type: CreateVehicleDto })
  @ApiResponse({ status: 201, description: 'Vehículo creado' })
  create(@Body() dto: CreateVehicleDto) {
    return this.svc.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar vehículos' })
  list() {
    return this.svc.listAll();
  }

  @Get('plate/:plate')
  @ApiOperation({ summary: 'Buscar vehículo por patente' })
  findByPlate(@Param('plate') plate: string) {
    return this.svc.findByPlate(plate);
  }
}
