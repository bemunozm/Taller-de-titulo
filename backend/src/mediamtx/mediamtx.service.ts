import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { AxiosResponse } from 'axios';

@Injectable()
export class MediamtxService {
  private readonly logger = new Logger(MediamtxService.name);
  private controlUrl = process.env.MEDIAMTX_CONTROL_URL || 'http://localhost:9997';
  // The Control API v3 base for path operations. We'll construct concrete endpoints.
  private controlApiBase = process.env.MEDIAMTX_CONTROL_API_BASE || '/v3';
  private requestTimeoutMs = Number(process.env.MEDIAMTX_REQUEST_TIMEOUT_MS || 5000);
  private maxAttempts = Number(process.env.MEDIAMTX_MAX_ATTEMPTS || 3);
  private backoffBaseMs = Number(process.env.MEDIAMTX_BACKOFF_BASE_MS || 500);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Registra o actualiza un mount/path en MediaMTX para que haga pull desde la URL RTSP indicada.
   * La carga exacta depende de la Control API de MediaMTX; esta implementación envía un JSON
   * mínimo { source } y se puede ajustar mediante variables de entorno.
   */
  async registerSource(mountPath: string, rtspUrl: string) {
    // Usar la Control API v3 para añadir la configuración de un path: POST /v3/config/paths/add/{name}
    const url = `${this.controlUrl.replace(/\/$/, '')}${this.controlApiBase}/config/paths/add/${encodeURIComponent(
      mountPath,
    )}`;
    this.logger.log(`Registrando fuente en MediaMTX: ${url} (mount=${mountPath})`);
    // La API espera un objeto PathConf. Enviamos campos mínimos: source (la URL RTSP)
    const body = {
      source: rtspUrl,
    };
    let lastErr: any = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const observable = this.httpService.post(url, body, { timeout: this.requestTimeoutMs });
        const resp: AxiosResponse<any> = await lastValueFrom(observable.pipe(timeout(this.requestTimeoutMs)) as any);
        this.logger.log(`Respuesta de registro de MediaMTX: ${resp.status} (intento ${attempt})`);
        return resp.data;
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        const data = err?.response?.data;
        this.logger.warn(`Intento ${attempt} falló al registrar fuente en MediaMTX: ${err?.message || err} status=${status} body=${JSON.stringify(data)}`);
        if (attempt < this.maxAttempts) {
          const waitMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
          this.logger.log(`Reintentando en ${waitMs}ms...`);
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
      }
    }
    const status = lastErr?.response?.status;
    const data = lastErr?.response?.data;
    this.logger.error(`No se pudo registrar la fuente en MediaMTX tras ${this.maxAttempts} intentos: ${lastErr?.message || lastErr} status=${status} body=${JSON.stringify(data)}`);
    throw new InternalServerErrorException('No se pudo registrar la fuente en MediaMTX');
    
  }

  async deregisterSource(mountPath: string) {
    // Use Control API v3 to delete path config: DELETE /v3/config/paths/delete/{name}
    const url = `${this.controlUrl.replace(/\/$/, '')}${this.controlApiBase}/config/paths/delete/${encodeURIComponent(
      mountPath,
    )}`;
    this.logger.log(`Deseleccionando (deregister) fuente en MediaMTX: ${url}`);
    let lastErr: any = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const observable = this.httpService.delete(url, { timeout: this.requestTimeoutMs });
        const resp: AxiosResponse<any> = await lastValueFrom(observable.pipe(timeout(this.requestTimeoutMs)) as any);
        this.logger.log(`Respuesta de deregistro de MediaMTX: ${resp.status} (intento ${attempt})`);
        return resp.data;
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        const data = err?.response?.data;
        this.logger.warn(`Intento ${attempt} falló al deregistrar fuente en MediaMTX: ${err?.message || err} status=${status} body=${JSON.stringify(data)}`);
        if (attempt < this.maxAttempts) {
          const waitMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
          this.logger.log(`Reintentando deregistrar en ${waitMs}ms...`);
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
      }
    }
    const status = lastErr?.response?.status;
    const data = lastErr?.response?.data;
    this.logger.error(`No se pudo deregistrar la fuente en MediaMTX tras ${this.maxAttempts} intentos: ${lastErr?.message || lastErr} status=${status} body=${JSON.stringify(data)}`);
    // no lanzamos excepción para evitar romper eliminaciones si MediaMTX está temporalmente no disponible
    return null;
    
  }
}
