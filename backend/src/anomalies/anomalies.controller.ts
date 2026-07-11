import { Controller, Post, Body, HttpCode, HttpStatus, Get, Param } from '@nestjs/common';
import { AnomaliesService } from './anomalies.service';

@Controller('anomalies')
export class AnomaliesController {
  constructor(private readonly anomaliesService: AnomaliesService) {}

  @Get()
  async getAnomalies() {
    return await this.anomaliesService.findAll();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async handleAnomaly(@Body() payload: any) {
    return await this.anomaliesService.createAnomaly(payload);
  }

  @Get('cameras/:id/zones')
  async getCameraZones(@Param('id') id: string) {
    return await this.anomaliesService.getCameraZones(id);
  }
}
