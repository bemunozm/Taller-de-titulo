import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError, type AxiosResponse } from 'axios';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { LogsService } from '../logs/logs.service';
import {
  LogLevel,
  LogType,
  ServiceName,
} from '../logs/entities/system-log.entity';
import { v4 as uuidv4 } from 'uuid';
import { CamerasService } from '../cameras/cameras.service';
import { isMediamtxRegistrationEnabled } from '../cameras/mediamtx-registration.util';
import { errorMessage } from '../common/utils/error-message.util';
import {
  mediamtxBasicAuthorization,
  readMediamtxAuthSecret,
} from '../mediamtx/mediamtx-credentials';
import {
  describeMediamtxErrorBody,
  isPathNotConfiguredError,
  redactUrlCredentials,
} from '../mediamtx/mediamtx-redaction.util';
import { MediamtxService } from '../mediamtx/mediamtx.service';

@Injectable()
export class StreamsService {
  private readonly logger = new Logger(StreamsService.name);
  /**
   * Listener WebRTC (WHEP) de MediaMTX. Fase 4 · P6.M (D14): MediaMTX lo abre
   * solo en loopback (mediamtx/mediamtx.yml), así que el default es el mismo
   * host; si corre en otra máquina, `MEDIAMTX_URL` apunta a la red interna.
   */
  private readonly mediamtxUrl =
    process.env.MEDIAMTX_URL || 'http://127.0.0.1:8889';
  /**
   * Secreto compartido con MediaMTX (`authMethod: http`): el forward se
   * identifica con Basic `vigilia-backend:<secreto>` y MediaMTX se lo
   * pregunta al backend (`MediamtxAuthController`). Sin él, MediaMTX niega
   * toda lectura.
   */
  private readonly mediamtxAuthSecret = readMediamtxAuthSecret();

  constructor(
    private readonly httpService: HttpService,
    private readonly logsService: LogsService,
    // Fase 4 · P5.B: antes se inyectaba con el token string 'CamerasService',
    // que ningún módulo provee (`@Optional` → undefined): el path de MediaMTX
    // salía siempre del string crudo del cliente. Ahora es la clase real
    // (CamerasModule la exporta).
    private readonly camerasService: CamerasService,
    // Fase 4 · P6.M (corrección QA): esperar el stream tras re-registrar.
    private readonly mediamtxService: MediamtxService,
  ) {}

  /**
   * Reenvía una oferta SDP al endpoint WHEP de MediaMTX y devuelve la
   * respuesta SDP.
   *
   * El path de MediaMTX sale de la cámara (`CamerasService.getMountPath`,
   * acotado al condominio del actor: otra o inexistente → 404), nunca del
   * string que mandó el cliente.
   *
   * @param offerSdp la oferta SDP (string)
   * @param cameraIdOrMount id o mountPath de la cámara (el controller pasa la
   *   cámara que ya autorizó `CameraViewGuard`)
   */
  async forwardOfferToMediaMtx(
    offerSdp: string,
    cameraIdOrMount: string,
  ): Promise<string> {
    if (!cameraIdOrMount || typeof cameraIdOrMount !== 'string') {
      this.logger.warn('Se indicó un cameraMount inválido');
      throw new BadRequestException('cameraMount debe ser una cadena no vacía');
    }

    const correlationId = uuidv4();
    const startTime = Date.now();

    const mountPath = (
      await this.camerasService.getMountPath(cameraIdOrMount)
    ).replace(/^\/+/, '');
    const safePath = mountPath
      .split('/')
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    const url = `${this.mediamtxUrl.replace(/\/$/, '')}/${safePath}/whep`;

    if (!this.mediamtxAuthSecret) {
      // Fail-closed y sin contactar a MediaMTX: respondería 401 de todos modos.
      this.logger.error(
        `MEDIAMTX_AUTH_SECRET no está configurado: no se puede negociar el stream [${correlationId}]`,
      );
      throw new ServiceUnavailableException(
        'El gateway de medios no está configurado',
      );
    }

    this.logger.log(
      `Reenviando oferta a MediaMTX: ${url} (camera=${cameraIdOrMount}) [${correlationId}]`,
    );
    const secret = this.mediamtxAuthSecret;
    try {
      let resp: AxiosResponse<string>;
      try {
        resp = await this.postOffer(url, offerSdp, secret);
      } catch (err: unknown) {
        // Fase 4 · P6.M (corrección QA): tras reiniciar MediaMTX el path ya
        // no existe. Se re-registra la cámara y se reintenta UNA vez.
        const recovered =
          isPathNotConfiguredError(err) &&
          (await this.recoverMissingPath(
            cameraIdOrMount,
            mountPath,
            correlationId,
          ));
        if (!recovered) {
          throw err;
        }
        resp = await this.postOffer(url, offerSdp, secret);
      }

      const responseTime = Date.now() - startTime;

      if (!resp || typeof resp.data !== 'string') {
        this.logger.error(
          `MediaMTX devolvió una respuesta SDP vacía o inválida [${correlationId}]`,
        );

        await this.logsService.log({
          level: LogLevel.ERROR,
          message: 'MediaMTX returned invalid SDP response',
          type: LogType.MEDIAMTX_API,
          service: ServiceName.MEDIAMTX,
          metadata: { cameraMount: cameraIdOrMount, mountPath, responseTime },
          correlationId,
        });

        throw new InternalServerErrorException(
          'Respuesta inválida del gateway de medios',
        );
      }

      this.logger.log(`MediaMTX respondió ${resp.status} [${correlationId}]`);

      await this.logsService.log({
        level: LogLevel.INFO,
        message: 'WHEP negotiation successful',
        type: LogType.MEDIAMTX_API,
        service: ServiceName.MEDIAMTX,
        metadata: {
          cameraMount: cameraIdOrMount,
          mountPath,
          status: resp.status,
          responseTime,
        },
        correlationId,
      });

      return resp.data;
    } catch (err: unknown) {
      const responseTime = Date.now() - startTime;
      // Fase 4 · P6.M (corrección QA): el motivo de MediaMTX (campo `error`,
      // redactado: sin la fuente ni credenciales) va al log.
      const status = isAxiosError(err) ? err.response?.status : undefined;
      const mediamtxError = isAxiosError(err)
        ? describeMediamtxErrorBody(err.response?.data)
        : undefined;
      const reason = redactUrlCredentials(errorMessage(err));

      this.logger.error(
        `Error al contactar MediaMTX: ${reason} status=${status ?? 'n/a'}${
          mediamtxError ? ` error="${mediamtxError}"` : ''
        } [${correlationId}]`,
      );

      await this.logsService.log({
        level: LogLevel.ERROR,
        message: 'WHEP negotiation failed',
        type: LogType.MEDIAMTX_API,
        service: ServiceName.MEDIAMTX,
        metadata: {
          cameraMount: cameraIdOrMount,
          mountPath,
          responseTime,
          status,
          error: reason,
          mediamtxError,
        },
        correlationId,
      });

      if (mediamtxError && /no stream is available/i.test(mediamtxError)) {
        // La cámara no está transmitiendo (MediaMTX no logra conectarse).
        throw new ServiceUnavailableException(
          'La cámara no está disponible en este momento',
        );
      }
      throw new InternalServerErrorException(
        'Error negociando con el gateway de medios',
      );
    }
  }

  /** POST de la oferta SDP al endpoint WHEP de MediaMTX, con el Basic del backend. */
  private async postOffer(
    url: string,
    offerSdp: string,
    secret: string,
  ): Promise<AxiosResponse<string>> {
    return lastValueFrom(
      this.httpService
        .post<string>(url, offerSdp, {
          headers: {
            'Content-Type': 'application/sdp',
            Authorization: mediamtxBasicAuthorization(secret),
          },
          responseType: 'text',
        })
        .pipe(timeout(10000)),
    );
  }

  /**
   * MediaMTX no tiene el path (se reinició y los paths viven en memoria):
   * re-registra la cámara (acotada al condominio del actor, con su URL
   * descifrada) y espera a que el stream esté listo. `false` si el registro
   * de cámaras está desactivado o no se pudo recuperar.
   */
  private async recoverMissingPath(
    cameraIdOrMount: string,
    mountPath: string,
    correlationId: string,
  ): Promise<boolean> {
    if (!isMediamtxRegistrationEnabled()) {
      return false;
    }
    this.logger.warn(
      `MediaMTX no tiene el path ${mountPath} (¿se reinició?): re-registrando la cámara y reintentando una vez [${correlationId}]`,
    );
    const registered =
      await this.camerasService.reregisterInMediamtx(cameraIdOrMount);
    if (!registered) {
      this.logger.error(
        `No se pudo re-registrar la cámara ${mountPath} en MediaMTX [${correlationId}]`,
      );
      return false;
    }
    const ready = await this.mediamtxService.waitForPathReady(mountPath);
    if (!ready) {
      this.logger.warn(
        `La cámara ${mountPath} quedó registrada pero aún no transmite; se reintenta igual [${correlationId}]`,
      );
    }
    return true;
  }
}
