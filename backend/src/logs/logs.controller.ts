import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LogsService } from './logs.service';
import { GetLogsQueryDto } from './dto/get-logs-query.dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@ApiTags('System Logs')
@Controller('logs')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  @RequirePermissions('logs.read')
  @ApiOperation({
    summary: 'Obtener logs del sistema',
    description: 'Retorna logs filtrados de comunicación entre servicios, APIs externas y eventos del sistema'
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de logs paginada',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'uuid-123' },
              level: { type: 'string', example: 'INFO' },
              type: { type: 'string', example: 'HTTP_REQUEST' },
              service: { type: 'string', example: 'MEDIAMTX' },
              message: { type: 'string', example: 'POST /v3/paths/add - 200 (150ms)' },
              statusCode: { type: 'number', example: 200 },
              responseTime: { type: 'number', example: 150 },
              createdAt: { type: 'string', example: '2024-12-01T10:30:00Z' }
            }
          }
        },
        total: { type: 'number', example: 1523 },
        page: { type: 'number', example: 1 },
        limit: { type: 'number', example: 50 },
        totalPages: { type: 'number', example: 31 }
      }
    }
  })
  getLogs(@Query() query: GetLogsQueryDto) {
    return this.logsService.getLogs(query);
  }

  @Get('stats')
  @RequirePermissions('logs.read')
  @ApiOperation({
    summary: 'Obtener estadísticas de logs',
    description: 'Retorna estadísticas agregadas de logs del sistema'
  })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas de logs',
    schema: {
      type: 'object',
      properties: {
        totalLogs: { type: 'number', example: 15234 },
        errorCount: { type: 'number', example: 45 },
        averageResponseTime: { type: 'number', example: 125 },
        byLevel: {
          type: 'object',
          example: { INFO: 12000, WARN: 2189, ERROR: 45 }
        },
        byType: {
          type: 'object',
          example: { HTTP_REQUEST: 5000, HTTP_RESPONSE: 5000, MEDIAMTX_API: 3000 }
        },
        byService: {
          type: 'object',
          example: { BACKEND: 8000, MEDIAMTX: 4000, WORKER_PYTHON: 3234 }
        }
      }
    }
  })
  getStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.logsService.getStats(startDate, endDate);
  }
}
