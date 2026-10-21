import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  MoreThanOrEqual,
  In,
  type SelectQueryBuilder,
  type ObjectLiteral,
} from 'typeorm';
import {
  applyTenantFilter,
  scopeWhere,
} from '../common/tenant/tenant-context.util';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { PlateDetection } from '../detections/entities/plate-detection.entity';
import { DUPLICATE_ACCESS_DECISION } from '../detections/access-decision';
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
import {
  DashboardQueryDto,
  VisitsTrendQueryDto,
  RecentActivityQueryDto,
  DetectionsQueryDto,
} from './dto/dashboard-query.dto';

/**
 * Visitas que cuentan como "pendientes" en el resumen: programadas que nunca
 * ingresaron y listas para reingresar. Las solicitudes del conserje digital
 * que esperan al residente (`AWAITING_APPROVAL`, Fase 4 · P3) van aparte, en
 * `awaitingApprovalVisits`: todavía no son visitas autorizadas.
 */
const DASHBOARD_PENDING_VISIT_STATUSES: readonly VisitStatus[] = Object.freeze([
  VisitStatus.PENDING,
  VisitStatus.READY_FOR_REENTRY,
]);

/**
 * Filtro de las métricas de tiempo de respuesta (promedio, SLA, desglose y
 * detalle exportable): deja afuera los intentos `Duplicado` (Fase 4 · P3).
 * Una lectura duplicada no es una decisión de acceso (no abre ni alerta), así
 * que contarla inflaría el total y el cumplimiento del SLA de ≤5 s. Va con el
 * parámetro `duplicateDecision`.
 */
const EXCLUDE_DUPLICATE_ATTEMPTS = 'attempt.decision <> :duplicateDecision';

/**
 * Filas de `getRawOne`/`getRawMany`. Postgres devuelve COUNT/SUM/AVG como
 * texto (bigint/numeric), así que los agregados se tipan como string y se
 * convierten con `toNumber`.
 */
type RawNumeric = string | number | null | undefined;

interface DateCountRow {
  date: string;
  visits: RawNumeric;
  vehicular: RawNumeric;
  pedestrian: RawNumeric;
}

interface DateDetectionsRow {
  date: string;
  detections: RawNumeric;
}

interface DateResponseTimeRow {
  date: string;
  avgResponseTime: RawNumeric;
}

interface HourCountRow {
  hour: RawNumeric;
  count: RawNumeric;
}

interface CameraCountRow {
  cameraId: string;
  count: RawNumeric;
}

interface ServiceCountRow {
  service: string;
  count: RawNumeric;
}

interface ServiceLastErrorRow {
  service: string;
  lastError: string | Date;
}

interface AvgDurationRow {
  avgDuration: RawNumeric;
  count: RawNumeric;
}

interface AvgConfidenceRow {
  avgConfidence: RawNumeric;
}

interface AvgResponseTimeRow {
  avgResponseTime: RawNumeric;
}

interface CountRow {
  count: RawNumeric;
}

interface AuditActionRow {
  module: string;
  action: string;
  count: RawNumeric;
}

interface ServiceHealthRow {
  service: string;
  total: RawNumeric;
  errors: RawNumeric;
  avgResponseTime: RawNumeric;
  lastCheck: string | Date;
}

interface ResponseTimeStatsRow {
  avgResponseTime: RawNumeric;
  minResponseTime: RawNumeric;
  maxResponseTime: RawNumeric;
  medianResponseTime: RawNumeric;
  totalDetections: RawNumeric;
  detectionsUnder5s: RawNumeric;
}

interface DecisionResponseTimeRow {
  decision: string;
  avgResponseTime: RawNumeric;
  count: RawNumeric;
}

export interface ResponseTimeDetailRow {
  detectionId: string;
  plate: string;
  cameraId: string;
  detectionCreatedAt: Date;
  detConfidence: number | null;
  ocrConfidence: number | null;
  decision: string | null;
  method: string | null;
  attemptCreatedAt: Date | null;
  responseTimeMs: number | null;
}

/** Número de un agregado crudo de Postgres; 0 si no es un número finito. */
function toNumber(value: RawNumeric): number {
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Restringe una consulta a las filas cuyo usuario (`userColumn`, SQL ya
 * calificado, p. ej. `u.id` o `audit."userId"`) tiene membresía (`member`) en
 * el condominio del actor. Los usuarios no tienen `organizationId`: su
 * condominio sale de la membresía (misma fuente que `TenantContext`).
 *
 * Devuelve `false` si el actor no tiene condominio (no hay miembros que
 * contar: el caller responde 0 o vacío). Super-admin: sin filtro.
 */
function restrictToOrganizationMembers<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  userColumn: string,
  ctx: TenantContext,
): boolean {
  if (ctx.isSuperAdmin) {
    return true;
  }
  if (!ctx.organizationId) {
    return false;
  }
  qb.andWhere(
    `EXISTS (SELECT 1 FROM member m WHERE m."userId" = ${userColumn} AND m."organizationId" = :memberOrgId)`,
    { memberOrgId: ctx.organizationId },
  );
  return true;
}

/**
 * Fase 4 · P5.B (D12): todo conteo y listado del dashboard se acota al
 * condominio del actor (`TenantContext` que pasa el controller; super-admin:
 * toda la plataforma):
 *  - detecciones, visitas, cámaras y familias: por su `organizationId`
 *    (`scopeWhere` / `applyTenantFilter`);
 *  - usuarios y actividad de auditoría: por la membresía (`member`) del
 *    usuario en el condominio;
 *  - logs del sistema (errores, salud de servicios, tiempos de respuesta de
 *    la tabla `system_logs`) son de PLATAFORMA: solo el super-admin los ve;
 *    para el resto esos campos van en cero o vacíos;
 *  - la auditoría de la actividad reciente (Fase 4 · P5.C): por
 *    `audit_logs.organizationId` (las filas sin condominio, como
 *    `LOGIN_FAILED`, solo para el super-admin).
 */
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
  async getDashboardSummary(
    query: DashboardQueryDto,
    ctx: TenantContext,
  ): Promise<DashboardSummary> {
    try {
      const { startDate, endDate } = this.getDateRange(
        query.period || 'today',
        query.startDate,
        query.endDate,
      );

      this.logger.log(
        `Generando dashboard summary para período: ${query.period || 'today'}`,
      );
      this.logger.debug(
        `Rango de fechas: ${startDate.toISOString()} - ${endDate.toISOString()}`,
      );

      const [security, systemHealth, userActivity] = await Promise.all([
        this.getSecurityStats(startDate, endDate, ctx),
        this.getSystemHealthStats(ctx),
        this.getUserActivityStats(startDate, endDate, ctx),
      ]);

      return {
        security,
        systemHealth,
        userActivity,
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.logger.error(
        'Error al generar dashboard summary',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Estadísticas de seguridad
   */
  private async getSecurityStats(
    startDate: Date,
    endDate: Date,
    ctx: TenantContext,
  ): Promise<SecurityStats> {
    try {
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      this.logger.debug('Obteniendo estadísticas de seguridad...');

      // Calcular métricas que se usan en el Promise.all
      const avgVisitDuration = await this.calculateAvgVisitDuration(
        todayStart,
        endDate,
        ctx,
      );
      const avgResponseTime = await this.calculateAvgResponseTime(
        startDate,
        endDate,
        ctx,
      );

      const [
        detectionsToday,
        detectionsWeek,
        detectionsMonth,
        activeVisits,
        pendingVisits,
        awaitingApprovalVisits,
        completedVisitsToday,
        unauthorizedVehicles,
      ] = await Promise.all([
        this.detectionsRepository.count({
          where: scopeWhere({ createdAt: MoreThanOrEqual(todayStart) }, ctx),
        }),
        this.detectionsRepository.count({
          where: scopeWhere({ createdAt: MoreThanOrEqual(weekStart) }, ctx),
        }),
        this.detectionsRepository.count({
          where: scopeWhere({ createdAt: MoreThanOrEqual(monthStart) }, ctx),
        }),
        this.visitsRepository.count({
          where: scopeWhere({ status: VisitStatus.ACTIVE }, ctx),
        }),
        // Contar visitas pendientes: nunca han ingresado + listas para
        // reingresar
        this.visitsRepository.count({
          where: scopeWhere(
            { status: In([...DASHBOARD_PENDING_VISIT_STATUSES]) },
            ctx,
          ),
        }),
        // Solicitudes del conserje digital esperando al residente
        this.visitsRepository.count({
          where: scopeWhere({ status: VisitStatus.AWAITING_APPROVAL }, ctx),
        }),
        this.visitsRepository.count({
          where: scopeWhere(
            {
              status: VisitStatus.COMPLETED,
              exitTime: MoreThanOrEqual(todayStart),
            },
            ctx,
          ),
        }),
        this.detectionsRepository.count({
          where: scopeWhere({ createdAt: MoreThanOrEqual(todayStart) }, ctx),
        }),
      ]);

      const alertsPending = pendingVisits + (unauthorizedVehicles > 5 ? 1 : 0);

      return {
        detectionsToday,
        detectionsWeek,
        detectionsMonth,
        activeVisits,
        pendingVisits,
        awaitingApprovalVisits,
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
   * Estadísticas de salud del sistema. Cámaras y confianza de detección:
   * del condominio del actor. Logs del sistema y salud de servicios: solo
   * super-admin (plataforma); para el resto, en cero.
   */
  private async getSystemHealthStats(
    ctx: TenantContext,
  ): Promise<SystemHealthStats> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const platformLogs = ctx.isSuperAdmin;

    const [
      camerasActive,
      camerasTotal,
      totalLogsToday,
      criticalErrorsToday,
      avgDetectionConfidence,
    ] = await Promise.all([
      this.camerasRepository.count({
        where: scopeWhere({ active: true }, ctx),
      }),
      this.camerasRepository.count({ where: scopeWhere({}, ctx) }),
      platformLogs
        ? this.logsRepository.count({
            where: { createdAt: MoreThanOrEqual(last24h) },
          })
        : 0,
      platformLogs
        ? this.logsRepository.count({
            where: {
              level: LogLevel.ERROR,
              createdAt: MoreThanOrEqual(last24h),
            },
          })
        : 0,
      this.calculateAvgDetectionConfidence(last24h, ctx),
    ]);

    const camerasInactive = camerasTotal - camerasActive;
    const errorRateLast24h =
      totalLogsToday > 0 ? (criticalErrorsToday / totalLogsToday) * 100 : 0;

    // Obtener estado de servicios (plataforma: solo super-admin)
    const services = platformLogs ? await this.getServicesHealth() : [];

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
  private async getUserActivityStats(
    startDate: Date,
    endDate: Date,
    ctx: TenantContext,
  ): Promise<UserActivityStats> {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
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
      this.familiesRepository.count({
        where: scopeWhere({ active: true }, ctx),
      }),
      this.familiesRepository.count({ where: scopeWhere({}, ctx) }),
      this.countOrganizationUsers(ctx),
      this.getActiveUsersCount(todayStart, endDate, ctx),
      this.getActiveUsersCount(weekStart, endDate, ctx),
      this.countOrganizationUsers(ctx, weekStart),
      this.getTopAuditActions(5, ctx),
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
  async getVisitsTrend(
    query: VisitsTrendQueryDto,
    ctx: TenantContext,
  ): Promise<PerformanceTrendData[]> {
    const days = query.days || 7;
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    const visitsQuery = this.visitsRepository
      .createQueryBuilder('visit')
      .select(`TO_CHAR(visit."createdAt", 'YYYY-MM-DD')`, 'date')
      .addSelect('COUNT(*)', 'visits')
      .addSelect(
        'SUM(CASE WHEN visit.type = :vehicular THEN 1 ELSE 0 END)',
        'vehicular',
      )
      .addSelect(
        'SUM(CASE WHEN visit.type = :pedestrian THEN 1 ELSE 0 END)',
        'pedestrian',
      )
      .where('visit."createdAt" >= :startDate', { startDate })
      .andWhere('visit."createdAt" <= :endDate', { endDate })
      .setParameter('vehicular', VisitType.VEHICULAR)
      .setParameter('pedestrian', VisitType.PEDESTRIAN)
      .groupBy(`TO_CHAR(visit."createdAt", 'YYYY-MM-DD')`)
      .orderBy('date', 'ASC');
    applyTenantFilter(visitsQuery, 'visit', ctx);
    const visits = await visitsQuery.getRawMany<DateCountRow>();

    const detectionsQuery = this.detectionsRepository
      .createQueryBuilder('detection')
      .select(`TO_CHAR(detection."createdAt", 'YYYY-MM-DD')`, 'date')
      .addSelect('COUNT(*)', 'detections')
      .where('detection."createdAt" >= :startDate', { startDate })
      .andWhere('detection."createdAt" <= :endDate', { endDate })
      .groupBy(`TO_CHAR(detection."createdAt", 'YYYY-MM-DD')`);
    applyTenantFilter(detectionsQuery, 'detection', ctx);
    const detections = await detectionsQuery.getRawMany<DateDetectionsRow>();

    // Tiempos de respuesta de `system_logs`: plataforma, solo super-admin.
    const logs = ctx.isSuperAdmin
      ? await this.logsRepository
          .createQueryBuilder('log')
          .select("TO_CHAR(log.created_at, 'YYYY-MM-DD')", 'date')
          .addSelect('AVG(log."responseTime")', 'avgResponseTime')
          .where('log.created_at >= :startDate', { startDate })
          .andWhere('log.created_at <= :endDate', { endDate })
          .andWhere('log."responseTime" IS NOT NULL')
          .groupBy("TO_CHAR(log.created_at, 'YYYY-MM-DD')")
          .getRawMany<DateResponseTimeRow>()
      : [];

    // Combinar datos
    const dataMap = new Map<string, PerformanceTrendData>();

    visits.forEach((v) => {
      dataMap.set(v.date, {
        date: v.date,
        visits: toNumber(v.visits),
        vehicular: toNumber(v.vehicular),
        pedestrian: toNumber(v.pedestrian),
        detections: 0,
        avgResponseTime: 0,
      });
    });

    detections.forEach((d) => {
      const existing = dataMap.get(d.date);
      if (existing) {
        existing.detections = toNumber(d.detections);
      } else {
        dataMap.set(d.date, {
          date: d.date,
          visits: 0,
          vehicular: 0,
          pedestrian: 0,
          detections: toNumber(d.detections),
          avgResponseTime: 0,
        });
      }
    });

    logs.forEach((l) => {
      const existing = dataMap.get(l.date);
      if (existing) {
        existing.avgResponseTime = Math.round(toNumber(l.avgResponseTime));
      }
    });

    return Array.from(dataMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  /**
   * Actividad reciente del condominio del actor (detecciones, visitas y
   * auditoría). Los errores (`system_logs`) son de PLATAFORMA: solo los ve el
   * super-admin (P5.B). Fase 4 · P5.C: la auditoría vuelve, acotada por
   * `audit_logs.organizationId` (`scopeWhere`): el Administrador ve la de su
   * condominio; las filas sin condominio, solo el super-admin.
   */
  async getRecentActivity(
    query: RecentActivityQueryDto,
    ctx: TenantContext,
  ): Promise<RecentActivityItem[]> {
    const limit = query.limit || 10;
    const activities: RecentActivityItem[] = [];

    // Últimas detecciones
    if (!query.type || query.type === 'detection') {
      const detections = await this.detectionsRepository.find({
        where: scopeWhere({}, ctx),
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
        where: scopeWhere({}, ctx),
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
          severity:
            v.status === VisitStatus.ACTIVE
              ? ('info' as const)
              : ('success' as const),
          metadata: {
            visitorName: v.visitorName,
            status: v.status,
            hostName: v.host?.name,
          },
        })),
      );
    }

    // Últimos errores (plataforma: solo super-admin)
    if (ctx.isSuperAdmin && (!query.type || query.type === 'error')) {
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

    // Últimas acciones de auditoría del condominio del actor (P5.C). Del
    // usuario solo el nombre: el mensaje no necesita más.
    if (!query.type || query.type === 'audit') {
      const audits = await this.auditRepository.find({
        where: scopeWhere({}, ctx),
        take: limit,
        order: { createdAt: 'DESC' },
        relations: { user: true },
        select: {
          id: true,
          module: true,
          action: true,
          createdAt: true,
          user: { id: true, name: true },
        },
        loadEagerRelations: false,
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
    return activities
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Últimas detecciones con detalles
   */
  async getLatestDetections(query: DetectionsQueryDto, ctx: TenantContext) {
    const limit = query.limit || 10;
    return await this.detectionsRepository.find({
      where: scopeWhere({}, ctx),
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Distribución por hora del día
   */
  async getDetectionsByHour(
    ctx: TenantContext,
  ): Promise<DetectionHourlyData[]> {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const query = this.detectionsRepository
      .createQueryBuilder('detection')
      .select('EXTRACT(HOUR FROM detection."createdAt")', 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('detection."createdAt" >= :todayStart', { todayStart })
      .groupBy('hour')
      .orderBy('hour', 'ASC');
    applyTenantFilter(query, 'detection', ctx);
    const data = await query.getRawMany<HourCountRow>();

    return data.map((d) => ({
      hour: Math.trunc(toNumber(d.hour)),
      count: toNumber(d.count),
    }));
  }

  /**
   * Actividad por cámara
   */
  async getCameraActivity(ctx: TenantContext): Promise<CameraActivityData[]> {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

    const cameras = await this.camerasRepository.find({
      where: scopeWhere({}, ctx),
      select: ['id', 'name', 'location', 'active'],
    });

    const detectionsQuery = this.detectionsRepository
      .createQueryBuilder('detection')
      .select('detection.cameraId', 'cameraId')
      .addSelect('COUNT(*)', 'count')
      .where('detection."createdAt" >= :todayStart', { todayStart })
      .groupBy('detection.cameraId');
    applyTenantFilter(detectionsQuery, 'detection', ctx);
    const detectionsPerCamera =
      await detectionsQuery.getRawMany<CameraCountRow>();

    const detectionsMap = new Map<string, number>(
      detectionsPerCamera.map((d) => [d.cameraId, toNumber(d.count)]),
    );

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
  async getVisitTypeDistribution(
    ctx: TenantContext,
  ): Promise<VisitTypeDistribution> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [vehicular, pedestrian] = await Promise.all([
      this.visitsRepository.count({
        where: scopeWhere(
          {
            type: VisitType.VEHICULAR,
            createdAt: MoreThanOrEqual(monthStart),
          },
          ctx,
        ),
      }),
      this.visitsRepository.count({
        where: scopeWhere(
          {
            type: VisitType.PEDESTRIAN,
            createdAt: MoreThanOrEqual(monthStart),
          },
          ctx,
        ),
      }),
    ]);

    const total = vehicular + pedestrian;

    return {
      vehicular,
      pedestrian,
      total,
      vehicularPercent:
        total > 0 ? Number(((vehicular / total) * 100).toFixed(2)) : 0,
      pedestrianPercent:
        total > 0 ? Number(((pedestrian / total) * 100).toFixed(2)) : 0,
    };
  }

  /**
   * Tendencias de errores por servicio (`system_logs`: plataforma, solo
   * super-admin; para el resto, vacío).
   */
  async getErrorTrends(ctx: TenantContext): Promise<ErrorTrendData[]> {
    if (!ctx.isSuperAdmin) {
      return [];
    }
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
      .getRawMany<ServiceCountRow>();

    const errors48h = await this.logsRepository
      .createQueryBuilder('log')
      .select('log.service', 'service')
      .addSelect('COUNT(*)', 'count')
      .where('log.level = :level', { level: LogLevel.ERROR })
      .andWhere('log.created_at >= :last48h', { last48h })
      .andWhere('log.created_at < :last24h', { last24h })
      .groupBy('log.service')
      .getRawMany<ServiceCountRow>();

    const lastErrors = await this.logsRepository
      .createQueryBuilder('log')
      .select('log.service', 'service')
      .addSelect('MAX(log.created_at)', 'lastError')
      .where('log.level = :level', { level: LogLevel.ERROR })
      .groupBy('log.service')
      .getRawMany<ServiceLastErrorRow>();

    const errors24hMap = new Map<string, number>(
      errors24h.map((e) => [e.service, toNumber(e.count)]),
    );
    const errors48hMap = new Map<string, number>(
      errors48h.map((e) => [e.service, toNumber(e.count)]),
    );
    const lastErrorMap = new Map<string, Date>(
      lastErrors.map((e) => [e.service, new Date(e.lastError)]),
    );

    const services = [
      ...new Set([...errors24hMap.keys(), ...errors48hMap.keys()]),
    ];

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

  private getDateRange(
    period: string,
    startDateStr?: string,
    endDateStr?: string,
  ): { startDate: Date; endDate: Date } {
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
          startDate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
          );
        }
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    return { startDate, endDate };
  }

  private async calculateAvgVisitDuration(
    startDate: Date,
    endDate: Date,
    ctx: TenantContext,
  ): Promise<number> {
    // Calcular duración promedio de visitas completadas
    const completedQuery = this.visitsRepository
      .createQueryBuilder('visit')
      .select(
        'AVG(EXTRACT(EPOCH FROM (visit."exitTime" - visit."entryTime")) / 60)',
        'avgDuration',
      )
      .addSelect('COUNT(*)', 'count')
      .where('visit."entryTime" IS NOT NULL')
      .andWhere('visit."exitTime" IS NOT NULL')
      .andWhere('visit."entryTime" >= :startDate', { startDate })
      .andWhere('visit."exitTime" <= :endDate', { endDate });
    applyTenantFilter(completedQuery, 'visit', ctx);
    const completedVisits = await completedQuery.getRawOne<AvgDurationRow>();

    // Calcular duración actual de visitas activas (en curso)
    const activeQuery = this.visitsRepository
      .createQueryBuilder('visit')
      .select(
        'AVG(EXTRACT(EPOCH FROM (NOW() - visit."entryTime")) / 60)',
        'avgDuration',
      )
      .addSelect('COUNT(*)', 'count')
      .where('visit.status = :status', { status: VisitStatus.ACTIVE })
      .andWhere('visit."entryTime" IS NOT NULL');
    applyTenantFilter(activeQuery, 'visit', ctx);
    const activeVisits = await activeQuery.getRawOne<AvgDurationRow>();

    const completedCount = Math.trunc(toNumber(completedVisits?.count));
    const activeCount = Math.trunc(toNumber(activeVisits?.count));
    const totalCount = completedCount + activeCount;

    if (totalCount === 0) return 0;

    const completedAvg = toNumber(completedVisits?.avgDuration);
    const activeAvg = toNumber(activeVisits?.avgDuration);

    // Promedio ponderado de ambas
    const weightedAvg =
      (completedAvg * completedCount + activeAvg * activeCount) / totalCount;

    return Math.round(weightedAvg);
  }

  /**
   * Calcula la confianza promedio de las detecciones (OCR y detector)
   * Retorna un valor entre 0 y 1
   */
  private async calculateAvgDetectionConfidence(
    since: Date,
    ctx: TenantContext,
  ): Promise<number> {
    const query = this.detectionsRepository
      .createQueryBuilder('detection')
      .select(
        'AVG((COALESCE(detection.det_confidence, 0) + COALESCE(detection.ocr_confidence, 0)) / 2)',
        'avgConfidence',
      )
      .where('detection.createdAt >= :since', { since })
      .andWhere(
        '(detection.det_confidence IS NOT NULL OR detection.ocr_confidence IS NOT NULL)',
      );
    applyTenantFilter(query, 'detection', ctx);
    const result = await query.getRawOne<AvgConfidenceRow>();

    return toNumber(result?.avgConfidence);
  }

  /**
   * Calcula el tiempo promedio de respuesta del sistema (T2 - T1)
   * T1 = Momento de detección (PlateDetection.createdAt)
   * T2 = Momento de decisión (AccessAttempt.createdAt)
   * Retorna el tiempo promedio en milisegundos, sin las lecturas `Duplicado`
   * (ver EXCLUDE_DUPLICATE_ATTEMPTS).
   */
  private async calculateAvgResponseTime(
    startDate: Date,
    endDate: Date,
    ctx: TenantContext,
  ): Promise<number> {
    const query = this.detectionsRepository
      .createQueryBuilder('detection')
      .leftJoin('detection.accessAttempts', 'attempt')
      .select('AVG(attempt.responseTimeMs)', 'avgResponseTime')
      .where('detection.createdAt >= :startDate', { startDate })
      .andWhere('detection.createdAt <= :endDate', { endDate })
      .andWhere('attempt.responseTimeMs IS NOT NULL')
      .andWhere(EXCLUDE_DUPLICATE_ATTEMPTS, {
        duplicateDecision: DUPLICATE_ACCESS_DECISION,
      });
    applyTenantFilter(query, 'detection', ctx);
    const result = await query.getRawOne<AvgResponseTimeRow>();

    return Math.round(toNumber(result?.avgResponseTime));
  }

  /**
   * Usuarios activos (no deshabilitados: la consulta excluye `deletedAt`) con
   * membresía en el condominio del actor; con `createdSince`, solo los
   * creados desde esa fecha. Super-admin: toda la plataforma.
   */
  private async countOrganizationUsers(
    ctx: TenantContext,
    createdSince?: Date,
  ): Promise<number> {
    const query = this.usersRepository.createQueryBuilder('u');
    if (!restrictToOrganizationMembers(query, 'u.id', ctx)) {
      return 0;
    }
    if (createdSince) {
      query.andWhere('u.createdAt >= :createdSince', { createdSince });
    }
    return await query.getCount();
  }

  /**
   * Usuarios distintos con actividad auditada en el período, acotados a los
   * miembros del condominio del actor (super-admin: todos).
   */
  private async getActiveUsersCount(
    startDate: Date,
    endDate: Date,
    ctx: TenantContext,
  ): Promise<number> {
    const query = this.auditRepository
      .createQueryBuilder('audit')
      .select('COUNT(DISTINCT audit.userId)', 'count')
      .where('audit.createdAt >= :startDate', { startDate })
      .andWhere('audit.createdAt <= :endDate', { endDate });
    if (!restrictToOrganizationMembers(query, 'audit."userId"', ctx)) {
      return 0;
    }
    const result = await query.getRawOne<CountRow>();

    return Math.trunc(toNumber(result?.count));
  }

  /**
   * Acciones más frecuentes de la auditoría, acotadas a las de los miembros
   * del condominio del actor (super-admin: todas). Solo nombres de módulo y
   * acción con su conteo, sin datos de las filas.
   */
  private async getTopAuditActions(
    limit: number,
    ctx: TenantContext,
  ): Promise<{ module: string; action: string; count: number }[]> {
    const query = this.auditRepository
      .createQueryBuilder('audit')
      .select('audit.module', 'module')
      .addSelect('audit.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('audit.module')
      .addGroupBy('audit.action')
      .orderBy('count', 'DESC')
      .limit(limit);
    if (!restrictToOrganizationMembers(query, 'audit."userId"', ctx)) {
      return [];
    }
    const actions = await query.getRawMany<AuditActionRow>();

    return actions.map((a) => ({
      module: a.module,
      action: a.action,
      count: Math.trunc(toNumber(a.count)),
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
      .addSelect(
        'SUM(CASE WHEN log.level = :error THEN 1 ELSE 0 END)',
        'errors',
      )
      .addSelect('AVG(log."responseTime")', 'avgResponseTime')
      .addSelect('MAX(log.created_at)', 'lastCheck')
      .where('log.created_at >= :last5min', { last5min })
      .setParameter('error', LogLevel.ERROR)
      .groupBy('log.service')
      .getRawMany<ServiceHealthRow>();

    return serviceLogs.map((s) => {
      const errorRate = toNumber(s.errors) / toNumber(s.total);
      let status: 'healthy' | 'degraded' | 'down' = 'healthy';

      if (errorRate > 0.1) status = 'degraded';
      if (errorRate > 0.5) status = 'down';

      return {
        name: s.service,
        status,
        uptime: Number(((1 - errorRate) * 100).toFixed(2)),
        lastCheck: new Date(s.lastCheck),
        responseTime: Math.round(toNumber(s.avgResponseTime)),
      };
    });
  }

  /**
   * Obtiene métricas detalladas del tiempo de respuesta del sistema
   * Indicador clave: Tiempo promedio de respuesta (≤5 segundos). Las lecturas
   * `Duplicado` no cuentan (ver EXCLUDE_DUPLICATE_ATTEMPTS).
   */
  async getResponseTimeMetrics(query: DashboardQueryDto, ctx: TenantContext) {
    const { startDate, endDate } = this.getDateRange(
      query.period || 'today',
      query.startDate,
      query.endDate,
    );

    this.logger.log(
      `Generando métricas de tiempo de respuesta para período: ${query.period || 'today'}`,
    );

    // Consulta para obtener estadísticas completas
    const statsQuery = this.detectionsRepository
      .createQueryBuilder('detection')
      .leftJoin('detection.accessAttempts', 'attempt')
      .select('AVG(attempt.responseTimeMs)', 'avgResponseTime')
      .addSelect('MIN(attempt.responseTimeMs)', 'minResponseTime')
      .addSelect('MAX(attempt.responseTimeMs)', 'maxResponseTime')
      .addSelect(
        'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY attempt.responseTimeMs)',
        'medianResponseTime',
      )
      .addSelect('COUNT(*)', 'totalDetections')
      .addSelect(
        'SUM(CASE WHEN attempt.responseTimeMs <= 5000 THEN 1 ELSE 0 END)',
        'detectionsUnder5s',
      )
      .where('detection.createdAt >= :startDate', { startDate })
      .andWhere('detection.createdAt <= :endDate', { endDate })
      .andWhere('attempt.responseTimeMs IS NOT NULL')
      .andWhere(EXCLUDE_DUPLICATE_ATTEMPTS, {
        duplicateDecision: DUPLICATE_ACCESS_DECISION,
      });
    applyTenantFilter(statsQuery, 'detection', ctx);
    const stats = await statsQuery.getRawOne<ResponseTimeStatsRow>();

    // Tiempo promedio por tipo de decisión
    const byDecisionQuery = this.detectionsRepository
      .createQueryBuilder('detection')
      .leftJoin('detection.accessAttempts', 'attempt')
      .select('attempt.decision', 'decision')
      .addSelect('AVG(attempt.responseTimeMs)', 'avgResponseTime')
      .addSelect('COUNT(*)', 'count')
      .where('detection.createdAt >= :startDate', { startDate })
      .andWhere('detection.createdAt <= :endDate', { endDate })
      .andWhere('attempt.responseTimeMs IS NOT NULL')
      .andWhere(EXCLUDE_DUPLICATE_ATTEMPTS, {
        duplicateDecision: DUPLICATE_ACCESS_DECISION,
      })
      .groupBy('attempt.decision');
    applyTenantFilter(byDecisionQuery, 'detection', ctx);
    const byDecision =
      await byDecisionQuery.getRawMany<DecisionResponseTimeRow>();

    const totalDetections = Math.trunc(toNumber(stats?.totalDetections));
    const detectionsUnder5s = Math.trunc(toNumber(stats?.detectionsUnder5s));
    const complianceRate =
      totalDetections > 0 ? (detectionsUnder5s / totalDetections) * 100 : 0;

    const byDecisionMap = byDecision.reduce<
      Record<string, { avgMs: number; count: number }>
    >((acc, item) => {
      acc[item.decision] = {
        avgMs: Math.round(toNumber(item.avgResponseTime)),
        count: Math.trunc(toNumber(item.count)),
      };
      return acc;
    }, {});

    return {
      avgResponseTimeMs: Math.round(toNumber(stats?.avgResponseTime)),
      minResponseTimeMs: Math.round(toNumber(stats?.minResponseTime)),
      maxResponseTimeMs: Math.round(toNumber(stats?.maxResponseTime)),
      medianResponseTimeMs: Math.round(toNumber(stats?.medianResponseTime)),
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

  async getResponseTimeDetailed(
    query: DashboardQueryDto,
    ctx: TenantContext,
  ): Promise<ResponseTimeDetailRow[]> {
    const { startDate, endDate } = this.getDateRange(
      query.period || 'today',
      query.startDate,
      query.endDate,
    );

    this.logger.log(
      `Obteniendo detalle de tiempos de respuesta para período: ${query.period || 'today'}`,
    );

    // Obtener todas las detecciones con sus intentos de acceso y tiempo de respuesta
    const detectionsQuery = this.detectionsRepository
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
      .andWhere(EXCLUDE_DUPLICATE_ATTEMPTS, {
        duplicateDecision: DUPLICATE_ACCESS_DECISION,
      })
      .orderBy('detection.createdAt', 'DESC');
    applyTenantFilter(detectionsQuery, 'detection', ctx);

    return await detectionsQuery.getRawMany<ResponseTimeDetailRow>();
  }
}
