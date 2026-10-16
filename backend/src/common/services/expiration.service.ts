import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TokensService } from '../../tokens/tokens.service';
import { AccessAttempt } from '../../detections/entities/access-attempt.entity';
import { Notification } from '../../notifications/entities/notification.entity';
import { Visit, VisitStatus } from '../../visits/entities/visit.entity';
import {
  ConciergeSession,
  SessionStatus,
} from '../../digital-concierge/entities/concierge-session.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/entities/notification.entity';
import { canTransition } from '../../visits/visit-state-machine';
import {
  parseVisitActiveGraceHours,
  parseVisitApprovalTtlMinutes,
} from '../../config/env.validation';
import { errorMessage } from '../utils/error-message.util';

/**
 * Estados que el barrido por `validUntil` cierra (Fase 4 · P3): lista BLANCA.
 * Fuera quedan `ACTIVE` (el visitante sigue adentro) y los terminales
 * (`COMPLETED`, `CANCELLED`, `EXPIRED`, `DENIED`): un rechazo ya no se
 * convierte en "expirada".
 */
const VALIDITY_SWEEP_STATUSES: readonly VisitStatus[] = Object.freeze([
  VisitStatus.AWAITING_APPROVAL,
  VisitStatus.PENDING,
  VisitStatus.READY_FOR_REENTRY,
]);

/** Estados que reciben el aviso de "próxima a expirar". */
const EXPIRING_SOON_STATUSES: readonly VisitStatus[] = Object.freeze([
  VisitStatus.PENDING,
  VisitStatus.READY_FOR_REENTRY,
]);

/**
 * Nombres de los crons de este servicio (Fase 4 · P7, QA A2): con nombre, el
 * test de arranque comprueba en `SchedulerRegistry` que TODOS quedaron
 * registrados (un cron en un provider no estático se descarta en silencio).
 */
export const EXPIRATION_CRON_JOBS = {
  tokens: 'expiration.tokens',
  pendingDetections: 'expiration.pending-detections',
  notifications: 'expiration.notifications',
  awaitingVisits: 'expiration.awaiting-visits',
  visitsPastValidity: 'expiration.visits-past-validity',
  abandonedActiveVisits: 'expiration.abandoned-active-visits',
  abandonedSessions: 'expiration.abandoned-concierge-sessions',
  expiringSoonVisits: 'expiration.expiring-soon-visits',
} as const;

/**
 * Edad (desde `startTime`) desde la que una sesión del conserje que sigue
 * ACTIVE se da por abandonada (Fase 4 · P7, QA A2): el kiosko o el hub se
 * cayó y nadie la cerró. El timeout "perezoso" de 15 min de
 * `DigitalConciergeService` solo corre cuando alguien consulta la sesión.
 */
export const ABANDONED_SESSION_AGE_SQL = `interval '1 hour'`;

/**
 * Servicio centralizado para manejar TODAS las expiraciones automáticas del sistema
 * TypeORM no soporta TTL (Time To Live) automático, por lo que necesitamos
 * ejecutar tareas programadas para marcar registros como expirados
 */
@Injectable()
export class ExpirationService {
  private readonly logger = new Logger(ExpirationService.name);
  private readonly visitApprovalTtlMinutes: number;
  /** VISIT_ACTIVE_GRACE_HOURS: espera tras `validUntil` para cerrar una ACTIVE. */
  private readonly activeGraceHours: number;

  constructor(
    private readonly tokensService: TokensService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(AccessAttempt)
    private readonly accessAttemptRepo: Repository<AccessAttempt>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(Visit)
    private readonly visitRepo: Repository<Visit>,
    @InjectRepository(ConciergeSession)
    private readonly sessionRepo: Repository<ConciergeSession>,
    configService: ConfigService,
  ) {
    this.visitApprovalTtlMinutes = parseVisitApprovalTtlMinutes(
      configService.get<string>('VISIT_APPROVAL_TTL_MINUTES'),
    );
    this.activeGraceHours = parseVisitActiveGraceHours(
      configService.get<string>('VISIT_ACTIVE_GRACE_HOURS'),
    );
  }

  /**
   * Limpieza de tokens expirados - Ejecuta cada 10 minutos
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: EXPIRATION_CRON_JOBS.tokens })
  async cleanupExpiredTokens() {
    this.logger.log('🧹 Iniciando limpieza de tokens expirados...');

    try {
      const removedCount = await this.tokensService.cleanupExpiredTokens();

      if (removedCount > 0) {
        this.logger.log(
          `✅ Tokens: ${removedCount} tokens expirados eliminados`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Error durante la limpieza de tokens: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Marcar Access Attempts pendientes como expirados - Ejecuta cada 5 minutos
   * Las detecciones pendientes expiran en 10 minutos si no se responde
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: EXPIRATION_CRON_JOBS.pendingDetections,
  })
  async expirePendingDetections() {
    this.logger.log('🧹 Verificando detecciones pendientes expiradas...');

    try {
      const now = new Date();

      const result = await this.accessAttemptRepo
        .createQueryBuilder()
        .update(AccessAttempt)
        .set({
          decision: 'Expirado',
          reason:
            'Tiempo de decisión expirado - No se recibió respuesta del conserje',
          updatedAt: now,
        })
        .where('decision = :decision', { decision: 'Pendiente' })
        .andWhere('expiresAt IS NOT NULL')
        .andWhere('expiresAt < :now', { now })
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(
          `✅ Detecciones: ${result.affected} detecciones pendientes marcadas como expiradas`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Error al expirar detecciones pendientes: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Eliminar notificaciones expiradas - Ejecuta cada 30 minutos
   * Las notificaciones con expiresAt son soft-deleted después de expirar
   */
  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: EXPIRATION_CRON_JOBS.notifications,
  })
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
        this.logger.log(
          `✅ Notificaciones: ${result.affected} notificaciones expiradas eliminadas`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Error al limpiar notificaciones expiradas: ${errorMessage(error)}`,
      );
    }
  }

  /**
   * Solicitudes del conserje digital sin respuesta (Fase 4 · P3) - cada
   * minuto. Una visita `AWAITING_APPROVAL` cuyo `createdAt` supera
   * `VISIT_APPROVAL_TTL_MINUTES` pasa a `EXPIRED`.
   *
   * Es un único `UPDATE ... WHERE status = 'awaiting_approval'`: si el
   * residente aprueba o rechaza al mismo tiempo, solo una de las dos
   * transiciones afecta la fila (nunca se pisa una aprobación).
   *
   * @returns cantidad de solicitudes expiradas.
   */
  @Cron(CronExpression.EVERY_MINUTE, {
    name: EXPIRATION_CRON_JOBS.awaitingVisits,
  })
  async expireAwaitingApprovalVisits(): Promise<number> {
    try {
      const cutoff = new Date(
        Date.now() - this.visitApprovalTtlMinutes * 60 * 1000,
      );
      const result = await this.visitRepo.update(
        {
          status: VisitStatus.AWAITING_APPROVAL,
          createdAt: LessThan(cutoff),
        },
        { status: VisitStatus.EXPIRED },
      );
      const expired = result.affected ?? 0;

      if (expired > 0) {
        this.logger.log(
          `✅ Visitas: ${expired} solicitudes sin respuesta del residente expiradas (TTL ${this.visitApprovalTtlMinutes} min)`,
        );
      }
      return expired;
    } catch (error) {
      this.logger.error(
        `❌ Error al expirar solicitudes de visita sin respuesta: ${errorMessage(error)}`,
      );
      return 0;
    }
  }

  /**
   * Marcar visitas como expiradas o completadas - Ejecuta cada 10 minutos
   * - Visitas usadas (READY_FOR_REENTRY) → COMPLETED
   * - Visitas sin usar (PENDING, AWAITING_APPROVAL) → EXPIRED
   * - DENIED, CANCELLED, COMPLETED, EXPIRED y ACTIVE no se tocan (las ACTIVE
   *   las cierra `expireAbandonedActiveVisits`, pasada la gracia)
   */
  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: EXPIRATION_CRON_JOBS.visitsPastValidity,
  })
  async expireVisits(): Promise<number> {
    this.logger.log('🧹 Verificando visitas expiradas...');

    try {
      const expiredVisits = await this.findVisitsPastValidity();

      let expiredCount = 0;
      let completedCount = 0;

      for (const visit of expiredVisits) {
        const next = this.closeValidityStatus(visit);
        if (!(await this.transitionIfUnchanged(visit, next))) {
          continue;
        }

        if (next === VisitStatus.COMPLETED) {
          completedCount++;
        } else {
          expiredCount++;
        }
        await this.notifyVisitClosed(visit, next);
      }

      if (expiredVisits.length > 0) {
        this.logger.log(
          `✅ Visitas procesadas: ${completedCount} completadas, ${expiredCount} expiradas`,
        );
      }
      return completedCount + expiredCount;
    } catch (error) {
      this.logger.error(`❌ Error al expirar visitas: ${errorMessage(error)}`);
      return 0;
    }
  }

  /**
   * Visitas ACTIVE abandonadas (Fase 4 · P7, corrección QA A1) - cada 10
   * minutos. Una visita `ACTIVE` cuyo `validUntil` pasó hace más de
   * `VISIT_ACTIVE_GRACE_HOURS` (el LPR no vio la salida) pasa a `EXPIRED`.
   * `expireVisits` no las toca (el visitante puede seguir adentro dentro de
   * la gracia); sin este cierre quedaban ACTIVE para siempre y la retención
   * nunca las anonimizaba.
   *
   * Un único `UPDATE ... WHERE status = 'active'`, transición permitida por
   * `visit-state-machine.ts` (ACTIVE → EXPIRED): si llega un check-out al
   * mismo tiempo, solo una de las dos escrituras afecta la fila. No se
   * notifica al anfitrión: no es una visita "que no ingresó".
   *
   * @returns cantidad de visitas cerradas.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: EXPIRATION_CRON_JOBS.abandonedActiveVisits,
  })
  async expireAbandonedActiveVisits(): Promise<number> {
    if (!canTransition(VisitStatus.ACTIVE, VisitStatus.EXPIRED)) {
      return 0;
    }
    try {
      const cutoff = new Date(
        Date.now() - this.activeGraceHours * 60 * 60 * 1000,
      );
      const result = await this.visitRepo.update(
        { status: VisitStatus.ACTIVE, validUntil: LessThan(cutoff) },
        { status: VisitStatus.EXPIRED },
      );
      const closed = result.affected ?? 0;
      if (closed > 0) {
        this.logger.log(
          `✅ Visitas: ${closed} visitas ACTIVE sin salida cerradas como expiradas (gracia ${this.activeGraceHours} h)`,
        );
      }
      return closed;
    } catch (error) {
      this.logger.error(
        `❌ Error al cerrar visitas ACTIVE abandonadas: ${errorMessage(error)}`,
      );
      return 0;
    }
  }

  /**
   * Sesiones del conserje abandonadas (Fase 4 · P7, QA A2) - cada 10 minutos.
   * Una sesión `ACTIVE` que empezó hace más de 1 hora pasa a `TIMEOUT` con
   * `endTime` = el que tenía o `startTime + 1 h` (no "ahora": así su plazo de
   * retención corre desde que se abandonó, no desde que el cron la vio). Sin
   * este cierre quedaba ACTIVE para siempre y la retención nunca la
   * anonimizaba.
   *
   * Vive acá y no en `DigitalConciergeService`: ese provider depende (vía
   * `VisitsService`) de `TenantContextService`, request-scoped, y Nest
   * descarta los `@Cron` de un provider no estático.
   *
   * Un único `UPDATE ... WHERE status = 'active'`: no pisa un cierre ni una
   * respuesta concurrentes. La solicitud `AWAITING_APPROVAL` de la sesión NO
   * se toca acá: la expira `expireAwaitingApprovalVisits` por su TTL (un
   * UPDATE condicionado al estado, así que no hay doble expiración), y
   * mientras tanto `/respond` ya la rechaza porque la sesión no está activa
   * (es la única vía para resolverla).
   *
   * @returns cantidad de sesiones cerradas.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, {
    name: EXPIRATION_CRON_JOBS.abandonedSessions,
  })
  async closeAbandonedSessions(): Promise<number> {
    try {
      const startedAt = `COALESCE("startTime", "createdAt")`;
      const result = await this.sessionRepo
        .createQueryBuilder()
        .update(ConciergeSession)
        .set({
          status: SessionStatus.TIMEOUT,
          endTime: () =>
            `COALESCE("endTime", ${startedAt} + ${ABANDONED_SESSION_AGE_SQL})`,
        })
        .where('status = :status', { status: SessionStatus.ACTIVE })
        .andWhere(`${startedAt} < now() - ${ABANDONED_SESSION_AGE_SQL}`)
        .execute();
      const closed = result.affected ?? 0;
      if (closed > 0) {
        this.logger.log(
          `✅ Conserje digital: ${closed} sesiones abandonadas cerradas por timeout`,
        );
      }
      return closed;
    } catch (error) {
      this.logger.error(
        `❌ Error al cerrar sesiones abandonadas del conserje: ${errorMessage(error)}`,
      );
      return 0;
    }
  }

  /**
   * Notificar visitas próximas a expirar - Ejecuta cada 30 minutos
   * Notifica las visitas programadas o listas para reingresar que expiran en
   * 1-2 horas (no las terminales, las en curso ni las solicitudes sin aprobar)
   */
  @Cron(CronExpression.EVERY_30_MINUTES, {
    name: EXPIRATION_CRON_JOBS.expiringSoonVisits,
  })
  async notifyExpiringSoonVisits() {
    this.logger.log('🔔 Verificando visitas próximas a expirar...');

    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const expiringSoonVisits = await this.visitRepo
        .createQueryBuilder('visit')
        .leftJoinAndSelect('visit.host', 'host')
        .leftJoinAndSelect('visit.vehicle', 'vehicle')
        .where('visit.status IN (:...statuses)', {
          statuses: [...EXPIRING_SOON_STATUSES],
        })
        .getMany();

      // Filtrar visitas que expiran entre 1 y 2 horas desde ahora
      const toNotify = expiringSoonVisits.filter((visit) => {
        const expiryTime = new Date(visit.validUntil).getTime();
        return (
          expiryTime > oneHourFromNow.getTime() &&
          expiryTime <= twoHoursFromNow.getTime()
        );
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
          this.logger.warn(
            `⚠️ No se pudo notificar visita próxima a expirar ${visit.id}: ${errorMessage(notifError)}`,
          );
        }
      }

      if (toNotify.length > 0) {
        this.logger.log(
          `✅ Notificaciones: ${toNotify.length} visitas próximas a expirar notificadas`,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ Error al notificar visitas próximas a expirar: ${errorMessage(error)}`,
      );
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
          reason:
            'Tiempo de decisión expirado - No se recibió respuesta del conserje',
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

      // Visitas: solicitudes sin respuesta (TTL) + misma lógica que
      // expireVisits() (sin notificar)
      results.visits = await this.expireAwaitingApprovalVisits();
      results.visits += await this.expireAbandonedActiveVisits();
      const expiredVisits = await this.findVisitsPastValidity();
      for (const visit of expiredVisits) {
        if (
          await this.transitionIfUnchanged(
            visit,
            this.closeValidityStatus(visit),
          )
        ) {
          results.visits++;
        }
      }

      this.logger.log(
        `✅ Limpieza manual completada: ${JSON.stringify(results)}`,
      );

      return results;
    } catch (error) {
      this.logger.error(
        `❌ Error durante la limpieza manual: ${errorMessage(error)}`,
      );
      throw error;
    }
  }

  /** Visitas cuya ventana de validez terminó y que el barrido debe cerrar. */
  private async findVisitsPastValidity(): Promise<Visit[]> {
    return this.visitRepo
      .createQueryBuilder('visit')
      .leftJoinAndSelect('visit.host', 'host')
      .leftJoinAndSelect('visit.vehicle', 'vehicle')
      .where('visit.validUntil < :now', { now: new Date() })
      .andWhere('visit.status IN (:...statuses)', {
        statuses: [...VALIDITY_SWEEP_STATUSES],
      })
      .getMany();
  }

  /**
   * Estado final de una visita cuya ventana terminó: `COMPLETED` si se usó
   * (READY_FOR_REENTRY), `EXPIRED` si nunca entró.
   */
  private closeValidityStatus(visit: Visit): VisitStatus {
    return visit.status === VisitStatus.READY_FOR_REENTRY
      ? VisitStatus.COMPLETED
      : VisitStatus.EXPIRED;
  }

  /**
   * Aplica `visit.status → next` solo si la máquina de estados lo permite y
   * si la fila sigue en el estado leído (`WHERE status = :leído`): no pisa
   * una aprobación, check-in o rechazo concurrente.
   */
  private async transitionIfUnchanged(
    visit: Visit,
    next: VisitStatus,
  ): Promise<boolean> {
    if (!canTransition(visit.status, next)) {
      return false;
    }
    const result = await this.visitRepo.update(
      { id: visit.id, status: visit.status },
      { status: next },
    );
    if (!result.affected) {
      return false;
    }
    visit.status = next;
    return true;
  }

  private async notifyVisitClosed(
    visit: Visit,
    status: VisitStatus,
  ): Promise<void> {
    try {
      if (status === VisitStatus.COMPLETED) {
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
        return;
      }

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
      this.logger.warn(
        `⚠️ No se pudo notificar el cierre de la visita ${visit.id}: ${errorMessage(notifError)}`,
      );
    }
  }
}
