import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { isAxiosError, type AxiosResponse } from 'axios';
import { lastValueFrom, type Observable } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { LogsService } from '../logs/logs.service';
import { v4 as uuidv4 } from 'uuid';
import { errorMessage } from '../common/utils/error-message.util';
import { sleepUnref } from '../common/utils/timers.util';
import { isAllowedCameraSourceUrl } from '../cameras/camera-source-url';
import {
  mediamtxBasicAuthorization,
  readMediamtxAuthSecret,
} from './mediamtx-credentials';
import {
  describeMediamtxErrorBody,
  redactUrlCredentials,
} from './mediamtx-redaction.util';

/** Datos de `/v3/info` de MediaMTX. `raw` solo se expone al super-admin. */
export interface MediamtxHealthDetails {
  version: string | null;
  started: string | null;
  raw: unknown;
}

/** Estado de MediaMTX según su Control API. */
export type MediamtxHealth =
  | { ok: true; status: 'running'; details: MediamtxHealthDetails }
  | { ok: false; status: 'unavailable'; message: string };

/** Lo que se loguea de un intento fallido contra la Control API. */
interface MediamtxFailure {
  status: number | undefined;
  /** Resumen del cuerpo de error SIN credenciales (nunca el cuerpo crudo). */
  errorSummary: string | undefined;
  /** Mensaje del error, con las URLs redactadas. */
  message: string;
  /** Falla transitoria (red, timeout, 5xx, 429): vale la pena reintentar. */
  retryable: boolean;
}

/** Primer string no vacío entre `keys` de `source`, o `null`. */
function pickString(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

/** Interpreta el cuerpo de `/v3/info` (JSON ya parseado o texto). */
function parseInfoBody(body: unknown): MediamtxHealthDetails {
  let parsed: unknown = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return { version: null, started: null, raw: body.slice(0, 500) };
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { version: null, started: null, raw: parsed };
  }
  const info = parsed as Record<string, unknown>;
  return {
    version: pickString(info, ['version', 'Version']),
    started: pickString(info, ['started', 'Started', 'started_at']),
    raw: info,
  };
}

const UNAVAILABLE: MediamtxHealth = {
  ok: false,
  status: 'unavailable',
  message: 'MediaMTX no disponible',
};

/**
 * Cliente de la Control API de MediaMTX.
 *
 * Fase 4 · P6.M (cyber, corrección): la Control API ya no está excluida del
 * auth HTTP de MediaMTX (`authHTTPExclude: []`): cada llamada lleva Basic
 * `vigilia-backend:<MEDIAMTX_AUTH_SECRET>` y MediaMTX se la pregunta al
 * backend (`MediamtxAuthService`, acción `api`). Además:
 *  - el registro usa `paths/replace` (idempotente: crea o reemplaza; `add`
 *    falla con "path already exists"), así sirve para la resincronización;
 *  - solo se registran fuentes `rtsp://`/`rtsps://`;
 *  - se reintenta solo lo transitorio (red, timeout, 5xx, 429), no un 4xx;
 *  - nunca se loguea el cuerpo crudo de una respuesta (cita la fuente con
 *    credenciales).
 */
@Injectable()
export class MediamtxService {
  private readonly logger = new Logger(MediamtxService.name);
  // Loopback IPv4 explícito: la API escucha en 127.0.0.1 (mediamtx.yml) y
  // `localhost` puede resolver a ::1.
  private readonly controlUrl =
    process.env.MEDIAMTX_CONTROL_URL || 'http://127.0.0.1:9997';
  // The Control API v3 base for path operations. We'll construct concrete endpoints.
  private readonly controlApiBase =
    process.env.MEDIAMTX_CONTROL_API_BASE || '/v3';
  private readonly requestTimeoutMs = Number(
    process.env.MEDIAMTX_REQUEST_TIMEOUT_MS || 5000,
  );
  private readonly maxAttempts = Number(process.env.MEDIAMTX_MAX_ATTEMPTS || 3);
  private readonly backoffBaseMs = Number(
    process.env.MEDIAMTX_BACKOFF_BASE_MS || 500,
  );
  private readonly authSecret = readMediamtxAuthSecret();

  constructor(
    private readonly httpService: HttpService,
    private readonly logsService: LogsService,
  ) {}

  /** Basic del backend para la Control API (sin secreto: sin header, MediaMTX niega). */
  private authHeaders(): Record<string, string> {
    return this.authSecret
      ? { Authorization: mediamtxBasicAuthorization(this.authSecret) }
      : {};
  }

  /**
   * Fase 4 · P6.M: describe un fallo de la Control API SIN el cuerpo crudo de
   * la respuesta, que puede citar la URL de origen de la cámara (con
   * credenciales). Solo el status, un resumen redactado y el mensaje del error
   * con las URLs redactadas.
   */
  private describeFailure(err: unknown): MediamtxFailure {
    const response = isAxiosError(err) ? err.response : undefined;
    const status = response?.status;
    return {
      status,
      errorSummary: describeMediamtxErrorBody(response?.data),
      message: redactUrlCredentials(errorMessage(err)),
      retryable: status === undefined || status >= 500 || status === 429,
    };
  }

  private failureLogLine(failure: MediamtxFailure): string {
    const summary = failure.errorSummary
      ? ` error="${failure.errorSummary}"`
      : '';
    return `${failure.message} status=${failure.status ?? 'n/a'}${summary}`;
  }

  private async request<T>(
    observable: Observable<AxiosResponse<T>>,
  ): Promise<AxiosResponse<T>> {
    return lastValueFrom(observable.pipe(timeout(this.requestTimeoutMs)));
  }

  private pathUrl(operation: 'replace' | 'delete', mountPath: string): string {
    return `${this.controlUrl.replace(/\/$/, '')}${this.controlApiBase}/config/paths/${operation}/${encodeURIComponent(
      mountPath,
    )}`;
  }

  private async waitBeforeRetry(
    attempt: number,
    correlationId: string,
  ): Promise<void> {
    const waitMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
    this.logger.log(`Reintentando en ${waitMs}ms... [${correlationId}]`);
    // Fase 4 · P8: la espera no retiene el proceso (ver timers.util.ts).
    await sleepUnref(waitMs);
  }

  /**
   * Registra (o reemplaza) el path `mountPath` en MediaMTX para que haga pull
   * desde la URL RTSP indicada (`POST /v3/config/paths/replace/{name}` con
   * `{ source }`). Idempotente: sirve igual para el alta, la edición y la
   * resincronización tras reiniciar MediaMTX.
   */
  async registerSource(mountPath: string, rtspUrl: string): Promise<unknown> {
    if (!isAllowedCameraSourceUrl(rtspUrl)) {
      // Defensa en profundidad (el DTO ya lo valida): MediaMTX aceptaría
      // `udp+mpegts://0.0.0.0:...` (listener en todas las interfaces).
      this.logger.warn(
        `Fuente de la cámara ${mountPath} rechazada: solo se registran URLs rtsp:// o rtsps://`,
      );
      throw new BadRequestException(
        'La fuente de la cámara debe ser una URL rtsp:// o rtsps://',
      );
    }

    const correlationId = uuidv4();
    const startTime = Date.now();
    const url = this.pathUrl('replace', mountPath);
    this.logger.log(
      `Registrando fuente en MediaMTX: ${url} (mount=${mountPath}) [${correlationId}]`,
    );

    // La API espera un objeto PathConf. Enviamos campos mínimos: source (la
    // URL RTSP, con credenciales: nunca se loguea).
    const body = { source: rtspUrl };

    let lastFailure: MediamtxFailure | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const resp = await this.request(
          this.httpService.post<unknown>(url, body, {
            timeout: this.requestTimeoutMs,
            headers: this.authHeaders(),
          }),
        );
        const responseTime = Date.now() - startTime;

        this.logger.log(
          `Respuesta de registro de MediaMTX: ${resp.status} (intento ${attempt}) [${correlationId}]`,
        );

        await this.logsService.logMediaMTX({
          action: 'register_source',
          success: true,
          details: {
            mountPath,
            attempt,
            statusCode: resp.status,
            responseTime,
          },
          correlationId,
        });

        return resp.data;
      } catch (err: unknown) {
        lastFailure = this.describeFailure(err);
        this.logger.warn(
          `Intento ${attempt} falló al registrar fuente en MediaMTX: ${this.failureLogLine(lastFailure)} [${correlationId}]`,
        );

        if (!lastFailure.retryable) {
          break;
        }
        if (attempt < this.maxAttempts) {
          await this.waitBeforeRetry(attempt, correlationId);
        }
      }
    }

    await this.logsService.logMediaMTX({
      action: 'register_source',
      success: false,
      details: {
        mountPath,
        attempts: this.maxAttempts,
        statusCode: lastFailure?.status,
        responseTime: Date.now() - startTime,
        errorSummary: lastFailure?.errorSummary,
      },
      error: new Error(lastFailure?.message ?? 'MediaMTX no respondió'),
      correlationId,
    });
    this.logger.error(
      `No se pudo registrar la fuente en MediaMTX: ${
        lastFailure ? this.failureLogLine(lastFailure) : 'sin respuesta'
      } [${correlationId}]`,
    );
    throw new InternalServerErrorException(
      'No se pudo registrar la fuente en MediaMTX',
    );
  }

  async deregisterSource(mountPath: string): Promise<unknown> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    // Use Control API v3 to delete path config: DELETE /v3/config/paths/delete/{name}
    const url = this.pathUrl('delete', mountPath);
    this.logger.log(
      `Deseleccionando (deregister) fuente en MediaMTX: ${url} [${correlationId}]`,
    );

    let lastFailure: MediamtxFailure | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const resp = await this.request(
          this.httpService.delete<unknown>(url, {
            timeout: this.requestTimeoutMs,
            headers: this.authHeaders(),
          }),
        );
        const responseTime = Date.now() - startTime;

        this.logger.log(
          `Respuesta de deregistro de MediaMTX: ${resp.status} (intento ${attempt}) [${correlationId}]`,
        );

        await this.logsService.logMediaMTX({
          action: 'deregister_source',
          success: true,
          details: {
            mountPath,
            attempt,
            statusCode: resp.status,
            responseTime,
          },
          correlationId,
        });

        return resp.data;
      } catch (err: unknown) {
        lastFailure = this.describeFailure(err);
        if (lastFailure.status === 404) {
          // El path ya no existe (p. ej. MediaMTX se reinició): nada que borrar.
          this.logger.log(
            `El path ${mountPath} no existía en MediaMTX [${correlationId}]`,
          );
          return null;
        }
        this.logger.warn(
          `Intento ${attempt} falló al deregistrar fuente en MediaMTX: ${this.failureLogLine(lastFailure)} [${correlationId}]`,
        );

        if (!lastFailure.retryable) {
          break;
        }
        if (attempt < this.maxAttempts) {
          await this.waitBeforeRetry(attempt, correlationId);
        }
      }
    }

    await this.logsService.logMediaMTX({
      action: 'deregister_source',
      success: false,
      details: {
        mountPath,
        attempts: this.maxAttempts,
        statusCode: lastFailure?.status,
        responseTime: Date.now() - startTime,
        errorSummary: lastFailure?.errorSummary,
      },
      error: new Error(lastFailure?.message ?? 'MediaMTX no respondió'),
      correlationId,
    });

    this.logger.error(
      `No se pudo deregistrar la fuente en MediaMTX: ${
        lastFailure ? this.failureLogLine(lastFailure) : 'sin respuesta'
      } [${correlationId}]`,
    );
    // no lanzamos excepción para evitar romper eliminaciones si MediaMTX está temporalmente no disponible
    return null;
  }

  /**
   * Espera a que el path tenga stream (`GET /v3/paths/get/{name}` ->
   * `ready: true`, verificado en v1.15.2) hasta `timeoutMs`. Tras re-registrar
   * un path, MediaMTX tarda en conectarse a la cámara y un WHEP inmediato
   * responde 404 "no stream is available". `true` si quedó listo.
   */
  async waitForPathReady(
    mountPath: string,
    timeoutMs = 6000,
    intervalMs = 750,
  ): Promise<boolean> {
    const url = `${this.controlUrl.replace(/\/$/, '')}${this.controlApiBase}/paths/get/${encodeURIComponent(
      mountPath,
    )}`;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const resp = await this.request(
          this.httpService.get<unknown>(url, {
            timeout: this.requestTimeoutMs,
            headers: this.authHeaders(),
          }),
        );
        const ready = (resp.data as { ready?: unknown } | null)?.ready;
        if (ready === true) {
          return true;
        }
      } catch (err: unknown) {
        this.logger.debug(
          `Path ${mountPath} aún no disponible: ${this.failureLogLine(this.describeFailure(err))}`,
        );
      }
      if (Date.now() + intervalMs > deadline) {
        return false;
      }
      await sleepUnref(intervalMs);
    }
  }

  /**
   * Consulta el estado de MediaMTX con `/v3/info` de su Control API (único
   * endpoint canónico de salud). Ante cualquier fallo devuelve `unavailable`
   * con un mensaje genérico. El fallo se loguea en `debug`: lo consulta un
   * chequeo periódico (`MediamtxSyncService`), que loguea solo los cambios de
   * estado.
   */
  async getHealth(): Promise<MediamtxHealth> {
    const base = this.controlUrl.replace(/\/$/, '');
    const infoUrl = `${base}${this.controlApiBase || ''}/info`;
    try {
      const resp = await this.request(
        this.httpService.get<unknown>(infoUrl, {
          timeout: this.requestTimeoutMs,
          responseType: 'text',
          headers: this.authHeaders(),
        }),
      );
      if (resp.status !== 200) {
        this.logger.debug(`MediaMTX /info respondió ${resp.status}`);
        return UNAVAILABLE;
      }
      return { ok: true, status: 'running', details: parseInfoBody(resp.data) };
    } catch (err: unknown) {
      this.logger.debug(
        `Probing ${infoUrl} failed: ${this.failureLogLine(this.describeFailure(err))}`,
      );
      return UNAVAILABLE;
    }
  }
}
