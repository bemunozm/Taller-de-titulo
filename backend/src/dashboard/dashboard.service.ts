import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, IsNull, In } from 'typeorm';
import { PlateDetection } from '../detections/entities/plate-detection.entity';
import { Visit, VisitStatus, VisitType } from '../visits/entities/visit.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { User } from '../users/entities/user.entity';
import { Family } from '../families/entities/family.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { SystemLog, LogLevel } from '../logs/entities/system-log.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import {
  DashboardSummary,
  SecurityStats,
  SystemHealthStats,
  UserActivityStats,
  PerformanceTrendData,
  DetectionHourlyData,
  CameraActivityData,
  RecentActivityItem,
  VisitTypeDistribution,
  ErrorTrendData,
  ServiceHealth,
} from './entities/dashboard-stats.entity';
import { DashboardQueryDto, VisitsTrendQueryDto, RecentActivityQueryDto, DetectionsQueryDto } from './dto/dashboard-query.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(PlateDetection)
    private detectionsRepository: Repository<PlateDetection>,
    @InjectRepository(Visit)
    private visitsRepository: Repository<Visit>,
    @InjectRepository(Camera)
    private camerasRepository: Repository<Camera>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Family)
    private familiesRepository: Repository<Family>,
    @InjectRepository(AuditLog)
    private auditRepository: Repository<AuditLog>,
    @InjectRepository(SystemLog)
    private logsRepository: Repository<SystemLog>,
    @InjectRepository(Vehicle)
    private vehiclesRepository: Repository<Vehicle>,
  ) {}

  /**
   * Obtiene el resumen completo del dashboard
   */
  async getDashboardSummary(query: DashboardQueryDto): Promise<DashboardSummary> {
    try {
      const { startDate, endDate } = this.getDateRange(query.period || 'today', query.startDate, query.endDate);

      this.logger.log(`Generando dashboard summary para período: ${query.period || 'today'}`);
      this.logger.debug(`Rango de fechas: ${startDate.toISOString()} - ${endDate.toISOString()}`);

      const [security, systemHealth, userActivity] = await Promise.all([
        this.getSecurityStats(startDate, endDate),
        this.getSystemHealthStats(),
        this.getUserActivityStats(startDate, endDate),
      ]);

      return {
        security,
        systemHealth,
        userActivity,
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.logger.error('Error al generar dashboard summary:', error);
      this.logger.error('Stack trace:', error.stack);
      throw error;
    }
  }

  /**
   * Estadísticas de seguridad
   */
  private async getSecurityStats(startDate: Date, endDate: Date): Promise<SecurityStats> {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      this.logger.debug('Obteniendo estadísticas de seguridad...');

      // Calcular métricas que se usan en el Promise.all
      const avgVisitDuration = await this.calculateAvgVisitDuration(todayStart, endDate);
      const avgResponseTime = await this.calculateAvgResponseTime(startDate, endDate);

      const [
        detectionsToday,
        detectionsWeek,
        detectionsMonth,
        activeVisits,
        pendingVisits,
        completedVisitsToday,
        unauthorizedVehicles,
      ] = await Promise.all([
        this.detectionsRepository.count({
          where: { createdAt: MoreThanOrEqual(todayStart) },
        }),
        this.detectionsRepository.count({
          where: { createdAt: MoreThanOrEqual(weekStart) },
        }),
        this.detectionsRepository.count({
          where: { createdAt: MoreThanOrEqual(monthStart) },
        }),
        this.visitsRepository.count({
          where: { status: VisitStatus.ACTIVE },
        }),
        // Contar visitas pendientes (nunca han ingresado) + listas para reingresar
        this.visitsRepository.count({
          where: { 
            status: In([VisitStatus.PENDING, VisitStatus.READY_FOR_REENTRY]) 
          },
        }),
        this.visitsRepository.count({
          where: {
            status: VisitStatus.COMPLETED,
            exitTime: MoreThanOrEqual(todayStart),
          },
        }),
        this.detectionsRepository.count({
          where: {
            createdAt: MoreThanOrEqual(todayStart),
          },
        }),

      ]);

      const alertsPending = pendingVisits + (unauthorizedVehicles > 5 ? 1 : 0);

      return {
        detectionsToday,
        detectionsWeek,
        detectionsMonth,
        activeVisits,
        pendingVisits,
        completedVisitsToday,
        unauthorizedVehicles,
        alertsPending,
        avgVisitDuration,
        avgResponseTime: avgResponseTime || 0,
      };
    } catch (error) {
      this.logger.error('Error al obtener estadísticas de seguridad:', error);
      throw error;
    }
  }

  /**
   * Estadísticas de salud del sistema
   */
  private async getSystemHealthStats(): Promise<SystemHealthStats> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      camerasActive,
      camerasTotal,
      totalLogsToday,
      criticalErrorsToday,
      avgDetectionConfidence,
    ] = await Promise.all([
      this.camerasRepository.count({ where: { active: true } }),
      this.camerasRepository.count(),
      this.logsRepository.count({ where: { createdAt: MoreThanOrEqual(last24h) } }),
      this.logsRepository.count({
        where: {
          level: LogLevel.ERROR,
          createdAt: MoreThanOrEqual(last24h),
        },
      }),
      this.calculateAvgDetectionConfidence(last24h),
    ]);

    const camerasInactive = camerasTotal - camerasActive;
    const errorRateLast24h = totalLogsToday > 0 ? (criticalErrorsToday / totalLogsToday) * 100 : 0;

    // Obtener estado de servicios
    const services = await this.getServicesHealth();

    return {
      camerasActive,
      camerasTotal,
      camerasInactive,
      errorRateLast24h: Number(errorRateLast24h.toFixed(2)),
      avgResponseTime: avgDetectionConfidence, // Reutilizando el campo para confianza promedio
      totalLogsToday,
      criticalErrorsToday,
      services,
    };
  }

  /**
   * Estadísticas de actividad de usuarios
   */
  private async getUserActivityStats(startDate: Date, endDate: Date): Promise<UserActivityStats> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      activeFamilies,
      totalFamilies,
      totalUsers,
      activeUsersToday,
      activeUsersWeek,
      newUsersThisWeek,
      topAuditActions,
    ] = await Promise.all([
      this.familiesRepository.count({ where: { active: true } }),
      this.familiesRepository.count(),
      this.usersRepository.count({ where: { deletedAt: IsNull() } }),
      this.getActiveUsersCount(todayStart, endDate),
      this.getActiveUsersCount(weekStart, endDate),
      this.usersRepository.count({
        where: {
          createdAt: MoreThanOrEqual(weekStart),
        },
      }),
      this.getTopAuditActions(5),
    ]);

    return {
      activeFamilies,
      totalFamilies,
      totalUsers,
      activeUsersToday,
      activeUsersWeek,
      newUsersThisWeek,
      topAuditActions,
      notificationsSentToday: 0,
      conciergeSessionsToday: 0,
    };
  }

  /**
   * Tendencia de visitas por días
   */
  async getVisitsTrend(query: VisitsTrendQueryDto): Promise<PerformanceTrendData[]> {
    const days = query.days || 7;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    const visits = await this.visitsRepository
      .createQueryBuilder('visit')
      .select("TO_CHAR(visit.\"createdAt\", 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'visits')
      .addSelect("SUM(CASE WHEN visit.type = :vehicular THEN 1 ELSE 0 END)", 'vehicular')
      .addSelect("SUM(CASE WHEN visit.type = :pedestrian THEN 1 ELSE 0 END)", 'pedestrian')
      .where('visit.\"createdAt\" >= :startDate', { startDate })
      .andWhere('visit.\"createdAt\" <= :endDate', { endDate })
      .setParameter('vehicular', VisitType.VEHICULAR)
      .setParameter('pedestrian', VisitType.PEDESTRIAN)
      .groupBy("TO_CHAR(visit.\"createdAt\", 'YYYY-MM-DD')")
      .orderBy('date', 'ASC')
      .getRawMany();

    const detections = await this.detectionsRepository
      .createQueryBuilder('detection')
      .select("TO_CHAR(detection.\"createdAt\", 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'detections')
      .where('detection.\"createdAt\" >= :startDate', { startDate })
      .andWhere('detection.\"createdAt\" <= :endDate', { endDate })
      .groupBy("TO_CHAR(detection.\"createdAt\", 'YYYY-MM-DD')")
      .getRawMany();

    const logs = await this.logsRepository
      .createQueryBuilder('log')
      .select("TO_CHAR(log.created_at, 'YYYY-MM-DD')", 'date')
      .addSelect('AVG(log.\"responseTime\")', 'avgResponseTime')
      .where('log.created_at >= :startDate', { startDate })
      .andWhere('log.created_at <= :endDate', { endDate })
      .andWhere('log.\"responseTime\" IS NOT NULL')
      .groupBy("TO_CHAR(log.created_at, 'YYYY-MM-DD')")
      .getRawMany();

    // Combinar datos
    const dataMap = new Map<string, PerformanceTrendData>();

    visits.forEach((v) => {
      dataMap.set(v.date, {
        date: v.date,
        visits: parseInt(v.visits),
        vehicular: parseInt(v.vehicular),
        pedestrian: parseInt(v.pedestrian),
        detections: 0,
        avgResponseTime: 0,
      });
    });

    detections.forEach((d) => {
      const existing = dataMap.get(d.date);
      if (existing) {
        existing.detections = parseInt(d.detections);
      } else {
        dataMap.set(d.date, {
          date: d.date,
          visits: 0,
          vehicular: 0,
          pedestrian: 0,
          detections: parseInt(d.detections),
          avgResponseTime: 0,
        });
      }
    });

    logs.forEach((l) => {
      const existing = dataMap.get(l.date);
      if (existing) {
        existing.avgResponseTime = Math.round(parseFloat(l.avgResponseTime) || 0);
      }
    });

    return Array.from(dataMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Actividad reciente del sistema
   */
  async getRecentActivity(query: RecentActivityQueryDto): Promise<RecentActivityItem[]> {
    const limit = query.limit || 10;
    const activities: RecentActivityItem[] = [];

    // Últimas detecciones
    if (!query.type || query.type === 'detection') {
      const detections = await this.detectionsRepository.find({
        take: limit,
        order: { createdAt: 'DESC' },
      });

      activities.push(
        ...detections.map((d) => ({
          id: d.id,
          type: 'detection' as const,
          message: `Vehículo ${d.plate} detectado en cámara ${d.cameraId}`,
          timestamp: d.createdAt,
          severity: 'info' as const,
          metadata: {
            plate: d.plate,
            confidence: d.det_confidence,
            cameraId: d.cameraId,
          },
        })),
      );
    }

    // Últimas visitas
    if (!query.type || query.type === 'visit') {
      const visits = await this.visitsRepository.find({
        take: limit,
        order: { createdAt: 'DESC' },
        relations: ['host'],
      });

      activities.push(
        ...visits.map((v) => ({
          id: v.id,
          type: 'visit' as const,
          message: `Visita ${v.status === VisitStatus.ACTIVE ? 'activa' : v.status} para ${v.visitorName}`,
          timestamp: v.createdAt,
          severity: v.status === VisitStatus.ACTIVE ? ('info' as const) : ('success' as const),
          metadata: {
            visitorName: v.visitorName,
            status: v.status,
            hostName: v.host?.name,
          },
        })),
      );
    }

    // Últimos errores
    if (!query.type || query.type === 'error') {
      const errors = await this.logsRepository.find({
        where: { level: LogLevel.ERROR },
        take: limit,
        order: { createdAt: 'DESC' },
      });

      activities.push(
        ...errors.map((e) => ({
          id: e.id,
          type: 'error' as const,
          message: e.message,
          timestamp: e.createdAt,
          severity: 'error' as const,
          metadata: {
            service: e.service,
            errorMessage: e.errorMessage,
          },
        })),
      );
    }

    // Últimas acciones de auditoría
    if (!query.type || query.type === 'audit') {
      const audits = await this.auditRepository.find({
        take: limit,
        order: { createdAt: 'DESC' },
        relations: ['user'],
      });

      activities.push(
        ...audits.map((a) => ({
          id: a.id,
          type: 'audit' as const,
          message: `${a.user?.name || 'Usuario'} realizó ${a.action} en ${a.module}`,
          timestamp: a.createdAt,
          severity: 'info' as const,
          metadata: {
            module: a.module,
            action: a.action,
            userName: a.user?.name,
          },
        })),
      );
    }

    // Ordenar por timestamp y limitar
    return activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
  }

  /**
   * Últimas detecciones con detalles
   */
  async getLatestDetections(query: DetectionsQueryDto) {
    const limit = query.limit || 10;
    return await this.detectionsRepository.find({
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Distribución por hora del día
   */
  async getDetectionsByHour(): Promise<DetectionHourlyData[]> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const data = await this.detectionsRepository
      .createQueryBuilder('detection')
      .select('EXTRACT(HOUR FROM detection.\"createdAt\")', 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('detection.\"createdAt\" >= :todayStart', { todayStart })
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany();

    return data.map((d) => ({
      hour: parseInt(d.hour),
      count: parseInt(d.count),
    }));
  }

  /**
   * Actividad por cámara
   */
  async getCameraActivity(): Promise<CameraActivityData[]> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const cameras = await this.camerasRepository.find({
      select: ['id', 'name', 'location', 'active'],
    });

    const detectionsPerCamera = await this.detectionsRepository
      .createQueryBuilder('detection')
      .select('detection.cameraId', 'cameraId')
      .addSelect('COUNT(*)', 'count')
      .where('detection.\"createdAt\" >= :todayStart', { todayStart })
      .groupBy('detection.cameraId')
      .getRawMany();

    const detectionsMap = new Map(detectionsPerCamera.map((d) => [d.cameraId, parseInt(d.count)]));

    return cameras.map((camera) => ({
      cameraId: camera.id,
      cameraName: camera.name,
      location: camera.location || 'Sin ubicación',
      detectionsToday: detectionsMap.get(camera.id) || 0,
      isActive: camera.active,
    }));
  }

  /**
   * Distribución de tipos de visitas
   */
  async getVisitTypeDistribution(): Promise<VisitTypeDistribution> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [vehicular, pedestrian] = await Promise.all([
      this.visitsRepository.count({
        where: {
          type: VisitType.VEHICULAR,
          createdAt: MoreThanOrEqual(monthStart),
        },
      }),
      this.visitsRepository.count({
        where: {
          type: VisitType.PEDESTRIAN,
          createdAt: MoreThanOrEqual(monthStart),
        },
      }),
    ]);

    const total = vehicular + pedestrian;

    return {
      vehicular,
      pedestrian,
      total,
      vehicularPercent: total > 0 ? Number(((vehicular / total) * 100).toFixed(2)) : 0,
      pedestrianPercent: total > 0 ? Number(((pedestrian / total) * 100).toFixed(2)) : 0,
    };
  }

  /**
   * Tendencias de errores por servicio
   */
  async getErrorTrends(): Promise<ErrorTrendData[]> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    const errors24h = await this.logsRepository
      .createQueryBuilder('log')
      .select('log.service', 'service')
      .addSelect('COUNT(*)', 'count')
      .where('log.level = :level', { level: LogLevel.ERROR })
      .andWhere('log.created_at >= :last24h', { last24h })
      .groupBy('log.service')
      .getRawMany();

    const errors48h = await this.logsRepository
      .createQueryBuilder('log')
      .select('log.service', 'service')
      .addSelect('COUNT(*)', 'count')
      .where('log.level = :level', { level: LogLevel.ERROR })
      .andWhere('log.created_at >= :last48h', { last48h })
      .andWhere('log.created_at < :last24h', { last24h })
      .groupBy('log.service')
      .getRawMany();

    const lastErrors = await this.logsRepository
      .createQueryBuilder('log')
      .select('log.service', 'service')
      .addSelect('MAX(log.created_at)', 'lastError')
      .where('log.level = :level', { level: LogLevel.ERROR })
      .groupBy('log.service')
      .getRawMany();

    const errors24hMap = new Map(errors24h.map((e) => [e.service, parseInt(e.count)]));
    const errors48hMap = new Map(errors48h.map((e) => [e.service, parseInt(e.count)]));
    const lastErrorMap = new Map(lastErrors.map((e) => [e.service, new Date(e.lastError)]));

    const services = [...new Set([...errors24hMap.keys(), ...errors48hMap.keys()])];

    return services.map((service) => {
      const count24h = errors24hMap.get(service) || 0;
      const count48h = errors48hMap.get(service) || 0;

      let trend: 'increasing' | 'stable' | 'decreasing' = 'stable';
      if (count24h > count48h * 1.2) trend = 'increasing';
      else if (count24h < count48h * 0.8) trend = 'decreasing';

      return {
        service,
        errorCount: count24h,
        trend,
        lastError: lastErrorMap.get(service) || new Date(),
      };
    });
  }

  // ============= Métodos auxiliares privados =============

  private getDateRange(period: string, startDateStr?: string, endDateStr?: string): { startDate: Date; endDate: Date } {
    const now = new Date();
    let startDate: Date;
    let endDate = new Date();

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'custom':
        if (startDateStr && endDateStr) {
          startDate = new Date(startDateStr);
          endDate = new Date(endDateStr);
        } else {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    return { startDate, endDate };
  }

  private async calculateAvgVisitDuration(startDate: Date, endDate: Date): Promise<number> {
    // Calcular duración promedio de visitas completadas
    const completedVisits = await this.visitsRepository
      .createQueryBuilder('visit')
      .select('AVG(EXTRACT(EPOCH FROM (visit.\"exitTime\" - visit.\"entryTime\")) / 60)', 'avgDuration')
      .addSelect('COUNT(*)', 'count')
      .where('visit.\"entryTime\" IS NOT NULL')
      .andWhere('visit.\"exitTime\" IS NOT NULL')
      .andWhere('visit.\"entryTime\" >= :startDate', { startDate })
      .andWhere('visit.\"exitTime\" <= :endDate', { endDate })
      .getRawOne();

    // Calcular duración actual de visitas activas (en curso)
    const activeVisits = await this.visitsRepository
      .createQueryBuilder('visit')
      .select('AVG(EXTRACT(EPOCH FROM (NOW() - visit.\"entryTime\")) / 60)', 'avgDuration')
      .addSelect('COUNT(*)', 'count')
      .where('visit.status = :status', { status: VisitStatus.ACTIVE })
      .andWhere('visit.\"entryTime\" IS NOT NULL')
      .getRawOne();

    const completedCount = parseInt(completedVisits?.count) || 0;
    const activeCount = parseInt(activeVisits?.count) || 0;
    const totalCount = completedCount + activeCount;

    if (totalCount === 0) return 0;

    const completedAvg = parseFloat(completedVisits?.avgDuration) || 0;
    const activeAvg = parseFloat(activeVisits?.avgDuration) || 0;

    // Promedio ponderado de ambas
    const weightedAvg = (completedAvg * completedCount + activeAvg * activeCount) / totalCount;

    return Math.round(weightedAvg);
  }



  /**
   * Calcula la confianza promedio de las detecciones (OCR y detector)
   * Retorna un valor entre 0 y 1
   */
  private async calculateAvgDetectionConfidence(since: Date): Promise<number> {
    const result = await this.detectionsRepository
      .createQueryBuilder('detection')
      .select('AVG((COALESCE(detection.det_confidence, 0) + COALESCE(detection.ocr_confidence, 0)) / 2)', 'avgConfidence')
      .where('detection.createdAt >= :since', { since })
      .andWhere('(detection.det_confidence IS NOT NULL OR detection.ocr_confidence IS NOT NULL)')
      .getRawOne();

    return parseFloat(result?.avgConfidence) || 0;
  }

  /**
   * Calcula el tiempo promedio de respuesta del sistema (T2 - T1)
   * T1 = Momento de detección (PlateDetection.createdAt)
   * T2 = Momento de decisión (AccessAttempt.createdAt)
   * Retorna el tiempo promedio en milisegundos
   */
  private async calculateAvgResponseTime(startDate: Date, endDate: Date): Promise<number> {
    const result = await this.detectionsRepository
      .createQueryBuilder('detection')
      .leftJoin('detection.accessAttempts', 'attempt')
      .select('AVG(attempt.responseTimeMs)', 'avgResponseTime')
      .where('detection.createdAt >= :startDate', { startDate })
      .andWhere('detection.createdAt <= :endDate', { endDate })
      .andWhere('attempt.responseTimeMs IS NOT NULL')
      .getRawOne();

    return Math.round(parseFloat(result?.avgResponseTime) || 0);
  }

  private async getActiveUsersCount(startDate: Date, endDate: Date): Promise<number> {
    const result = await this.auditRepository
      .createQueryBuilder('audit')
      .select('COUNT(DISTINCT audit.userId)', 'count')
      .where('audit.createdAt >= :startDate', { startDate })
      .andWhere('audit.createdAt <= :endDate', { endDate })
      .getRawOne();

    return parseInt(result?.count) || 0;
  }

  private async getTopAuditActions(limit: number) {
    const actions = await this.auditRepository
      .createQueryBuilder('audit')
      .select('audit.module', 'module')
      .addSelect('audit.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.module')
      .addGroupBy('audit.action')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();

    return actions.map((a) => ({
      module: a.module,
      action: a.action,
      count: parseInt(a.count),
    }));
  }

  private async getServicesHealth(): Promise<ServiceHealth[]> {
    const now = new Date();
    const last5min = new Date(now.getTime() - 5 * 60 * 1000);

    // Contar logs por servicio en los últimos 5 minutos
    const serviceLogs = await this.logsRepository
      .createQueryBuilder('log')
      .select('log.service', 'service')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN log.level = :error THEN 1 ELSE 0 END)', 'errors')
      .addSelect('AVG(log."responseTime")', 'avgResponseTime')
      .addSelect('MAX(log.created_at)', 'lastCheck')
      .where('log.created_at >= :last5min', { last5min })
      .setParameter('error', LogLevel.ERROR)
      .groupBy('log.service')
      .getRawMany();

    return serviceLogs.map((s) => {
      const errorRate = parseInt(s.errors) / parseInt(s.total);
      let status: 'healthy' | 'degraded' | 'down' = 'healthy';

      if (errorRate > 0.1) status = 'degraded';
      if (errorRate > 0.5) status = 'down';

      return {
        name: s.service,
        status,
        uptime: Number(((1 - errorRate) * 100).toFixed(2)),
        lastCheck: new Date(s.lastCheck),
        responseTime: Math.round(parseFloat(s.avgResponseTime) || 0),
      };
    });
  }

  /**
   * Obtiene métricas detalladas del tiempo de respuesta del sistema
   * Indicador clave: Tiempo promedio de respuesta (≤5 segundos)
   */
  async getResponseTimeMetrics(query: DashboardQueryDto) {
    const { startDate, endDate } = this.getDateRange(query.period || 'today', query.startDate, query.endDate);

    this.logger.log(`Generando métricas de tiempo de respuesta para período: ${query.period || 'today'}`);

    // Consulta para obtener estadísticas completas
    const stats = await this.detectionsRepository
      .createQueryBuilder('detection')
      .leftJoin('detection.accessAttempts', 'attempt')
      .select('AVG(attempt.responseTimeMs)', 'avgResponseTime')
      .addSelect('MIN(attempt.responseTimeMs)', 'minResponseTime')
      .addSelect('MAX(attempt.responseTimeMs)', 'maxResponseTime')
      .addSelect('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY attempt.responseTimeMs)', 'medianResponseTime')
      .addSelect('COUNT(*)', 'totalDetections')
      .addSelect('SUM(CASE WHEN attempt.responseTimeMs <= 5000 THEN 1 ELSE 0 END)', 'detectionsUnder5s')
      .where('detection.createdAt >= :startDate', { startDate })
      .andWhere('detection.createdAt <= :endDate', { endDate })
      .andWhere('attempt.responseTimeMs IS NOT NULL')
      .getRawOne();

    // Tiempo promedio por tipo de decisión
    const byDecision = await this.detectionsRepository
      .createQueryBuilder('detection')
      .leftJoin('detection.accessAttempts', 'attempt')
      .select('attempt.decision', 'decision')
      .addSelect('AVG(attempt.responseTimeMs)', 'avgResponseTime')
      .addSelect('COUNT(*)', 'count')
      .where('detection.createdAt >= :startDate', { startDate })
      .andWhere('detection.createdAt <= :endDate', { endDate })
      .andWhere('attempt.responseTimeMs IS NOT NULL')
      .groupBy('attempt.decision')
      .getRawMany();

    const totalDetections = parseInt(stats?.totalDetections) || 0;
    const detectionsUnder5s = parseInt(stats?.detectionsUnder5s) || 0;
    const complianceRate = totalDetections > 0 ? (detectionsUnder5s / totalDetections) * 100 : 0;

    const byDecisionMap = byDecision.reduce((acc, item) => {
      acc[item.decision] = {
        avgMs: Math.round(parseFloat(item.avgResponseTime) || 0),
        count: parseInt(item.count),
      };
      return acc;
    }, {} as Record<string, { avgMs: number; count: number }>);

    return {
      avgResponseTimeMs: Math.round(parseFloat(stats?.avgResponseTime) || 0),
      minResponseTimeMs: Math.round(parseFloat(stats?.minResponseTime) || 0),
      maxResponseTimeMs: Math.round(parseFloat(stats?.maxResponseTime) || 0),
      medianResponseTimeMs: Math.round(parseFloat(stats?.medianResponseTime) || 0),
      totalDetections,
      detectionsUnder5s,
      complianceRate: Number(complianceRate.toFixed(2)),
      byDecision: byDecisionMap,
      slaTarget: 5000, // Target de 5 segundos en milisegundos
      period: query.period || 'today',
      startDate,
      endDate,
    };
  }

  async getResponseTimeDetailed(query: DashboardQueryDto) {
    const { startDate, endDate } = this.getDateRange(query.period || 'today', query.startDate, query.endDate);

    this.logger.log(`Obteniendo detalle de tiempos de respuesta para período: ${query.period || 'today'}`);

    // Obtener todas las detecciones con sus intentos de acceso y tiempo de respuesta
    const detections = await this.detectionsRepository
      .createQueryBuilder('detection')
      .leftJoinAndSelect('detection.accessAttempts', 'attempt')
      .select([
        'detection.id as "detectionId"',
        'detection.plate as plate',
        'detection.cameraId as "cameraId"',
        'detection.createdAt as "detectionCreatedAt"',
        'detection.det_confidence as "detConfidence"',
        'detection.ocr_confidence as "ocrConfidence"',
        'attempt.decision as decision',
        'attempt.method as method',
        'attempt.createdAt as "attemptCreatedAt"',
        'attempt.responseTimeMs as "responseTimeMs"',
      ])
      .where('detection.createdAt >= :startDate', { startDate })
      .andWhere('detection.createdAt <= :endDate', { endDate })
      .andWhere('attempt.responseTimeMs IS NOT NULL')
      .orderBy('detection.createdAt', 'DESC')
      .getRawMany();

    return detections;
  }
}
