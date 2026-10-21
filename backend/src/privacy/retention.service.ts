import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';
import { errorMessage } from '../common/utils/error-message.util';
import { DisabledUserAnonymizer } from './disabled-user-anonymizer.service';
import { MediaPurgerService } from './media-purger.service';
import { loadRetentionConfig, type RetentionConfig } from './retention.config';
import {
  type DetectionFrameRow,
  RetentionRepository,
} from './retention.repository';
import {
  type RetentionAction,
  type RetentionKind,
  SET_BASED_SWEEPS,
  type SetBasedCategory,
  type SetBasedSweep,
} from './retention-sql';

/** Filas por lote en las categorías de la BD. */
export const RETENTION_BATCH_SIZE = 500;
/** Tope de lotes por categoría y corrida (50.000 filas): lo que sobre sigue mañana. */
export const RETENTION_MAX_BATCHES = 100;
/** Usuarios por lote (cada uno es una transacción y un cierre de sesiones). */
export const RETENTION_USER_BATCH_SIZE = 50;
/** Tope de lotes de usuarios por corrida (1.000 cuentas). */
export const RETENTION_MAX_USER_BATCHES = 20;

/** Todas las categorías del barrido, en el orden en que corren. */
export type RetentionCategory =
  | SetBasedCategory
  | 'detectionImages'
  | 'detections'
  | 'disabledUsers';

/** Resultado de una categoría (solo conteos: nunca datos personales). */
export interface RetentionCategoryResult {
  action: RetentionAction;
  /** Plazo aplicado en días; `null` = vencimiento propio (better-auth). */
  days: number | null;
  /** Filas procesadas (o que se procesarían, en dry-run). */
  rows: number;
  /** Se llegó al tope de lotes: puede quedar trabajo para la próxima corrida. */
  capped: boolean;
  /** Intentos de acceso anonimizados junto con sus detecciones. */
  accessAttempts?: number;
  /** Archivos borrados en Cloudinary. */
  imagesDeleted?: number;
  /**
   * Imágenes cuya referencia se conservó: Cloudinary falló (se reintenta en
   * la próxima corrida) o no son de nuestro Cloudinary (`imagesForeign`).
   */
  imagesPending?: number;
  /** De `imagesPending`, las que no son de nuestro Cloudinary (revisión manual). */
  imagesForeign?: number;
  /** Filas que fallaron una a una (usuarios). */
  failed?: number;
  /** La categoría completa falló (ver el log); el resto siguió. */
  error?: true;
}

export type RetentionRunStatus = 'completed' | 'already-running' | 'failed';

/** Resumen de una corrida: lo que se loguea y queda en la auditoría. */
export interface RetentionRunSummary {
  status: RetentionRunStatus;
  dryRun: boolean;
  /**
   * `RETENTION_ENABLED`: con `false` solo corre la limpieza técnica
   * (`system_logs` y las tablas de better-auth), no las categorías de datos
   * personales.
   */
  personalDataEnabled: boolean;
  startedAt: string;
  durationMs: number;
  categories: Partial<Record<RetentionCategory, RetentionCategoryResult>>;
}

/** Opciones de una corrida (el script manual fuerza el dry-run o la escritura). */
export interface RetentionRunOptions {
  /** Pisa `RETENTION_DRY_RUN` en esta corrida. */
  dryRun?: boolean;
}

/** Contexto de una corrida. */
interface RunContext {
  dryRun: boolean;
  personalDataEnabled: boolean;
}

interface RetentionStep {
  category: RetentionCategory;
  kind: RetentionKind;
  run: (context: RunContext) => Promise<RetentionCategoryResult>;
}

/**
 * Fase 4 · P7.R (Ley 21.719, docs/modulos/privacidad-ley-21719.md §3):
 * barrido diario de retención. Runbook: privacy/README.md.
 *
 *  - Corre a las 3:30 (hora de Chile), por lotes de 500 filas con un tope
 *    por categoría y corrida (lo que sobre sigue la noche siguiente).
 *  - Idempotente: cada categoría excluye lo ya procesado (`anonymizedAt`,
 *    imagen ya vacía o fila ya borrada), así que repetirla no cambia nada.
 *  - Nunca toca registros vigentes: visitas no terminales, sesiones ACTIVE ni
 *    detecciones con un intento esperando al conserje. (Las visitas ACTIVE y
 *    las sesiones abandonadas las cierran `ExpirationService` y
 *    `DigitalConciergeService`; recién entonces entran acá.)
 *  - `RETENTION_DRY_RUN=true` (o `run({ dryRun: true })`) solo cuenta y
 *    registra lo que haría, en TODAS las categorías.
 *  - `RETENTION_ENABLED=false` apaga solo las categorías de datos personales:
 *    la limpieza técnica corre siempre (decisión de Nova, QA M4).
 *  - Una sola corrida a la vez (bandera en memoria + advisory lock de
 *    Postgres). Una categoría que falla no detiene a las demás.
 *  - Es el ÚNICO barrido de `system_logs` y `audit_logs` (antes había un cron
 *    de 30 días fijo en `LogsService` y un `AuditService.cleanup` sin caller).
 *  - El resumen (solo conteos) va al log y a la auditoría (módulo PRIVACY,
 *    acción RETENTION_SWEEP), que lee el super-admin.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly config: RetentionConfig;
  private running = false;

  constructor(
    private readonly repository: RetentionRepository,
    private readonly mediaPurger: MediaPurgerService,
    private readonly userAnonymizer: DisabledUserAnonymizer,
    private readonly auditService: AuditService,
    configService: ConfigService,
  ) {
    this.config = loadRetentionConfig({
      get: (name) => configService.get<string>(name),
    });
  }

  /** Cron diario (madrugada, hora de Chile). */
  @Cron('0 30 3 * * *', {
    name: 'privacy-retention',
    timeZone: 'America/Santiago',
  })
  async handleCron(): Promise<void> {
    await this.run();
  }

  /** Una corrida completa. Nunca lanza: los errores quedan en el resumen. */
  async run(options: RetentionRunOptions = {}): Promise<RetentionRunSummary> {
    const startedAt = new Date();
    const context: RunContext = {
      dryRun: options.dryRun ?? this.config.dryRun,
      personalDataEnabled: this.config.enabled,
    };
    if (this.running) {
      this.logger.warn('Retención: ya hay una corrida en curso; se omite');
      return this.summary('already-running', startedAt, context, {});
    }
    this.running = true;
    try {
      if (!context.personalDataEnabled) {
        this.logger.log(
          'Retención de datos personales deshabilitada (RETENTION_ENABLED=false): solo corre la limpieza técnica',
        );
      }
      const categories = await this.repository.withRunLock(() =>
        this.sweepAll(context),
      );
      if (categories === null) {
        this.logger.warn(
          'Retención: otra instancia tiene el lock de la corrida; se omite',
        );
        return this.summary('already-running', startedAt, context, {});
      }
      const summary = this.summary('completed', startedAt, context, categories);
      this.logSummary(summary);
      await this.recordAudit(summary);
      return summary;
    } catch (error) {
      this.logger.error(
        `Retención: la corrida falló (${context.dryRun ? 'dry-run' : 'real'}): ${errorMessage(error)}`,
      );
      return this.summary('failed', startedAt, context, {});
    } finally {
      this.running = false;
    }
  }

  private async sweepAll(
    context: RunContext,
  ): Promise<Partial<Record<RetentionCategory, RetentionCategoryResult>>> {
    const results: Partial<Record<RetentionCategory, RetentionCategoryResult>> =
      {};
    for (const step of this.steps()) {
      if (step.kind === 'personal' && !context.personalDataEnabled) {
        continue;
      }
      try {
        results[step.category] = await step.run(context);
      } catch (error) {
        this.logger.error(
          `Retención: falló la categoría ${step.category}: ${errorMessage(error)}`,
        );
        results[step.category] = {
          action: actionOf(step.category),
          days: this.daysOf(step.category),
          rows: 0,
          capped: false,
          error: true,
        };
      }
    }
    return results;
  }

  /**
   * Orden: imágenes, anonimizaciones (las visitas antes que sus vehículos
   * huérfanos), borrados, usuarios y al final la limpieza técnica.
   */
  private steps(): RetentionStep[] {
    const setBased = (category: SetBasedCategory): RetentionStep => {
      const sweep = sweepOf(category);
      return {
        category,
        kind: sweep.kind,
        run: (context) => this.sweepSetBased(sweep, context),
      };
    };
    return [
      {
        category: 'detectionImages',
        kind: 'personal',
        run: (context) => this.sweepDetectionImages(context),
      },
      setBased('anomalyImages'),
      setBased('visits'),
      setBased('conciergeSessions'),
      setBased('visitorVehicles'),
      {
        category: 'detections',
        kind: 'personal',
        run: (context) => this.sweepDetections(context),
      },
      setBased('anomalies'),
      setBased('notifications'),
      setBased('pendingActions'),
      setBased('auditLogs'),
      {
        category: 'disabledUsers',
        kind: 'personal',
        run: (context) => this.sweepDisabledUsers(context),
      },
      setBased('systemLogs'),
      setBased('authSessions'),
      setBased('authVerifications'),
      setBased('authRateLimits'),
    ];
  }

  private async sweepSetBased(
    sweep: SetBasedSweep,
    context: RunContext,
  ): Promise<RetentionCategoryResult> {
    const days = sweep.period ? this.config.periods[sweep.period] : null;
    const base = { action: sweep.action, days };
    if (context.dryRun) {
      return {
        ...base,
        rows: await this.repository.countSetBased(sweep, days ?? 0),
        capped: false,
      };
    }
    let rows = 0;
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
      const affected = await this.repository.runSetBasedBatch(
        sweep,
        days ?? 0,
        RETENTION_BATCH_SIZE,
      );
      rows += affected;
      if (affected < RETENTION_BATCH_SIZE) {
        return { ...base, rows, capped: false };
      }
    }
    return { ...base, rows, capped: true };
  }

  /**
   * Recorte y frame de las detecciones vencidas o ya anonimizadas (el frame
   * también en Cloudinary).
   */
  private async sweepDetectionImages(
    context: RunContext,
  ): Promise<RetentionCategoryResult> {
    const days = this.config.periods.RETENTION_IMAGES_DAYS;
    const base = { action: 'purge-images' as const, days };
    if (context.dryRun) {
      return {
        ...base,
        rows: await this.repository.countDetectionImages(days),
        capped: false,
      };
    }
    // Ids cuyo archivo conservó la referencia (Cloudinary falló o no es
    // nuestro): no se vuelven a pedir en esta corrida.
    const kept: string[] = [];
    let rows = 0;
    let imagesDeleted = 0;
    let imagesForeign = 0;
    const result = (capped: boolean): RetentionCategoryResult => ({
      ...base,
      rows,
      capped,
      imagesDeleted,
      imagesPending: kept.length,
      imagesForeign,
    });
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
      const candidates = await this.repository.findDetectionImageBatch(
        days,
        RETENTION_BATCH_SIZE,
        kept,
      );
      const purge = await this.purgeFrames(candidates);
      rows += await this.repository.clearDetectionImages(
        candidates.map((row) => row.id),
        purge.clearableIds,
      );
      imagesDeleted += purge.deleted;
      imagesForeign += purge.foreign;
      kept.push(...purge.keptIds);
      if (candidates.length < RETENTION_BATCH_SIZE) {
        return result(false);
      }
    }
    return result(true);
  }

  /** Detecciones e intentos: patente, residente, motivo e imágenes. */
  private async sweepDetections(
    context: RunContext,
  ): Promise<RetentionCategoryResult> {
    const days = this.config.periods.RETENTION_ACCESS_LOG_DAYS;
    const base = { action: 'anonymize' as const, days };
    if (context.dryRun) {
      return {
        ...base,
        rows: await this.repository.countDetectionsToAnonymize(days),
        capped: false,
      };
    }
    let rows = 0;
    let accessAttempts = 0;
    let imagesDeleted = 0;
    let imagesPending = 0;
    let imagesForeign = 0;
    const result = (capped: boolean): RetentionCategoryResult => ({
      ...base,
      rows,
      capped,
      accessAttempts,
      imagesDeleted,
      imagesPending,
      imagesForeign,
    });
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch++) {
      const candidates = await this.repository.findDetectionsToAnonymize(
        days,
        RETENTION_BATCH_SIZE,
      );
      if (candidates.length === 0) {
        return result(false);
      }
      const purge = await this.purgeFrames(candidates);
      const anonymized = await this.repository.anonymizeDetections(
        candidates.map((row) => row.id),
        purge.clearableIds,
      );
      rows += anonymized.detections;
      accessAttempts += anonymized.accessAttempts;
      imagesDeleted += purge.deleted;
      imagesPending += purge.keptIds.length;
      imagesForeign += purge.foreign;
      // Sin avance (otra transacción las tomó o les apareció un intento
      // pendiente): se corta para no repetir el mismo lote.
      if (
        candidates.length < RETENTION_BATCH_SIZE ||
        anonymized.detections === 0
      ) {
        return result(false);
      }
    }
    return result(true);
  }

  /** Cuentas deshabilitadas hace más del plazo (y reintento de sus fotos). */
  private async sweepDisabledUsers(
    context: RunContext,
  ): Promise<RetentionCategoryResult> {
    const days = this.config.periods.RETENTION_DISABLED_USERS_DAYS;
    const base = { action: 'anonymize' as const, days };
    if (context.dryRun) {
      return {
        ...base,
        rows: await this.repository.countDisabledUsersToAnonymize(days),
        capped: false,
      };
    }
    // Cuentas que fallaron o cuya foto sigue en Cloudinary: no se repiten en
    // esta corrida.
    const skip: string[] = [];
    let rows = 0;
    let failed = 0;
    let imagesDeleted = 0;
    let imagesPending = 0;
    const result = (capped: boolean): RetentionCategoryResult => ({
      ...base,
      rows,
      capped,
      failed,
      imagesDeleted,
      imagesPending,
    });
    for (let batch = 0; batch < RETENTION_MAX_USER_BATCHES; batch++) {
      const candidates = await this.repository.findDisabledUsersToAnonymize(
        days,
        RETENTION_USER_BATCH_SIZE,
        skip,
      );
      for (const { id } of candidates) {
        try {
          const outcome = await this.userAnonymizer.anonymize(id);
          if (!outcome.alreadyAnonymized) {
            rows += 1;
          }
          imagesDeleted += outcome.picturesDeleted;
          if (outcome.picturePending) {
            imagesPending += 1;
            skip.push(id);
          }
        } catch (error) {
          failed += 1;
          skip.push(id);
          this.logger.warn(
            `Retención: no se pudo anonimizar la cuenta ${id}: ${errorMessage(error)}`,
          );
        }
      }
      if (candidates.length < RETENTION_USER_BATCH_SIZE) {
        return result(false);
      }
    }
    return result(true);
  }

  private purgeFrames(rows: readonly DetectionFrameRow[]) {
    return this.mediaPurger.purgeBatch(
      rows.map((row) => ({ id: row.id, url: row.fullFramePath })),
      'lpr-frame',
    );
  }

  private daysOf(category: RetentionCategory): number | null {
    switch (category) {
      case 'detectionImages':
        return this.config.periods.RETENTION_IMAGES_DAYS;
      case 'detections':
        return this.config.periods.RETENTION_ACCESS_LOG_DAYS;
      case 'disabledUsers':
        return this.config.periods.RETENTION_DISABLED_USERS_DAYS;
      default: {
        const period = sweepOf(category).period;
        return period ? this.config.periods[period] : null;
      }
    }
  }

  private summary(
    status: RetentionRunStatus,
    startedAt: Date,
    context: RunContext,
    categories: Partial<Record<RetentionCategory, RetentionCategoryResult>>,
  ): RetentionRunSummary {
    return {
      status,
      dryRun: context.dryRun,
      personalDataEnabled: context.personalDataEnabled,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      categories,
    };
  }

  /** Una línea con los conteos (sin datos personales) y avisos aparte. */
  private logSummary(summary: RetentionRunSummary): void {
    const entries = Object.entries(summary.categories) as Array<
      [RetentionCategory, RetentionCategoryResult]
    >;
    const counts = entries
      .map(([category, result]) => `${category}=${result.rows}`)
      .join(' ');
    this.logger.log(
      `Retención${summary.dryRun ? ' (dry-run: no se escribió nada)' : ''}${summary.personalDataEnabled ? '' : ' (solo limpieza técnica)'} en ${summary.durationMs} ms: ${counts}`,
    );
    for (const [category, result] of entries) {
      if (result.capped) {
        this.logger.warn(
          `Retención: ${category} llegó al tope de lotes; sigue en la próxima corrida`,
        );
      }
      if (result.imagesPending) {
        this.logger.warn(
          `Retención: ${category} conservó ${result.imagesPending} referencia(s) de imagen (${result.imagesForeign ?? 0} fuera de nuestro Cloudinary, para revisión)`,
        );
      }
    }
  }

  private async recordAudit(summary: RetentionRunSummary): Promise<void> {
    try {
      await this.auditService.log({
        module: AuditModule.PRIVACY,
        action: AuditAction.RETENTION_SWEEP,
        entityType: 'RetentionRun',
        organizationId: null,
        newValue: summary,
        description: summary.dryRun
          ? 'Barrido de retención (dry-run: sin cambios)'
          : 'Barrido de retención de datos personales',
      });
    } catch (error) {
      this.logger.error(
        `Retención: no se pudo registrar la corrida en la auditoría: ${errorMessage(error)}`,
      );
    }
  }
}

function sweepOf(category: SetBasedCategory): SetBasedSweep {
  const sweep = SET_BASED_SWEEPS.find((entry) => entry.category === category);
  if (!sweep) {
    throw new Error(`Categoría de retención desconocida: ${category}`);
  }
  return sweep;
}

function actionOf(category: RetentionCategory): RetentionAction {
  switch (category) {
    case 'detectionImages':
      return 'purge-images';
    case 'detections':
    case 'disabledUsers':
      return 'anonymize';
    default:
      return sweepOf(category).action;
  }
}
