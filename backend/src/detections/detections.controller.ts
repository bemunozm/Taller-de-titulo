import { Controller, Post, Body, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { DetectionsService } from './detections.service';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { CreateAccessAttemptDto } from './dto/create-access-attempt.dto';

@ApiTags('Detecciones')
@Controller('detections')
export class DetectionsController {
  constructor(private readonly plates: DetectionsService) {}

  // Plate-specific endpoints
  @Post('plates')
  @ApiOperation({ summary: 'Crear detección de patente', description: 'Registra una detección de placa proveniente del worker LPR.' })
  @ApiBody({ type: CreatePlateDetectionDto })
  @ApiResponse({ status: 201, description: 'Detección creada correctamente' })
  createDetection(@Body() dto: CreatePlateDetectionDto) {
    return this.plates.createDetection(dto);
  }

  @Get('plates')
  @ApiOperation({ summary: 'Listar detecciones de patentes', description: 'Devuelve la lista de detecciones de placas registradas, con sus intentos de acceso relacionados.' })
  @ApiResponse({ status: 200, description: 'Lista de detecciones' })
  listDetections() {
    return this.plates.listDetections();
  }

  // Attempts for plates
  @Post('plates/attempts')
  @ApiOperation({ summary: 'Registrar intento de acceso', description: 'Guarda la decisión tomada (allow/deny) asociada a una detección previamente registrada.' })
  @ApiBody({ type: CreateAccessAttemptDto })
  @ApiResponse({ status: 201, description: 'Intento creado' })
  createAttempt(@Body() dto: CreateAccessAttemptDto) {
    return this.plates.createAttempt(dto);
  }

  @Get('plates/attempts')
  @ApiOperation({ summary: 'Listar intentos de acceso', description: 'Lista los intentos de acceso registrados y la detección asociada.' })
  @ApiResponse({ status: 200, description: 'Lista de intentos' })
  listAttempts() {
    return this.plates.listAttempts();
  }
}
