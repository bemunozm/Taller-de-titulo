import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import {
  DashboardQueryDto,
  VisitsTrendQueryDto,
  RecentActivityQueryDto,
  DetectionsQueryDto,
} from './dto/dashboard-query.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(AuthGuard, AuthorizationGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener resumen completo del dashboard' })
  @ApiResponse({ status: 200, description: 'Resumen del dashboard obtenido exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos suficientes' })
  async getSummary(@Query() query: DashboardQueryDto) {
    return await this.dashboardService.getDashboardSummary(query);
  }

  @Get('visits/trend')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener tendencia de visitas por días' })
  @ApiResponse({ status: 200, description: 'Tendencia de visitas obtenida exitosamente' })
  @ApiQuery({ name: 'days', required: false, type: Number, description: 'Número de días (1-90)', example: 7 })
  async getVisitsTrend(@Query() query: VisitsTrendQueryDto) {
    return await this.dashboardService.getVisitsTrend(query);
  }

  @Get('activity/recent')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener actividad reciente del sistema' })
  @ApiResponse({ status: 200, description: 'Actividad reciente obtenida exitosamente' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Límite de items (1-50)', example: 10 })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['detection', 'visit', 'audit', 'error', 'notification'],
    description: 'Filtrar por tipo',
  })
  async getRecentActivity(@Query() query: RecentActivityQueryDto) {
    return await this.dashboardService.getRecentActivity(query);
  }

  @Get('detections/latest')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener últimas detecciones con detalles' })
  @ApiResponse({ status: 200, description: 'Detecciones obtenidas exitosamente' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Límite de detecciones (1-100)', example: 10 })
  @ApiQuery({ name: 'matchedOnly', required: false, type: Boolean, description: 'Solo mostrar con match', example: false })
  async getLatestDetections(@Query() query: DetectionsQueryDto) {
    return await this.dashboardService.getLatestDetections(query);
  }

  @Get('detections/hourly')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener distribución de detecciones por hora del día' })
  @ApiResponse({ status: 200, description: 'Distribución horaria obtenida exitosamente' })
  async getDetectionsByHour() {
    return await this.dashboardService.getDetectionsByHour();
  }

  @Get('cameras/activity')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener actividad de detecciones por cámara' })
  @ApiResponse({ status: 200, description: 'Actividad de cámaras obtenida exitosamente' })
  async getCameraActivity() {
    return await this.dashboardService.getCameraActivity();
  }

  @Get('visits/distribution')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener distribución de tipos de visitas' })
  @ApiResponse({ status: 200, description: 'Distribución de visitas obtenida exitosamente' })
  async getVisitTypeDistribution() {
    return await this.dashboardService.getVisitTypeDistribution();
  }

  @Get('errors/trends')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener tendencias de errores por servicio' })
  @ApiResponse({ status: 200, description: 'Tendencias de errores obtenidas exitosamente' })
  async getErrorTrends() {
    return await this.dashboardService.getErrorTrends();
  }

  @Get('metrics/response-time')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener métricas detalladas del tiempo de respuesta del sistema' })
  @ApiResponse({ 
    status: 200, 
    description: 'Métricas de tiempo de respuesta obtenidas exitosamente',
    schema: {
      type: 'object',
      properties: {
        avgResponseTimeMs: { type: 'number', description: 'Tiempo promedio en milisegundos' },
        minResponseTimeMs: { type: 'number', description: 'Tiempo mínimo en milisegundos' },
        maxResponseTimeMs: { type: 'number', description: 'Tiempo máximo en milisegundos' },
        medianResponseTimeMs: { type: 'number', description: 'Mediana en milisegundos' },
        totalDetections: { type: 'number', description: 'Total de detecciones procesadas' },
        detectionsUnder5s: { type: 'number', description: 'Detecciones procesadas en menos de 5 segundos' },
        complianceRate: { type: 'number', description: 'Porcentaje de cumplimiento del SLA de 5 segundos' },
        byDecision: {
          type: 'object',
          description: 'Tiempo promedio por tipo de decisión',
          properties: {
            Permitido: { type: 'number' },
            Denegado: { type: 'number' },
            Pendiente: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month', 'custom'], description: 'Período de tiempo', example: 'today' })
  async getResponseTimeMetrics(@Query() query: DashboardQueryDto) {
    return await this.dashboardService.getResponseTimeMetrics(query);
  }

  @Get('metrics/response-time/detailed')
  @RequirePermissions('admin.dashboard')
  @ApiOperation({ summary: 'Obtener detalle de cada detección con tiempo de respuesta para exportación' })
  @ApiResponse({ 
    status: 200, 
    description: 'Detalle de detecciones con tiempo de respuesta',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          detectionId: { type: 'string' },
          plate: { type: 'string' },
          cameraId: { type: 'string' },
          detectionCreatedAt: { type: 'string', format: 'date-time' },
          decision: { type: 'string' },
          method: { type: 'string' },
          attemptCreatedAt: { type: 'string', format: 'date-time' },
          responseTimeMs: { type: 'number' },
          detConfidence: { type: 'number' },
          ocrConfidence: { type: 'number' },
        },
      },
    },
  })
  @ApiQuery({ name: 'period', required: false, enum: ['today', 'week', 'month', 'custom'], description: 'Período de tiempo', example: 'today' })
  async getResponseTimeDetailed(@Query() query: DashboardQueryDto) {
    return await this.dashboardService.getResponseTimeDetailed(query);
  }
}
