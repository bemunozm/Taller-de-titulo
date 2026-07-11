import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SystemLog, LogLevel, LogType, ServiceName } from './entities/system-log.entity';
import { CreateSystemLogDto } from './dto/create-system-log.dto';
import { GetLogsQueryDto } from './dto/get-logs-query.dto';

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private readonly retentionDays = 30; // Retención de logs por 30 días

  constructor(
    @InjectRepository(SystemLog)
    private readonly systemLogRepository: Repository<SystemLog>,
  ) {}

  /**
   * Crea un nuevo log de sistema de forma asíncrona
   * No bloquea la ejecución principal
   */
  async log(createLogDto: CreateSystemLogDto): Promise<void> {
    try {
      const log = this.systemLogRepository.create(createLogDto);
      await this.systemLogRepository.save(log);
    } catch (error) {
      // No queremos que un error al guardar logs rompa la aplicación
      this.logger.error(`Failed to save system log: ${error.message}`, error.stack);
    }
  }

  /**
   * Helper: Log de solicitud HTTP
   */
  async logHttpRequest(data: {
    service: ServiceName;
    method: string;
    url: string;
    requestData?: any;
    correlationId?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.log({
      level: LogLevel.INFO,
      type: LogType.HTTP_REQUEST,
      service: data.service,
      message: `${data.method} ${data.url}`,
      method: data.method,
      url: data.url,
      requestData: data.requestData,
      correlationId: data.correlationId,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
    });
  }

  /**
   * Helper: Log de respuesta HTTP
   */
  async logHttpResponse(data: {
    service: ServiceName;
    method: string;
    url: string;
    statusCode: number;
    responseTime: number;
    responseData?: any;
    correlationId?: string;
  }): Promise<void> {
    const level = data.statusCode >= 500 ? LogLevel.ERROR : 
                  data.statusCode >= 400 ? LogLevel.WARN : 
                  LogLevel.INFO;

    await this.log({
      level,
      type: LogType.HTTP_RESPONSE,
      service: data.service,
      message: `${data.method} ${data.url} - ${data.statusCode} (${data.responseTime}ms)`,
      method: data.method,
      url: data.url,
      statusCode: data.statusCode,
      responseTime: data.responseTime,
      responseData: data.responseData,
      correlationId: data.correlationId,
    });
  }

  /**
   * Helper: Log de error HTTP
   */
  async logHttpError(data: {
    service: ServiceName;
    method: string;
    url: string;
    error: Error;
    correlationId?: string;
    requestData?: any;
  }): Promise<void> {
    await this.log({
      level: LogLevel.ERROR,
      type: LogType.EXCEPTION,
      service: data.service,
      message: `HTTP Error: ${data.method} ${data.url}`,
      method: data.method,
      url: data.url,
      errorMessage: data.error.message,
      stackTrace: data.error.stack,
      correlationId: data.correlationId,
      requestData: data.requestData,
    });
  }

  /**
   * Helper: Log de comunicación con MediaMTX
   */
  async logMediaMTX(data: {
    action: string;
    success: boolean;
    details?: any;
    error?: Error;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      level: data.success ? LogLevel.INFO : LogLevel.ERROR,
      type: LogType.MEDIAMTX_API,
      service: ServiceName.MEDIAMTX,
      message: `MediaMTX: ${data.action} - ${data.success ? 'Success' : 'Failed'}`,
      metadata: data.details,
      errorMessage: data.error?.message,
      stackTrace: data.error?.stack,
      correlationId: data.correlationId,
    });
  }

  /**
   * Helper: Log de comunicación con Worker Python
   */
  async logWorkerAPI(data: {
    action: string;
    cameraId?: string;
    success: boolean;
    details?: any;
    error?: Error;
    correlationId?: string;
  }): Promise<void> {
    await this.log({
      level: data.success ? LogLevel.INFO : LogLevel.ERROR,
      type: LogType.WORKER_API,
      service: ServiceName.WORKER_PYTHON,
      message: `Worker: ${data.action} - ${data.success ? 'Success' : 'Failed'}`,
      metadata: { cameraId: data.cameraId, ...data.details },
      errorMessage: data.error?.message,
      stackTrace: data.error?.stack,
      correlationId: data.correlationId,
    });
  }

  /**
   * Helper: Log de detección de vehículos
   */
  async logDetection(data: {
    cameraId: string;
    licensePlate?: string;
    confidence?: number;
    processingTime?: number;
    metadata?: any;
  }): Promise<void> {
    await this.log({
      level: LogLevel.INFO,
      type: LogType.DETECTION,
      service: ServiceName.WORKER_PYTHON,
      message: `Detection: ${data.licensePlate || 'No plate'} (${data.confidence ? (data.confidence * 100).toFixed(1) : 0}%)`,
      responseTime: data.processingTime,
      metadata: {
        cameraId: data.cameraId,
        licensePlate: data.licensePlate,
        confidence: data.confidence,
        ...data.metadata,
      },
    });
  }

  /**
   * Obtener logs con filtros y paginación
   */
  async getLogs(query: GetLogsQueryDto) {
    const { page = 1, limit = 50, search, startDate, endDate, ...filters } = query;

    const queryBuilder = this.systemLogRepository.createQueryBuilder('log');

    // Aplicar filtros
    if (filters.level) {
      queryBuilder.andWhere('log.level = :level', { level: filters.level });
    }

    if (filters.type) {
      queryBuilder.andWhere('log.type = :type', { type: filters.type });
    }

    if (filters.service) {
      queryBuilder.andWhere('log.service = :service', { service: filters.service });
    }

    if (filters.statusCode) {
      queryBuilder.andWhere('log.statusCode = :statusCode', { statusCode: filters.statusCode });
    }

    if (filters.correlationId) {
      queryBuilder.andWhere('log.correlationId = :correlationId', { correlationId: filters.correlationId });
    }

    if (search) {
      queryBuilder.andWhere(
        '(log.message ILIKE :search OR log.url ILIKE :search OR log.errorMessage ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    if (startDate && endDate) {
      queryBuilder.andWhere('log.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });
    } else if (startDate) {
      queryBuilder.andWhere('log.createdAt >= :startDate', { startDate: new Date(startDate) });
    } else if (endDate) {
      queryBuilder.andWhere('log.createdAt <= :endDate', { endDate: new Date(endDate) });
    }

    // Ordenar por fecha descendente
    queryBuilder.orderBy('log.createdAt', 'DESC');

    // Paginación
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Obtener estadísticas de logs
   */
  async getStats(startDate?: string, endDate?: string) {
    const queryBuilder = this.systemLogRepository.createQueryBuilder('log');

    if (startDate && endDate) {
      queryBuilder.where('log.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });
    } else if (startDate) {
      queryBuilder.where('log.createdAt >= :startDate', { startDate: new Date(startDate) });
    } else if (endDate) {
      queryBuilder.where('log.createdAt <= :endDate', { endDate: new Date(endDate) });
    }

    const [
      total,
      byLevel,
      byType,
      byService,
      errorLogs,
      avgResponseTime,
    ] = await Promise.all([
      queryBuilder.getCount(),
      this.getGroupedCount('level', startDate, endDate),
      this.getGroupedCount('type', startDate, endDate),
      this.getGroupedCount('service', startDate, endDate),
      this.getErrorCount(startDate, endDate),
      this.getAverageResponseTime(startDate, endDate),
    ]);

    return {
      totalLogs: total,
      errorCount: errorLogs,
      averageResponseTime: avgResponseTime,
      byLevel,
      byType,
      byService,
    };
  }

  private async getGroupedCount(field: string, startDate?: string, endDate?: string) {
    const queryBuilder = this.systemLogRepository
      .createQueryBuilder('log')
      .select(`log.${field}`, 'key')
      .addSelect('COUNT(*)', 'count')
      .groupBy(`log.${field}`);

    if (startDate && endDate) {
      queryBuilder.where('log.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });
    } else if (startDate) {
      queryBuilder.where('log.createdAt >= :startDate', { startDate: new Date(startDate) });
    } else if (endDate) {
      queryBuilder.where('log.createdAt <= :endDate', { endDate: new Date(endDate) });
    }

    const results = await queryBuilder.getRawMany();
    return results.reduce((acc, { key, count }) => {
      acc[key] = parseInt(count);
      return acc;
    }, {});
  }

  private async getErrorCount(startDate?: string, endDate?: string): Promise<number> {
    const queryBuilder = this.systemLogRepository
      .createQueryBuilder('log')
      .where('log.level IN (:...levels)', { levels: [LogLevel.ERROR, LogLevel.FATAL] });

    if (startDate && endDate) {
      queryBuilder.andWhere('log.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });
    } else if (startDate) {
      queryBuilder.andWhere('log.createdAt >= :startDate', { startDate: new Date(startDate) });
    } else if (endDate) {
      queryBuilder.andWhere('log.createdAt <= :endDate', { endDate: new Date(endDate) });
    }

    return queryBuilder.getCount();
  }

  private async getAverageResponseTime(startDate?: string, endDate?: string): Promise<number> {
    const queryBuilder = this.systemLogRepository
      .createQueryBuilder('log')
      .select('AVG(log.responseTime)', 'avg')
      .where('log.responseTime IS NOT NULL');

    if (startDate && endDate) {
      queryBuilder.andWhere('log.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });
    } else if (startDate) {
      queryBuilder.andWhere('log.createdAt >= :startDate', { startDate: new Date(startDate) });
    } else if (endDate) {
      queryBuilder.andWhere('log.createdAt <= :endDate', { endDate: new Date(endDate) });
    }

    const result = await queryBuilder.getRawOne();
    return result?.avg ? Math.round(parseFloat(result.avg)) : 0;
  }

  /**
   * Limpieza automática de logs antiguos
   * Se ejecuta diariamente a las 3 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldLogs() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

      const result = await this.systemLogRepository
        .createQueryBuilder()
        .delete()
        .where('createdAt < :cutoffDate', { cutoffDate })
        .execute();

      this.logger.log(`Cleaned up ${result.affected} old logs (older than ${this.retentionDays} days)`);
    } catch (error) {
      this.logger.error(`Failed to cleanup old logs: ${error.message}`, error.stack);
    }
  }
}
