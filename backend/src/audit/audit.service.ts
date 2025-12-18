import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, Like, In, Not, IsNull } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

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
   * Obtiene logs de auditoría con filtros y paginación
   */
  async findAll(query: QueryAuditLogsDto) {
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

    const where: any = {};

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
      where,
      relations: ['user'],
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
   * Obtiene un log específico por ID
   */
  async findOne(id: string): Promise<AuditLog | null> {
    return this.auditLogRepository.findOne({
      where: { id },
      relations: ['user'],
    });
  }

  /**
   * Obtiene el historial de cambios de una entidad específica
   */
  async getEntityHistory(entityType: string, entityId: string) {
    return this.auditLogRepository.find({
      where: { entityType, entityId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Obtiene estadísticas de auditoría
   */
  async getStats(startDate?: Date, endDate?: Date) {
    const where: any = {};
    
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
      
      // Usuarios más activos
      this.auditLogRepository
        .createQueryBuilder('audit')
        .select('audit.userId', 'userId')
        .addSelect('COUNT(*)', 'count')
        .leftJoinAndSelect('audit.user', 'user')
        .where({ ...where, userId: Not(IsNull()) } as any)
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

  /**
   * Elimina logs antiguos (política de retención)
   */
  async cleanup(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.auditLogRepository
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }
}
