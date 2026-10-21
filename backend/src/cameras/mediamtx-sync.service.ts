import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { errorMessage } from '../common/utils/error-message.util';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { decryptString } from '../utils/crypto.util';
import { isAllowedCameraSourceUrl } from './camera-source-url';
import { Camera } from './entities/camera.entity';
import { isMediamtxRegistrationEnabled } from './mediamtx-registration.util';

/** Primer chequeo tras arrancar: da tiempo a que el backend escuche (MediaMTX le pregunta el auth). */
export const MEDIAMTX_SYNC_INITIAL_DELAY_MS = 5_000;
/** Intervalo del chequeo de salud con MediaMTX arriba. */
export const MEDIAMTX_SYNC_INTERVAL_MS = 30_000;
/** Tope del backoff con MediaMTX caído. */
export const MEDIAMTX_SYNC_MAX_BACKOFF_MS = 5 * 60_000;

/** Resultado de una resincronización completa. */
export interface MediamtxResyncResult {
  registered: number;
  failed: number;
  skipped: number;
}

type MediamtxState = 'unknown' | 'up' | 'down';

/**
 * Fase 4 · P6.M (corrección QA): resincroniza las cámaras con MediaMTX.
 *
 * Los paths que el backend agrega por la Control API viven en memoria: al
 * reiniciar MediaMTX se pierden, WHEP respondía 500 y la UI seguía en verde.
 * Este servicio hace un chequeo liviano de `/v3/info` (cada 30 s; con MediaMTX
 * caído, backoff exponencial hasta 5 min) y re-registra TODAS las cámaras
 * activas con fuente:
 *  - al arrancar el backend (primer chequeo exitoso),
 *  - cuando MediaMTX pasa de caído a arriba,
 *  - cuando cambia su `started` (se reinició entre dos chequeos),
 *  - y en el siguiente chequeo si alguna falló.
 * Actualiza `registeredInMediamtx`. Solo loguea los cambios de estado y un
 * resumen por resincronización. Sin `CAMERAS_REGISTER_IN_MEDIAMTX=true` no
 * hace nada (los paths se configuran a mano).
 *
 * No depende de `CamerasService` (request-scoped por `TenantContextService`):
 * es una tarea del sistema, sin actor, sobre todas las cámaras.
 */
@Injectable()
export class MediamtxSyncService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MediamtxSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private state: MediamtxState = 'unknown';
  private lastStarted: string | null = null;
  /** Al arrancar no se sabe qué tiene MediaMTX: resincronizar en el primer chequeo OK. */
  private pendingResync = true;
  private consecutiveFailures = 0;

  constructor(
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
    private readonly mediamtxService: MediamtxService,
  ) {}

  onApplicationBootstrap(): void {
    if (!isMediamtxRegistrationEnabled()) {
      this.logger.log(
        'CAMERAS_REGISTER_IN_MEDIAMTX no está activo: sin resincronización automática con MediaMTX',
      );
      return;
    }
    this.schedule(MEDIAMTX_SYNC_INITIAL_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runTick();
    }, delayMs);
    // No mantiene vivo el proceso (tests, cierre ordenado).
    this.timer.unref();
  }

  private async runTick(): Promise<void> {
    let nextDelayMs: number;
    try {
      nextDelayMs = await this.tick();
    } catch (error: unknown) {
      this.logger.error(
        `Error en la resincronización con MediaMTX: ${errorMessage(error)}`,
      );
      this.consecutiveFailures += 1;
      nextDelayMs = this.backoffDelayMs();
    }
    this.schedule(nextDelayMs);
  }

  /** Espera con MediaMTX caído: 30 s, 60 s, 120 s, ... hasta 5 min. */
  private backoffDelayMs(): number {
    const exponent = Math.max(0, this.consecutiveFailures - 1);
    return Math.min(
      MEDIAMTX_SYNC_INTERVAL_MS * 2 ** exponent,
      MEDIAMTX_SYNC_MAX_BACKOFF_MS,
    );
  }

  /**
   * Un chequeo: salud de MediaMTX y, si corresponde, resincronización.
   * Devuelve la espera hasta el próximo chequeo (público para los tests).
   */
  async tick(): Promise<number> {
    const health = await this.mediamtxService.getHealth();
    if (!health.ok) {
      if (this.state !== 'down') {
        this.logger.warn(
          'MediaMTX no responde: las cámaras se volverán a registrar cuando vuelva',
        );
      }
      this.state = 'down';
      this.pendingResync = true;
      this.consecutiveFailures += 1;
      return this.backoffDelayMs();
    }

    const started = health.details.started;
    const restarted =
      this.lastStarted !== null &&
      started !== null &&
      started !== this.lastStarted;
    if (this.state === 'down') {
      this.logger.log('MediaMTX volvió a responder');
    } else if (restarted) {
      this.logger.warn(
        'MediaMTX se reinició (cambió su hora de inicio): se vuelven a registrar las cámaras',
      );
    }
    this.state = 'up';
    this.consecutiveFailures = 0;
    this.lastStarted = started;

    if (this.pendingResync || restarted) {
      const result = await this.resyncAll();
      this.pendingResync = result.failed > 0;
    }
    return MEDIAMTX_SYNC_INTERVAL_MS;
  }

  /**
   * Registra en MediaMTX todas las cámaras activas con fuente `rtsp(s)://`
   * (`paths/replace`, idempotente) y actualiza `registeredInMediamtx`.
   */
  async resyncAll(): Promise<MediamtxResyncResult> {
    const cameras = await this.cameraRepository.find({
      where: { active: true },
      select: {
        id: true,
        mountPath: true,
        encryptedSourceUrl: true,
        registeredInMediamtx: true,
      },
    });

    const result: MediamtxResyncResult = {
      registered: 0,
      failed: 0,
      skipped: 0,
    };
    for (const camera of cameras) {
      const outcome = await this.resyncCamera(camera);
      result[outcome] += 1;
    }

    const summary = `Resincronización con MediaMTX: ${result.registered} registradas, ${result.failed} fallidas, ${result.skipped} omitidas`;
    if (result.failed > 0) {
      this.logger.warn(`${summary} (se reintenta en el próximo chequeo)`);
    } else {
      this.logger.log(summary);
    }
    return result;
  }

  private async resyncCamera(
    camera: Pick<
      Camera,
      'id' | 'mountPath' | 'encryptedSourceUrl' | 'registeredInMediamtx'
    >,
  ): Promise<keyof MediamtxResyncResult> {
    if (!camera.encryptedSourceUrl) {
      return 'skipped';
    }
    let source: string;
    try {
      source = decryptString(camera.encryptedSourceUrl);
    } catch {
      // Sin detalle: podría incluir datos del payload cifrado.
      this.logger.warn(
        `No se pudo descifrar la fuente de la cámara ${camera.id}: se omite`,
      );
      return 'skipped';
    }
    if (!isAllowedCameraSourceUrl(source)) {
      this.logger.warn(
        `La fuente de la cámara ${camera.id} no es rtsp:// ni rtsps://: se omite`,
      );
      return 'skipped';
    }

    const mount =
      camera.mountPath && camera.mountPath.length > 0
        ? camera.mountPath
        : camera.id;
    let registered: boolean;
    try {
      await this.mediamtxService.registerSource(mount, source);
      registered = true;
    } catch {
      // `registerSource` ya logueó el motivo (redactado).
      registered = false;
    }
    if (camera.registeredInMediamtx !== registered) {
      await this.cameraRepository.update(
        { id: camera.id },
        { registeredInMediamtx: registered },
      );
    }
    return registered ? 'registered' : 'failed';
  }
}
