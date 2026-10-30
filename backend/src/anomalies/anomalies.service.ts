import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  LessThan,
  Repository,
  type FindOptionsSelect,
  type FindOptionsWhere,
} from 'typeorm';
import { AnomalyEvent } from './entities/anomaly-event.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { VisionAnalysisService } from './services/vision-analysis.service';
import { AiVisionBudget } from './services/ai-vision-budget';
import { User } from '../users/entities/user.entity';
import {
  parseAiVisionDailyCap,
  parseAiVisionRatePerMinute,
} from '../config/env.validation';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  canViewWholeCondominium,
  type TenantActor,
} from '../common/tenant/tenant-actor';
import { scopeWhere } from '../common/tenant/tenant-context.util';
import type { AnomalyAiStatus, AnomalyStatus } from './anomaly-status';
import {
  DEFAULT_ANOMALIES_LIMIT,
  MAX_ANOMALIES_LIMIT,
  type ListAnomaliesQueryDto,
} from './dto/list-anomalies-query.dto';
import type { UpdateAnomalyStatusDto } from './dto/update-anomaly-status.dto';

/**
 * Tipos de anomalía que emite el Guardián. Lista blanca en la ingesta: el
 * tipo se interpola en el prompt de Vision, así que un valor libre sería una
 * inyección de prompt desde cualquiera que tenga una API key de servicio.
 */
export const ANOMALY_TYPES = ['intrusion', 'loitering'] as const;

/** Un análisis `pending` más viejo que esto quedó huérfano (el proceso murió). */
export const AI_PENDING_MAX_AGE_MS = 5 * 60_000;
/** Cada cuánto se barren los `pending` huérfanos. */
export const AI_PENDING_SWEEP_INTERVAL_MS = 60_000;
const AI_PENDING_SWEEP_INITIAL_DELAY_MS = 5_000;
const AI_PENDING_SWEEP_BATCH = 500;
const AI_INTERRUPTED_REASONING = 'Análisis interrumpido. Evaluar manualmente.';

/** Anomalía con el nombre de quien la resolvió (sin email ni otros datos). */
export type AnomalyWithResolver = AnomalyEvent & {
  resolvedByName: string | null;
};

/** Resultado de `updateStatus`: la fila y el estado que tenía antes. */
export interface AnomalyStatusChange {
  anomaly: AnomalyWithResolver;
  previousStatus: AnomalyStatus | null;
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Evento de WebSocket que resalta una anomalía en la vista del conserje. */
export const ANOMALY_HIGHLIGHT_EVENT = 'security:anomaly_highlight';

/**
 * Payload de `security:anomaly_highlight` (Fase 4 · P6.R, D13). SIN la foto:
 * la imagen se pide con `GET /anomalies/:id` (sesión, `detections.read` y
 * acotado al condominio). `timestamp` viaja como string ISO 8601.
 */
/** Evento de WebSocket con el resultado del análisis de IA (o su fallo). */
export const ANOMALY_UPDATED_EVENT = 'security:anomaly_updated';

/**
 * Máximo de análisis de Vision en vuelo a la vez. Cada uno es una llamada a
 * GPT-4o de hasta 20 s; una ráfaga de anomalías (p. ej. ByteTrack re-disparando)
 * sin tope abriría decenas de llamadas simultáneas (costo y rate limit de
 * OpenAI). Pasado el tope la anomalía se guarda igual con aiStatus 'skipped'
 * (se revisa a mano): perder el análisis es mejor que perder el aviso.
 */
export const MAX_CONCURRENT_AI_ANALYSES = 3;

/** Columnas de una anomalía SIN la foto (listados y respuesta del PATCH). */
const ANOMALY_SUMMARY_SELECT: FindOptionsSelect<AnomalyEvent> = {
  id: true,
  organizationId: true,
  cameraId: true,
  anomalyType: true,
  confidence: true,
  durationSeconds: true,
  trackId: true,
  suspicionLevel: true,
  aiReasoning: true,
  timestamp: true,
  status: true,
  resolvedById: true,
  resolvedAt: true,
  resolutionNote: true,
  aiStatus: true,
  aiFalsePositive: true,
};

/** Resultado de `GET /anomalies`: página de anomalías (sin foto) y total filtrado. */
export interface AnomalyPage {
  items: AnomalyEvent[];
  total: number;
}

/**
 * Payload de `security:anomaly_updated`. SIN la foto, igual que el highlight.
 */
export interface AnomalyUpdatedPayload {
  anomalyId: string;
  aiStatus: AnomalyAiStatus | null;
  /** `AnomalyEvent.suspicionLevel` vigente tras el análisis. */
  severity: string;
  reasoning: string;
  aiFalsePositive: boolean | null;
  status: AnomalyStatus;
}

export interface AnomalyHighlightPayload {
  anomalyId: string;
  /** Id (UUID) de la cámara registrada, aunque el worker la nombre por `mountPath`. */
  cameraId: string;
  cameraName: string;
  /** `AnomalyEvent.anomalyType` (p. ej. `loitering`). */
  type: string;
  /** `AnomalyEvent.suspicionLevel`: `HIGH` | `MEDIUM` | `LOW`. */
  severity: string;
  /** `AnomalyEvent.aiReasoning`. */
  reasoning: string;
  timestamp: Date;
  /** Estado del análisis de IA al crearse (casi siempre `pending` o `skipped`). */
  aiStatus: AnomalyAiStatus | null;
  /** Estado de revisión (`open` al crearse). */
  status: AnomalyStatus;
}

/** Cuerpo de `POST /anomalies` tal como lo envía el worker Guardián (sin validar). */
export interface AnomalyIngestPayload {
  cameraId?: unknown;
  anomalyType?: unknown;
  confidence?: unknown;
  meta?: unknown;
}

/** Anomalía ya validada, con el `cameraId` limpio (sin el sufijo `_guardia`). */
interface AnomalyIngest {
  cameraId: string;
  anomalyType: string;
  confidence: number;
  snapshotJpegB64?: string;
  durationSeconds?: number;
  trackId?: number;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/** Número finito redondeado al entero más cercano (para columnas int). */
function optionalInteger(value: unknown): number | undefined {
  const n = optionalNumber(value);
  return n === undefined ? undefined : Math.round(n);
}

/**
 * Valida el cuerpo antes de tocar la BD: sin `cameraId`, `anomalyType` o
 * `confidence` válidos responde 400 (antes caía en un 500 de la BD).
 */
function parseAnomalyPayload(payload: AnomalyIngestPayload): AnomalyIngest {
  const cameraId = optionalString(payload?.cameraId);
  const anomalyType = optionalString(payload?.anomalyType);
  const confidence = optionalNumber(payload?.confidence);
  if (!cameraId || !anomalyType || confidence === undefined) {
    throw new BadRequestException(
      'cameraId, anomalyType y confidence son obligatorios',
    );
  }
  if (!(ANOMALY_TYPES as readonly string[]).includes(anomalyType)) {
    throw new BadRequestException(
      `anomalyType debe ser uno de: ${ANOMALY_TYPES.join(', ')}`,
    );
  }
  const meta =
    typeof payload.meta === 'object' && payload.meta !== null
      ? (payload.meta as Record<string, unknown>)
      : {};
  return {
    // El worker manager usa un ID con sufijo '_guardia' para evitar
    // colisiones: se limpia para vincular el evento a la cámara real.
    cameraId: cameraId.replace('_guardia', ''),
    anomalyType,
    confidence,
    snapshotJpegB64: optionalString(meta.snapshot_jpeg_b64),
    // Las columnas son int: un valor fraccionario (4.2) rompía el INSERT con un 500.
    durationSeconds: optionalInteger(meta.duration_seconds),
    trackId: optionalInteger(meta.track_id),
  };
}

@Injectable()
export class AnomaliesService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AnomaliesService.name);
  private sweepTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Presupuesto de IA por condominio (ver AI_VISION_RATE_PER_MINUTE / AI_VISION_DAILY_CAP). */
  private readonly aiBudget = new AiVisionBudget(
    parseAiVisionRatePerMinute(process.env.AI_VISION_RATE_PER_MINUTE),
    parseAiVisionDailyCap(process.env.AI_VISION_DAILY_CAP),
  );
  /** Análisis de Vision en vuelo (ver MAX_CONCURRENT_AI_ANALYSES). */
  private aiInFlight = 0;

  constructor(
    @InjectRepository(AnomalyEvent)
    private readonly anomaliesRepository: Repository<AnomalyEvent>,
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    private readonly visionAnalysisService: VisionAnalysisService,
    private readonly notificationsGateway: NotificationsGateway,
    // Opcional: solo para resolver `resolvedByName` (nombre, sin email).
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>,
  ) {}

  onApplicationBootstrap(): void {
    this.scheduleSweep(AI_PENDING_SWEEP_INITIAL_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.sweepTimer) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  // setTimeout + unref (patrón de MediamtxSyncService), NO @Cron: un
  // @Cron en un provider con dependencias request-scoped se descarta en
  // silencio.
  private scheduleSweep(delayMs: number): void {
    if (this.stopped) return;
    this.sweepTimer = setTimeout(() => {
      void this.sweepOrphanedPending()
        .catch((error: unknown) => {
          this.logger.warn(
            `Falló el barrido de análisis de IA huérfanos: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => this.scheduleSweep(AI_PENDING_SWEEP_INTERVAL_MS));
    }, delayMs);
    this.sweepTimer.unref();
  }

  /**
   * Marca `aiStatus='failed'` las anomalías `pending` con más de 5 min: el
   * proceso que las analizaba murió (reinicio) y nadie las completará, así que
   * la UI quedaría en "Analizando…" para siempre. Con timeout de 20 s, un
   * análisis legítimo nunca llega a esa edad. Devuelve cuántas marcó.
   */
  async sweepOrphanedPending(now: Date = new Date()): Promise<number> {
    const stale = await this.anomaliesRepository.find({
      where: {
        aiStatus: 'pending',
        timestamp: LessThan(new Date(now.getTime() - AI_PENDING_MAX_AGE_MS)),
      },
      select: ANOMALY_SUMMARY_SELECT,
      take: AI_PENDING_SWEEP_BATCH,
    });
    if (stale.length === 0) return 0;

    // Re-filtra por `pending` al actualizar: si el análisis terminó entre el
    // find y el update, no se pisa.
    await this.anomaliesRepository.update(
      { id: In(stale.map((row) => row.id)), aiStatus: 'pending' },
      { aiStatus: 'failed', aiReasoning: AI_INTERRUPTED_REASONING },
    );
    this.logger.warn(
      `${stale.length} análisis de IA pendientes huérfanos marcados como failed`,
    );
    for (const row of stale) {
      if (!row.organizationId) continue;
      this.emitUpdated(row.organizationId, {
        ...row,
        aiStatus: 'failed',
        aiReasoning: AI_INTERRUPTED_REASONING,
      });
    }
    return stale.length;
  }

  /** Emite `security:anomaly_updated` (sin foto) al feed del condominio. */
  private emitUpdated(organizationId: string, row: AnomalyEvent): void {
    const updated: AnomalyUpdatedPayload = {
      anomalyId: row.id,
      aiStatus: row.aiStatus,
      severity: row.suspicionLevel,
      reasoning: row.aiReasoning,
      aiFalsePositive: row.aiFalsePositive,
      status: row.status,
    };
    this.notificationsGateway.sendToOrganizationSecurity(
      organizationId,
      ANOMALY_UPDATED_EVENT,
      updated,
    );
  }

  /** Nombre (solo `name`) del usuario que resolvió; null si no hay o no se halla. */
  private async resolverName(
    resolvedById: string | null,
  ): Promise<string | null> {
    if (!resolvedById || !this.userRepository) return null;
    const user = await this.userRepository.findOne({
      where: { id: resolvedById },
      select: { id: true, name: true },
    });
    return user?.name ?? null;
  }

  /**
   * `GET /anomalies` (sesión humana): una página de anomalías del condominio
   * del actor (super-admin: de todos), de la más nueva a la más antigua, SIN
   * la foto (esa se pide con `GET /anomalies/:id`: con la foto cada fila pesa
   * decenas de KB y la tabla cargaba megabytes). Filtros opcionales por
   * estado, tipo y cámara; `limit` (50 por defecto, máx. 100) y `offset`.
   *
   * Son eventos de seguridad de TODO el condominio: un actor sin
   * `condominium.view-all` (el Residente, que tiene `detections.read`) o sin
   * condominio recibe una página vacía.
   */
  async findAllForActor(
    actor: TenantActor,
    query: ListAnomaliesQueryDto = {},
  ): Promise<AnomalyPage> {
    if (!canViewWholeCondominium(actor)) {
      return { items: [], total: 0 };
    }
    const filters: FindOptionsWhere<AnomalyEvent> = {};
    if (query.status) filters.status = query.status;
    if (query.type) filters.anomalyType = query.type;
    if (query.cameraId) filters.cameraId = query.cameraId;

    const [items, total] = await this.anomaliesRepository.findAndCount({
      select: ANOMALY_SUMMARY_SELECT,
      where: scopeWhere(filters, actor),
      order: { timestamp: 'DESC', id: 'DESC' },
      take: Math.min(
        query.limit ?? DEFAULT_ANOMALIES_LIMIT,
        MAX_ANOMALIES_LIMIT,
      ),
      skip: query.offset ?? 0,
    });
    return { items, total };
  }

  /**
   * `GET /anomalies/:id` (Fase 4 · P6.R): una anomalía CON su foto
   * (`snapshotJpegB64`), que el evento `security:anomaly_highlight` ya no
   * lleva. Misma política que `GET /anomalies`: del condominio del actor
   * (super-admin: de cualquiera) y solo para quien ve el condominio completo
   * (`condominium.view-all`). Ajena, inexistente o sin ese permiso: 404 (no
   * revela qué ids existen).
   */
  async findOneForActor(
    id: string,
    actor: TenantActor,
  ): Promise<AnomalyWithResolver> {
    if (!canViewWholeCondominium(actor)) {
      throw new NotFoundException('Anomalía no encontrada');
    }
    const anomaly = await this.anomaliesRepository.findOne({
      where: scopeWhere({ id }, actor),
    });
    if (!anomaly) {
      throw new NotFoundException('Anomalía no encontrada');
    }
    return Object.assign(anomaly, {
      resolvedByName: await this.resolverName(anomaly.resolvedById),
    });
  }

  /**
   * Hallazgo A2 (Fase 4 · P2): la cámara debe existir y ser del condominio de
   * la API key de servicio ANTES de cualquier efecto (análisis con IA,
   * guardar, emitir por WebSocket); si no, 403. Inexistente y ajena responden
   * igual (no revela qué cámaras existen en otros condominios).
   */
  async createAnomaly(
    payload: AnomalyIngestPayload,
    keyOrganizationId: string,
  ): Promise<AnomalyEvent> {
    const ingest = parseAnomalyPayload(payload);

    // Tarea #19 (docs/modulos/auth-multitenant.md §7): resource-derived —
    // este endpoint lo llama el worker de analítica visual sin sesión de
    // usuario (sin AuthGuard, ver AnomaliesController), así que el
    // organizationId se deriva de la cámara asociada, no de TenantContext.
    const camera = UUID_PATTERN.test(ingest.cameraId)
      ? await this.cameraRepository.findOne({ where: { id: ingest.cameraId } })
      : await this.cameraRepository.findOne({
          where: { mountPath: ingest.cameraId },
        });
    if (!camera || camera.organizationId !== keyOrganizationId) {
      this.logger.warn(
        `Anomalía rechazada: la cámara ${ingest.cameraId} no pertenece al condominio de la API key`,
      );
      throw new ForbiddenException(
        'La cámara no pertenece al condominio de la API key de servicio',
      );
    }

    this.logger.warn(
      `🚨 Anomalía visual detectada: ${ingest.anomalyType} en cámara ${ingest.cameraId}`,
    );

    // La IA corre en segundo plano: el worker no espera a GPT-4o (antes la
    // respuesta tardaba 10 s o más y el worker cortaba por timeout, perdiendo
    // el aviso). Se decide acá, de forma síncrona, si habrá análisis.
    const aiStatus = this.reserveAiAnalysis(ingest, keyOrganizationId);

    let saved: AnomalyEvent;
    try {
      const anomaly = this.anomaliesRepository.create({
        cameraId: ingest.cameraId,
        organizationId: camera.organizationId, // Tarea #19 (verificado = key, A2)
        anomalyType: ingest.anomalyType,
        confidence: ingest.confidence,
        snapshotJpegB64: ingest.snapshotJpegB64,
        durationSeconds: ingest.durationSeconds,
        trackId: ingest.trackId,
        suspicionLevel: 'MEDIUM',
        aiReasoning: 'Sin evaluación de IA',
        status: 'open',
        aiStatus,
      });
      saved = await this.anomaliesRepository.save(anomaly);
    } catch (error) {
      if (aiStatus === 'pending') this.aiInFlight -= 1; // libera el cupo
      throw error;
    }

    // Se lanza ANTES de emitir: así el cupo reservado nunca se pierde si la
    // emisión lanza. El análisis tarda segundos; el highlight sale primero.
    if (aiStatus === 'pending' && ingest.snapshotJpegB64) {
      // Fire-and-forget (mismo patrón que digital-concierge): `analyzeInBackground`
      // persiste sus propios fallos; el catch es la última red y nunca deja
      // una promesa rechazada sin manejar.
      void this.analyzeInBackground(
        saved.id,
        keyOrganizationId,
        ingest.snapshotJpegB64,
        ingest.anomalyType,
      ).catch((error: unknown) => {
        this.logger.warn(
          `Falló el análisis en segundo plano de la anomalía ${saved.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    // Fase 4 · P6.R (D13): solo al feed de seguridad del condominio de la
    // cámara (Conserje/Administrador conectados), sin la foto. Antes iba con
    // la foto a `conserje_room` (a la que cualquiera se unía con
    // `join_room`) y, como `security:anomaly_detected`, a TODOS los demás
    // sockets de todos los condominios.
    const highlight: AnomalyHighlightPayload = {
      anomalyId: saved.id,
      cameraId: camera.id,
      cameraName: camera.name,
      type: saved.anomalyType,
      severity: saved.suspicionLevel,
      reasoning: saved.aiReasoning,
      timestamp: saved.timestamp,
      aiStatus: saved.aiStatus,
      status: saved.status,
    };
    this.notificationsGateway.sendToOrganizationSecurity(
      keyOrganizationId,
      ANOMALY_HIGHLIGHT_EVENT,
      highlight,
    );

    return saved;
  }

  /**
   * Decide el `aiStatus` inicial y, si habrá análisis, RESERVA un cupo de
   * concurrencia (`aiInFlight`) de forma síncrona (sin `await` de por medio,
   * así dos ingestas simultáneas no superan el tope). El cupo lo libera
   * `analyzeInBackground` (o `createAnomaly` si el guardado falla).
   */
  private reserveAiAnalysis(
    ingest: AnomalyIngest,
    organizationId: string,
  ): AnomalyAiStatus {
    if (!ingest.snapshotJpegB64) return 'skipped';
    if (!this.visionAnalysisService.isAvailable()) {
      this.logger.warn(
        'OPENAI_API_KEY no configurada: la anomalía se guarda sin análisis de IA',
      );
      return 'skipped';
    }
    if (this.aiInFlight >= MAX_CONCURRENT_AI_ANALYSES) {
      this.logger.warn(
        `Análisis de IA saturado (${this.aiInFlight} en vuelo): la anomalía se guarda sin análisis`,
      );
      return 'skipped';
    }
    if (!this.aiBudget.tryConsume(organizationId)) {
      this.logger.warn(
        `Presupuesto de IA agotado para el condominio ${organizationId}: la anomalía se guarda sin análisis`,
      );
      return 'skipped';
    }
    this.aiInFlight += 1;
    return 'pending';
  }

  /**
   * Analiza con Vision, actualiza la fila (`suspicionLevel`, `aiReasoning`,
   * `aiFalsePositive`, `aiStatus` 'done' | 'failed') y emite
   * `security:anomaly_updated`. Actualiza SOLO esas columnas (`update`, no
   * `save` de la entidad): si el revisor cambió el `status` mientras tanto,
   * no se pisa.
   */
  private async analyzeInBackground(
    anomalyId: string,
    organizationId: string,
    snapshotB64: string,
    anomalyType: string,
  ): Promise<void> {
    let changes: Partial<AnomalyEvent>;
    try {
      const analysis = await this.visionAnalysisService.analyzeAnomaly(
        snapshotB64,
        anomalyType,
      );
      changes = {
        suspicionLevel: analysis.suspicionLevel,
        aiReasoning: analysis.reasoning,
        aiFalsePositive: analysis.isFalsePositive,
        aiStatus: 'done',
      };
    } catch (error) {
      this.logger.error(
        `Error al evaluar la anomalía ${anomalyId} con Vision: ${error instanceof Error ? error.message : String(error)}`,
      );
      changes = {
        aiReasoning: 'Error al contactar a la IA. Evaluar manualmente.',
        aiStatus: 'failed',
      };
    } finally {
      this.aiInFlight -= 1;
    }

    const result = await this.anomaliesRepository.update(
      { id: anomalyId },
      changes,
    );
    if (!result.affected) return; // borrada (p. ej. retención) mientras se analizaba

    const current = await this.anomaliesRepository.findOne({
      where: { id: anomalyId },
      select: ANOMALY_SUMMARY_SELECT,
    });
    if (!current) return;
    this.emitUpdated(organizationId, current);
  }

  /**
   * `PATCH /anomalies/:id/status`: marca la anomalía como revisada,
   * descartada, falsa alarma o la reabre. Mismo alcance que la lectura
   * (`findOneForActor`): ajena, inexistente o sin `condominium.view-all`: 404.
   * Vuelve SIN foto. Al reabrir (`open`) se limpian quién y cuándo la
   * resolvió; la nota se reemplaza por la enviada (o se borra).
   */
  async updateStatus(
    id: string,
    dto: UpdateAnomalyStatusDto,
    actor: TenantActor,
  ): Promise<AnomalyStatusChange> {
    if (!canViewWholeCondominium(actor)) {
      throw new NotFoundException('Anomalía no encontrada');
    }
    const where = scopeWhere<FindOptionsWhere<AnomalyEvent>>({ id }, actor);
    const exists = await this.anomaliesRepository.findOne({
      where,
      select: { id: true, status: true },
    });
    if (!exists) {
      throw new NotFoundException('Anomalía no encontrada');
    }

    const reopening = dto.status === 'open';
    await this.anomaliesRepository.update(where, {
      status: dto.status,
      resolvedById: reopening ? null : actor.userId,
      resolvedAt: reopening ? null : new Date(),
      resolutionNote: dto.note?.trim() ? dto.note.trim() : null,
    });

    const updated = await this.anomaliesRepository.findOne({
      where,
      select: ANOMALY_SUMMARY_SELECT,
    });
    if (!updated) {
      throw new NotFoundException('Anomalía no encontrada');
    }
    // Los demás clientes del condominio ven el cambio sin recargar.
    if (updated.organizationId) {
      this.emitUpdated(updated.organizationId, updated);
    }
    return {
      anomaly: Object.assign(updated, {
        resolvedByName: await this.resolverName(updated.resolvedById),
      }),
      previousStatus: exists.status ?? null,
    };
  }

  /**
   * Zonas del Guardián Visual de una cámara, para el worker Guardián
   * (`lpr/processor/guardian_worker.py::_fetch_zones`).
   *
   * Fase 4 · P5.B: antes la ruta no tenía ningún guard y resolvía la cámara
   * en todos los condominios. Ahora la llama una API key de servicio y la
   * cámara debe ser del condominio de la key (`keyOrganizationId`); una de
   * otro condominio responde 404, igual que una inexistente.
   */
  async getCameraZones(cameraId: string, keyOrganizationId: string) {
    try {
      // El worker manager usa un ID con sufijo '_guardia' para evitar colisiones.
      // Lo limpiamos para buscar en la BD.
      const cleanId = cameraId.replace('_guardia', '');

      const where: FindOptionsWhere<Camera>[] = [];
      if (UUID_PATTERN.test(cleanId)) {
        where.push({ id: cleanId, organizationId: keyOrganizationId });
      }
      where.push({ mountPath: cleanId, organizationId: keyOrganizationId });

      const camera = await this.cameraRepository.findOne({ where });
      if (!camera) {
        throw new NotFoundException('Cámara no encontrada');
      }

      return {
        id: camera.id,
        enableGuardian: camera.enableGuardian,
        guardianZones: camera.guardianZones || [],
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Error al obtener zonas de la cámara ${cameraId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new HttpException(
        'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
