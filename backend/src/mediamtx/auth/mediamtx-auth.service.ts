import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { z } from 'zod';
import { Camera } from '../../cameras/entities/camera.entity';
import { errorMessage } from '../../common/utils/error-message.util';
import {
  MEDIAMTX_AUTH_USER,
  readMediamtxAuthSecret,
  secretsMatch,
} from '../mediamtx-credentials';

/**
 * Cuerpo que MediaMTX v1.15.2 manda con `authMethod: http` (verificado contra
 * el binario):
 * `{ ip, user, password, token, action, path, protocol, id, query }`.
 * Los campos extra se ignoran (una versión nueva puede agregar más); uno
 * requerido ausente o de otro tipo es una denegación.
 */
const mediamtxAuthRequestSchema = z.object({
  user: z.string().max(256).default(''),
  password: z.string().max(1024).default(''),
  token: z.string().max(8192).optional(),
  ip: z.string().max(64).optional(),
  action: z.string().max(32),
  path: z.string().max(256),
  protocol: z.string().max(32),
  id: z.string().max(64).nullable().optional(),
  query: z.string().max(4096).optional(),
});

export type MediamtxAuthRequest = z.infer<typeof mediamtxAuthRequestSchema>;

/** Por qué se negó una solicitud (para el log; nunca se devuelve al cliente). */
export type MediamtxAuthDenialReason =
  | 'malformed'
  | 'secret-not-configured'
  | 'bad-credentials'
  | 'action-not-allowed'
  | 'protocol-not-allowed'
  | 'unknown-path'
  | 'lookup-error';

export type MediamtxAuthDecision =
  | { allowed: true }
  | { allowed: false; reason: MediamtxAuthDenialReason };

/** Leer un stream (ver la cámara): solo por WebRTC y de una cámara activa. */
const READ_ACTION = 'read';
/**
 * Control API de MediaMTX (registro de paths y `/v3/info`). MediaMTX la manda
 * con `path` y `protocol` vacíos (verificado en v1.15.2). Solo el backend.
 */
const API_ACTION = 'api';
/** Único protocolo de lectura: WebRTC (WHEP), el que usa el forward del backend. */
const ALLOWED_PROTOCOL = 'webrtc';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deny(reason: MediamtxAuthDenialReason): MediamtxAuthDecision {
  return { allowed: false, reason };
}

/**
 * Fase 4 · P6.M (D14): decide cada solicitud de autorización de MediaMTX
 * (`POST /api/v1/internal/mediamtx/auth`). Fail-closed: solo permite
 *  1. con `MEDIAMTX_AUTH_SECRET` configurado,
 *  2. Basic `vigilia-backend:<secreto>` (comparado en tiempo constante),
 *  3. y además una de dos:
 *     - `action === 'api'`: la Control API (registro de paths, `/v3/info`).
 *       Corrección cyber P6: antes estaba excluida del auth y un navegador en
 *       el host podía usarla (CSRF / DNS rebinding -> `runOnInit`);
 *     - `action === 'read'`, `protocol === 'webrtc'` y `path` = mount de una
 *       cámara registrada en Vigilia y activa (el mount es `mountPath` o, si
 *       la cámara no tiene, su id — `CamerasService.getMountPath`).
 * Todo lo demás (publish, playback, metrics, pprof, otro protocolo), incluido
 * un error de BD, se niega. El secreto se valida ANTES de tocar la BD: sin
 * él, una solicitud no genera consultas.
 *
 * El acceso del USUARIO a la cámara (condominio, rol) ya lo decidió
 * `CameraViewGuard` antes del forward WHEP; acá solo se verifica que quien
 * pide el stream sea el backend y que el path sea una cámara real.
 */
@Injectable()
export class MediamtxAuthService {
  private readonly logger = new Logger(MediamtxAuthService.name);
  private readonly secret = readMediamtxAuthSecret();
  private warnedMissingSecret = false;

  constructor(
    @InjectRepository(Camera)
    private readonly cameraRepository: Repository<Camera>,
  ) {}

  async authorize(body: unknown): Promise<MediamtxAuthDecision> {
    const parsed = mediamtxAuthRequestSchema.safeParse(body);
    if (!parsed.success) {
      return deny('malformed');
    }
    const request = parsed.data;

    if (!this.secret) {
      this.warnMissingSecretOnce();
      return deny('secret-not-configured');
    }

    // Se calculan ambas condiciones antes de decidir: la comparación del
    // secreto corre siempre, también con un usuario equivocado.
    const passwordMatches = secretsMatch(request.password, this.secret);
    const userMatches = request.user === MEDIAMTX_AUTH_USER;
    if (!passwordMatches || !userMatches) {
      return deny('bad-credentials');
    }

    if (request.action === API_ACTION) {
      return { allowed: true };
    }
    if (request.action !== READ_ACTION) {
      return deny('action-not-allowed');
    }
    if (request.protocol !== ALLOWED_PROTOCOL) {
      return deny('protocol-not-allowed');
    }

    try {
      const known = await this.isActiveCameraMount(request.path);
      return known ? { allowed: true } : deny('unknown-path');
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo verificar el path de MediaMTX (se niega): ${errorMessage(error)}`,
      );
      return deny('lookup-error');
    }
  }

  /**
   * ¿`path` es el mount de una cámara activa? Primero por `mountPath`
   * (único); si no, por id, solo para cámaras sin `mountPath` propio (su
   * mount es el id).
   */
  private async isActiveCameraMount(path: string): Promise<boolean> {
    if (path.length === 0) {
      return false;
    }
    const byMount = await this.cameraRepository.findOne({
      where: { mountPath: path, active: true },
      select: { id: true },
    });
    if (byMount) {
      return true;
    }
    if (!UUID_PATTERN.test(path)) {
      return false;
    }
    const byId = await this.cameraRepository.findOne({
      where: [
        { id: path, active: true, mountPath: IsNull() },
        { id: path, active: true, mountPath: '' },
      ],
      select: { id: true },
    });
    return byId !== null;
  }

  private warnMissingSecretOnce(): void {
    if (this.warnedMissingSecret) {
      return;
    }
    this.warnedMissingSecret = true;
    this.logger.warn(
      'MEDIAMTX_AUTH_SECRET no está configurado: se niega toda solicitud de MediaMTX (las cámaras no se podrán ver)',
    );
  }
}
