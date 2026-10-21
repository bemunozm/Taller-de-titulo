import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  type FindOptionsSelect,
  type FindOptionsWhere,
  IsNull,
  Like,
  Not,
  Repository,
} from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * Quién lee la auditoría (Fase 4 · P5): el super-admin lee todo; el resto,
 * solo las filas de SU condominio. Las filas sin condominio
 * (`organizationId` null: `LOGIN_FAILED`, acciones de un super-admin) las lee
 * solo el super-admin. Reemplaza la mitigación interina de la P4 (ocultar
 * LOGIN/LOGOUT a todos los que no fueran super-admin): ahora el Administrador
 * ve los eventos de sesión de su propio condominio.
 */
export interface AuditReader {
  isSuperAdmin: boolean;
  organizationId: string | null;
}

/**
 * Condición de alcance del lector. `null` = no puede leer nada (sin
 * condominio). Nunca devuelve `organizationId: null` (TypeORM 0.3 descarta un
 * `null` en un `where` objeto: la consulta quedaría sin filtro).
 */
function readerScope(reader: AuditReader): FindOptionsWhere<AuditLog> | null {
  if (reader.isSuperAdmin) {
    return {};
  }
  if (!reader.organizationId) {
    return null;
  }
  return { organizationId: reader.organizationId };
}

/**
 * Columnas que se devuelven: todas las del registro y, del usuario, solo
 * `id`, `name` y `email` (antes venía la entidad completa: RUT, teléfono,
 * roles).
 */
const AUDIT_LOG_SELECT: FindOptionsSelect<AuditLog> = {
  id: true,
  module: true,
  action: true,
  userId: true,
  organizationId: true,
  entityId: true,
  entityType: true,
  oldValue: true,
  newValue: true,
  metadata: true,
  description: true,
  createdAt: true,
  user: { id: true, name: true, email: true },
};

/** Opciones comunes de lectura: usuario mínimo y sin relaciones eager (roles). */
const AUDIT_LOG_READ_OPTIONS = {
  select: AUDIT_LOG_SELECT,
  relations: { user: true },
  loadEagerRelations: false,
} as const;

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Crea un registro de auditoría
   */
  async log(createAuditLogDto: CreateAuditLogDto): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create(createAuditLogDto);
    return this.auditLogRepository.save(auditLog);
  }

  /**
   * Obtiene logs de auditoría con filtros y paginación, dentro del alcance
   * del lector.
   */
  async findAll(query: QueryAuditLogsDto, reader: AuditReader) {
    const {
      module,
      action,
      userId,
      entityType,
      entityId,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20,
    } = query;

    const scope = readerScope(reader);
    if (!scope) {
      return {
        data: [],
        meta: { total: 0, page, limit, totalPages: 0 },
      };
    }

    const where: FindOptionsWhere<AuditLog> = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (search) where.description = Like(`%${search}%`);

    if (startDate && endDate) {
      where.createdAt = Between(new Date(startDate), new Date(endDate));
    } else if (startDate) {
      where.createdAt = Between(new Date(startDate), new Date());
    }

    const [data, total] = await this.auditLogRepository.findAndCount({
      ...AUDIT_LOG_READ_OPTIONS,
      // El alcance va al final: ningún filtro del query lo puede pisar.
      where: { ...where, ...scope },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Obtiene un log específico por ID. Fuera del alcance del lector responde
   * como inexistente (`null`).
   */
  async findOne(id: string, reader: AuditReader): Promise<AuditLog | null> {
    const scope = readerScope(reader);
    if (!scope) {
      return null;
    }
    return this.auditLogRepository.findOne({
      ...AUDIT_LOG_READ_OPTIONS,
      where: { id, ...scope },
    });
  }

  /**
   * Obtiene el historial de cambios de una entidad específica, dentro del
   * alcance del lector.
   */
  async getEntityHistory(
    entityType: string,
    entityId: string,
    reader: AuditReader,
  ) {
    const scope = readerScope(reader);
    if (!scope) {
      return [];
    }
    return this.auditLogRepository.find({
      ...AUDIT_LOG_READ_OPTIONS,
      where: { entityType, entityId, ...scope },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Obtiene estadísticas de auditoría dentro del alcance del lector.
   */
  async getStats(reader: AuditReader, startDate?: Date, endDate?: Date) {
    const scope = readerScope(reader);
    if (!scope) {
      return { totalLogs: 0, actionStats: [], moduleStats: [], topUsers: [] };
    }

    const where: FindOptionsWhere<AuditLog> = { ...scope };
    if (startDate && endDate) {
      where.createdAt = Between(startDate, endDate);
    }

    const [totalLogs, actionStats, moduleStats, topUsers] = await Promise.all([
      // Total de logs
      this.auditLogRepository.count({ where }),

      // Logs por acción
      this.auditLogRepository
        .createQueryBuilder('audit')
        .select('audit.action', 'action')
        .addSelect('COUNT(*)', 'count')
        .where(where)
        .groupBy('audit.action')
        .orderBy('count', 'DESC')
        .limit(10)
        .getRawMany(),

      // Logs por módulo
      this.auditLogRepository
        .createQueryBuilder('audit')
        .select('audit.module', 'module')
        .addSelect('COUNT(*)', 'count')
        .where(where)
        .groupBy('audit.module')
        .orderBy('count', 'DESC')
        .getRawMany(),

      // Usuarios más activos (del usuario, solo id, nombre y email)
      this.auditLogRepository
        .createQueryBuilder('audit')
        .select('audit.userId', 'userId')
        .addSelect('COUNT(*)', 'count')
        .leftJoin('audit.user', 'user')
        .addSelect('user.id', 'user_id')
        .addSelect('user.name', 'user_name')
        .addSelect('user.email', 'user_email')
        .where({ ...where, userId: Not(IsNull()) })
        .groupBy('audit.userId')
        .addGroupBy('user.id')
        .orderBy('count', 'DESC')
        .limit(10)
        .getRawMany(),
    ]);

    return {
      totalLogs,
      actionStats,
      moduleStats,
      topUsers,
    };
  }

  // Fase 4 · P7.R: la retención de `audit_logs` (antes `cleanup(90)`, sin
  // cron ni caller) la hace `RetentionService` (privacy/), por lotes y con
  // `RETENTION_AUDIT_DAYS` (365 por defecto).
}
