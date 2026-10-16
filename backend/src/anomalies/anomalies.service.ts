import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type FindOptionsWhere } from 'typeorm';
import { AnomalyEvent } from './entities/anomaly-event.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { VisionAnalysisService } from './services/vision-analysis.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  canViewWholeCondominium,
  type TenantActor,
} from '../common/tenant/tenant-actor';
import { scopeWhere } from '../common/tenant/tenant-context.util';

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Evento de WebSocket que resalta una anomalía en la vista del conserje. */
export const ANOMALY_HIGHLIGHT_EVENT = 'security:anomaly_highlight';

/**
 * Payload de `security:anomaly_highlight` (Fase 4 · P6.R, D13). SIN la foto:
 * la imagen se pide con `GET /anomalies/:id` (sesión, `detections.read` y
 * acotado al condominio). `timestamp` viaja como string ISO 8601.
 */
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
    durationSeconds: optionalNumber(meta.duration_seconds),
    trackId: optionalNumber(meta.track_id),
  };
}

@Injectable()
export class AnomaliesService {
  private readonly logger = new Logger(AnomaliesService.name);

  constructor(
    @InjectRepository(AnomalyEvent)
    private readonly anomaliesRepository: Repository<AnomalyEvent>,
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    private readonly visionAnalysisService: VisionAnalysisService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  /**
   * Últimas 100 anomalías del condominio del actor humano (`GET /anomalies`,
   * Fase 4 · P5.C; super-admin: de todos). Antes la ruta era de API key de
   * servicio, pero su único consumidor era la UI (`AnomalyTable`), que
   * recibía 401.
   *
   * Son eventos de seguridad de TODO el condominio (con snapshot): un actor
   * sin `condominium.view-all` (el Residente, que tiene `detections.read`)
   * recibe vacío, igual que un actor sin condominio.
   */
  async findAllForActor(actor: TenantActor) {
    if (!canViewWholeCondominium(actor)) {
      return [];
    }
    return await this.anomaliesRepository.find({
      where: scopeWhere({}, actor),
      order: { timestamp: 'DESC' },
      take: 100, // Limitar a las últimas 100 para rendimiento inicial
    });
  }

  /**
   * `GET /anomalies/:id` (Fase 4 · P6.R): una anomalía CON su foto
   * (`snapshotJpegB64`), que el evento `security:anomaly_highlight` ya no
   * lleva. Misma política que `GET /anomalies`: del condominio del actor
   * (super-admin: de cualquiera) y solo para quien ve el condominio completo
   * (`condominium.view-all`). Ajena, inexistente o sin ese permiso: 404 (no
   * revela qué ids existen).
   */
  async findOneForActor(id: string, actor: TenantActor): Promise<AnomalyEvent> {
    if (!canViewWholeCondominium(actor)) {
      throw new NotFoundException('Anomalía no encontrada');
    }
    const anomaly = await this.anomaliesRepository.findOne({
      where: scopeWhere({ id }, actor),
    });
    if (!anomaly) {
      throw new NotFoundException('Anomalía no encontrada');
    }
    return anomaly;
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

    let suspicionLevel = 'MEDIUM';
    let reasoning = 'Sin evaluación de IA';

    // Evaluar con OpenAI Vision si hay foto adjunta
    if (ingest.snapshotJpegB64) {
      try {
        const analysis = await this.visionAnalysisService.analyzeAnomaly(
          ingest.snapshotJpegB64,
          ingest.anomalyType,
        );
        suspicionLevel = analysis.suspicionLevel;
        reasoning = analysis.reasoning;
      } catch (error) {
        this.logger.error(
          `Error al evaluar anomalía con GPT-4o Vision: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const anomaly = this.anomaliesRepository.create({
      cameraId: ingest.cameraId,
      organizationId: camera.organizationId, // Tarea #19 (verificado = key, A2)
      anomalyType: ingest.anomalyType,
      confidence: ingest.confidence,
      snapshotJpegB64: ingest.snapshotJpegB64,
      durationSeconds: ingest.durationSeconds,
      trackId: ingest.trackId,
      suspicionLevel,
      aiReasoning: reasoning,
    });

    const saved = await this.anomaliesRepository.save(anomaly);

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
    };
    this.notificationsGateway.sendToOrganizationSecurity(
      keyOrganizationId,
      ANOMALY_HIGHLIGHT_EVENT,
      highlight,
    );

    return saved;
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
