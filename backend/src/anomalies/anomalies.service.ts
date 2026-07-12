import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnomalyEvent } from './entities/anomaly-event.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { HubGateway } from '../hub/hub.gateway';
import { VisionAnalysisService } from './services/vision-analysis.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class AnomaliesService {
  private readonly logger = new Logger(AnomaliesService.name);

  constructor(
    @InjectRepository(AnomalyEvent)
    private readonly anomaliesRepository: Repository<AnomalyEvent>,
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    private readonly hubGateway: HubGateway,
    private readonly visionAnalysisService: VisionAnalysisService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async findAll() {
    return await this.anomaliesRepository.find({
      order: { timestamp: 'DESC' },
      take: 100, // Limitar a las últimas 100 para rendimiento inicial
    });
  }

  async createAnomaly(payload: any) {
    // El worker manager usa un ID con sufijo '_guardia' para evitar colisiones.
    // Lo limpiamos para que el evento quede vinculado a la cámara real.
    const cleanId = payload.cameraId.replace('_guardia', '');
    
    this.logger.warn(`🚨 Anomalía visual detectada: ${payload.anomalyType} en cámara ${cleanId}`);
    
    const meta = payload.meta || {};
    let suspicionLevel = 'MEDIUM';
    let reasoning = 'Sin evaluación de IA';

    // Tarea #19 (docs/modulos/auth-multitenant.md §7): resource-derived —
    // este endpoint lo llama el worker de analítica visual sin sesión de
    // usuario (sin AuthGuard, ver AnomaliesController), así que el
    // organizationId se deriva de la cámara asociada, no de TenantContext.
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);
    const camera = isUuid
      ? await this.cameraRepository.findOne({ where: { id: cleanId } })
      : await this.cameraRepository.findOne({ where: { mountPath: cleanId } });

    // Evaluar con OpenAI Vision si hay foto adjunta
    if (meta.snapshot_jpeg_b64) {
      try {
        const analysis = await this.visionAnalysisService.analyzeAnomaly(meta.snapshot_jpeg_b64, payload.anomalyType);
        suspicionLevel = analysis.suspicionLevel;
        reasoning = analysis.reasoning;
      } catch (error) {
        this.logger.error(`Error al evaluar anomalía con GPT-4o Vision: ${error.message}`);
      }
    }
    
    const anomaly = this.anomaliesRepository.create({
      cameraId: cleanId,
      organizationId: camera?.organizationId ?? null, // Tarea #19
      anomalyType: payload.anomalyType,
      confidence: payload.confidence,
      snapshotJpegB64: meta.snapshot_jpeg_b64,
      durationSeconds: meta.duration_seconds,
      trackId: meta.track_id,
      suspicionLevel,
      aiReasoning: reasoning,
    });

    const saved = await this.anomaliesRepository.save(anomaly);
    
    const anomalyPayload = {
      id: saved.id,
      anomalyType: saved.anomalyType,
      cameraId: saved.cameraId,
      durationSeconds: saved.durationSeconds,
      timestamp: saved.timestamp,
      snapshotJpegB64: saved.snapshotJpegB64,
      suspicionLevel: saved.suspicionLevel,
      reasoning: saved.aiReasoning,
    };

    // A los conserjes: Emitir evento silencioso de Destaque Visual a la sala 'conserje_room'
    this.notificationsGateway.sendToRoom('conserje_room', 'security:anomaly_highlight', anomalyPayload);

    // Al resto de la red (Global Ruidoso): Excluir a 'conserje_room'
    this.notificationsGateway.broadcastExceptRoom('conserje_room', 'security:anomaly_detected', anomalyPayload);
    
    return saved;
  }

  async getCameraZones(cameraId: string) {
    try {
      // El worker manager usa un ID con sufijo '_guardia' para evitar colisiones.
      // Lo limpiamos para buscar en la BD.
      const cleanId = cameraId.replace('_guardia', '');

      // Función auxiliar para verificar UUID
      const isUuid = (val: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val);

      const where: any[] = [];
      if (isUuid(cleanId)) {
        where.push({ id: cleanId });
      }
      where.push({ mountPath: cleanId });

      const camera = await this.cameraRepository.findOne({ where });
      if (!camera) {
        throw new HttpException('Cámara no encontrada', HttpStatus.NOT_FOUND);
      }

      return {
        id: camera.id,
        enableGuardian: camera.enableGuardian,
        guardianZones: camera.guardianZones || [],
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Error al obtener zonas de la cámara ${cameraId}: ${error.message}`);
      throw new HttpException('Error interno del servidor', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
