import { Controller, Post, Body, HttpCode, HttpStatus, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AnomaliesService } from './anomalies.service';
import { ServiceApiKeyGuard } from '../auth/guards/service-api-key.guard';

// Tarea #21 (docs/modulos/auth-multitenant.md §11+): estos endpoints los
// consume el worker LPR (ingesta de anomalías) — protegidos con la API key de
// servicio (header x-api-key, ver ServiceApiKeyGuard). `getCameraZones` no se
// protege: es consultado hoy sin evidencia de uso por worker ni por
// frontend autenticado; queda fuera del scope de este hardening (ver reporte).
@ApiTags('Anomalías')
@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomaliesService: AnomaliesService) {}

  @Get()
  @UseGuards(ServiceApiKeyGuard)
  @ApiOperation({ summary: 'Listar anomalías', description: 'Requiere API key de servicio (header x-api-key).' })
  @ApiResponse({ status: 200, description: 'Lista de anomalías' })
  @ApiUnauthorizedResponse({ description: 'API key de servicio inválida, expirada o ausente' })
  async getAnomalies() {
    return await this.anomaliesService.findAll();
  }

  @Post()
  @UseGuards(ServiceApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar anomalía', description: 'Registra una anomalía detectada por el worker LPR. Requiere API key de servicio (header x-api-key).' })
  @ApiResponse({ status: 201, description: 'Anomalía registrada correctamente' })
  @ApiUnauthorizedResponse({ description: 'API key de servicio inválida, expirada o ausente' })
  async handleAnomaly(@Body() payload: any) {
    return await this.anomaliesService.createAnomaly(payload);
  }

  @Get('cameras/:id/zones')
  async getCameraZones(@Param('id') id: string) {
    return await this.anomaliesService.getCameraZones(id);
  }
}
