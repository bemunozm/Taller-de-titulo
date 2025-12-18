import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { TokensService } from '../../tokens/tokens.service';
import { AccessAttempt } from '../../detections/entities/access-attempt.entity';
import { Notification } from '../../notifications/entities/notification.entity';
import { Visit, VisitStatus } from '../../visits/entities/visit.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';

/**
 * Servicio centralizado para manejar TODAS las expiraciones automáticas del sistema
 * TypeORM no soporta TTL (Time To Live) automático, por lo que necesitamos
 * ejecutar tareas programadas para marcar registros como expirados
 */
@Injectable()
export class ExpirationService {
  private readonly logger = new Logger(ExpirationService.name);

  constructor(
    private readonly tokensService: TokensService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(AccessAttempt)
    private readonly accessAttemptRepo: Repository<AccessAttempt>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(Visit)
    private readonly visitRepo: Repository<Visit>,
  ) {}

  /**
   * Limpieza de tokens expirados - Ejecuta cada 10 minutos
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredTokens() {
    this.logger.log('🧹 Iniciando limpieza de tokens expirados...');
    
    try {
      const removedCount = await this.tokensService.cleanupExpiredTokens();
      
      if (removedCount > 0) {
        this.logger.log(`✅ Tokens: ${removedCount} tokens expirados eliminados`);
      }
    } catch (error) {
      this.logger.error('❌ Error durante la limpieza de tokens:', error);
    }
  }

  /**
   * Marcar Access Attempts pendientes como expirados - Ejecuta cada 5 minutos
   * Las detecciones pendientes expiran en 10 minutos si no se responde
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expirePendingDetections() {
    this.logger.log('🧹 Verificando detecciones pendientes expiradas...');
    
    try {
      const now = new Date();
      
      const result = await this.accessAttemptRepo
        .createQueryBuilder()
        .update(AccessAttempt)
        .set({ 
          decision: 'Expirado',
          reason: 'Tiempo de decisión expirado - No se recibió respuesta del conserje',
          updatedAt: now,
        })
        .where('decision = :decision', { decision: 'Pendiente' })
        .andWhere('expiresAt IS NOT NULL')
        .andWhere('expiresAt < :now', { now })
        .execute();
      
      if (result.affected && result.affected > 0) {
        this.logger.log(`✅ Detecciones: ${result.affected} detecciones pendientes marcadas como expiradas`);
      }
    } catch (error) {
      this.logger.error('❌ Error al expirar detecciones pendientes:', error);
    }
  }

  /**
   * Eliminar notificaciones expiradas - Ejecuta cada 30 minutos
   * Las notificaciones con expiresAt son soft-deleted después de expirar
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async cleanupExpiredNotifications() {
    this.logger.log('🧹 Limpiando notificaciones expiradas...');
    
    try {
      const now = new Date();
      
      // Soft delete de notificaciones expiradas que no han sido eliminadas
      const result = await this.notificationRepo
        .createQueryBuilder()
        .softDelete()
        .where('expiresAt IS NOT NULL')
        .andWhere('expiresAt < :now', { now })
        .andWhere('deletedAt IS NULL')
        .execute();
      
      if (result.affected && result.affected > 0) {
        this.logger.log(`✅ Notificaciones: ${result.affected} notificaciones expiradas eliminadas`);
      }
    } catch (error) {
      this.logger.error('❌ Error al limpiar notificaciones expiradas:', error);
    }
  }

  /**
   * Marcar visitas como expiradas o completadas - Ejecuta cada 10 minutos
   * - Visitas sin usos (usedCount = 0) → EXPIRED
   * - Visitas con usos (usedCount > 0) → COMPLETED
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async expireVisits() {
    this.logger.log('🧹 Verificando visitas expiradas...');
    
    try {
      const now = new Date();

      // Buscar todas las visitas cuyo período de validez ha terminado
      const expiredVisits = await this.visitRepo
        .createQueryBuilder('visit')
        .leftJoinAndSelect('visit.host', 'host')
        .leftJoinAndSelect('visit.vehicle', 'vehicle')
        .where('visit.validUntil < :now', { now })
        .andWhere('visit.status NOT IN (:...excludedStatuses)', {
          excludedStatuses: [
            VisitStatus.ACTIVE, 
            VisitStatus.EXPIRED,
            VisitStatus.CANCELLED,
            VisitStatus.COMPLETED,
          ],
        })
        .getMany();

      let expiredCount = 0;
      let completedCount = 0;

      for (const visit of expiredVisits) {
        // Determinar si la visita fue usada
        const wasUsed = visit.usedCount > 0 || visit.status === VisitStatus.READY_FOR_REENTRY;

        if (wasUsed) {
          // Si la visita fue usada al menos una vez, marcar como COMPLETADA
          visit.status = VisitStatus.COMPLETED;
          await this.visitRepo.save(visit);
          completedCount++;

          // Notificar al host sobre la finalización
          try {
            await this.notificationsService.create({
              recipientId: visit.host.id,
              type: NotificationType.VISIT_COMPLETED,
              title: 'Visita Completada',
              message: `La visita de ${visit.visitorName} ha finalizado. Usos registrados: ${visit.usedCount}${visit.maxUses ? `/${visit.maxUses}` : ''}. Período válido hasta ${visit.validUntil.toLocaleString('es-CL')}.`,
              data: {
                visitId: visit.id,
                visitorName: visit.visitorName,
                type: visit.type,
                validUntil: visit.validUntil,
                usedCount: visit.usedCount,
                maxUses: visit.maxUses,
                plate: visit.vehicle?.plate,
              },
            });
          } catch (notifError) {
            this.logger.warn(`⚠️ No se pudo notificar finalización de visita ${visit.id}:`, notifError);
          }
        } else {
          // Si la visita nunca fue usada, marcar como EXPIRADA
          visit.status = VisitStatus.EXPIRED;
          await this.visitRepo.save(visit);
          expiredCount++;

          // Notificar al host sobre la expiración
          try {
            await this.notificationsService.create({
              recipientId: visit.host.id,
              type: NotificationType.VISIT_EXPIRED,
              title: 'Visita Expiró',
              message: `La visita de ${visit.visitorName} ha expirado sin que ingresara. Período válido hasta ${visit.validUntil.toLocaleString('es-CL')}.`,
              data: {
                visitId: visit.id,
                visitorName: visit.visitorName,
                type: visit.type,
                validUntil: visit.validUntil,
                plate: visit.vehicle?.plate,
              },
            });
          } catch (notifError) {
            this.logger.warn(`⚠️ No se pudo notificar expiración de visita ${visit.id}:`, notifError);
          }
        }
      }

      if (expiredVisits.length > 0) {
        this.logger.log(`✅ Visitas procesadas: ${completedCount} completadas, ${expiredCount} expiradas`);
      }
    } catch (error) {
      this.logger.error('❌ Error al expirar visitas:', error);
    }
  }

  /**
   * Notificar visitas próximas a expirar - Ejecuta cada 30 minutos
   * Notifica las visitas (excepto ACTIVE) que expiran en 1-2 horas
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async notifyExpiringSoonVisits() {
    this.logger.log('🔔 Verificando visitas próximas a expirar...');
    
    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      // Buscar visitas próximas a expirar (excepto ACTIVE y ya EXPIRED)
      const expiringSoonVisits = await this.visitRepo
        .createQueryBuilder('visit')
        .leftJoinAndSelect('visit.host', 'host')
        .leftJoinAndSelect('visit.vehicle', 'vehicle')
        .where('visit.status NOT IN (:...excludedStatuses)', {
          excludedStatuses: [VisitStatus.ACTIVE, VisitStatus.EXPIRED],
        })
        .getMany();

      // Filtrar visitas que expiran entre 1 y 2 horas desde ahora
      const toNotify = expiringSoonVisits.filter(visit => {
        const expiryTime = new Date(visit.validUntil).getTime();
        return expiryTime > oneHourFromNow.getTime() && expiryTime <= twoHoursFromNow.getTime();
      });

      for (const visit of toNotify) {
        try {
          await this.notificationsService.create({
            recipientId: visit.host.id,
            type: NotificationType.VISIT_EXPIRING_SOON,
            title: 'Visita Próxima a Expirar',
            message: `La visita de ${visit.visitorName} expirará pronto. Válida hasta ${visit.validUntil.toLocaleString('es-CL')}.`,
            data: {
              visitId: visit.id,
              visitorName: visit.visitorName,
              type: visit.type,
              validUntil: visit.validUntil,
              plate: visit.vehicle?.plate,
            },
          });
        } catch (notifError) {
          this.logger.warn(`⚠️ No se pudo notificar visita próxima a expirar ${visit.id}:`, notifError);
        }
      }

      if (toNotify.length > 0) {
        this.logger.log(`✅ Notificaciones: ${toNotify.length} visitas próximas a expirar notificadas`);
      }
    } catch (error) {
      this.logger.error('❌ Error al notificar visitas próximas a expirar:', error);
    }
  }

  /**
   * Ejecuta todas las limpiezas manualmente
   * Útil para endpoints administrativos o testing
   */
  async runAllCleanups(): Promise<{
    tokens: number;
    detections: number;
    notifications: number;
    visits: number;
  }> {
    this.logger.log('🚀 Ejecutando todas las limpiezas manualmente...');
    
    const results = {
      tokens: 0,
      detections: 0,
      notifications: 0,
      visits: 0,
    };

    try {
      // Tokens
      results.tokens = await this.tokensService.cleanupExpiredTokens();
      
      // Detecciones
      const now = new Date();
      const detectionsResult = await this.accessAttemptRepo
        .createQueryBuilder()
        .update(AccessAttempt)
        .set({ 
          decision: 'Expirado',
          reason: 'Tiempo de decisión expirado - No se recibió respuesta del conserje',
          updatedAt: now,
        })
        .where('decision = :decision', { decision: 'Pendiente' })
        .andWhere('expiresAt IS NOT NULL')
        .andWhere('expiresAt < :now', { now })
        .execute();
      
      results.detections = detectionsResult.affected || 0;
      
      // Notificaciones
      const notificationsResult = await this.notificationRepo
        .createQueryBuilder()
        .softDelete()
        .where('expiresAt IS NOT NULL')
        .andWhere('expiresAt < :now', { now })
        .andWhere('deletedAt IS NULL')
        .execute();
      
      results.notifications = notificationsResult.affected || 0;
      
      // Visitas - aplicar la misma lógica que expireVisits()
      const expiredVisits = await this.visitRepo
        .createQueryBuilder('visit')
        .leftJoinAndSelect('visit.host', 'host')
        .where('visit.validUntil < :now', { now })
        .andWhere('visit.status NOT IN (:...excludedStatuses)', {
          excludedStatuses: [
            VisitStatus.ACTIVE, 
            VisitStatus.EXPIRED,
            VisitStatus.CANCELLED,
            VisitStatus.COMPLETED,
          ],
        })
        .getMany();
      
      for (const visit of expiredVisits) {
        // Aplicar misma lógica: con usos → COMPLETED, sin usos → EXPIRED
        const wasUsed = visit.usedCount > 0 || visit.status === VisitStatus.READY_FOR_REENTRY;
        visit.status = wasUsed ? VisitStatus.COMPLETED : VisitStatus.EXPIRED;
        await this.visitRepo.save(visit);
      }
      
      results.visits = expiredVisits.length;
      
      this.logger.log('✅ Limpieza manual completada:', results);
      
      return results;
    } catch (error) {
      this.logger.error('❌ Error durante la limpieza manual:', error);
      throw error;
    }
  }
}
