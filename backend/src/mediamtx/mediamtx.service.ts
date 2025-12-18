import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { AxiosResponse } from 'axios';
import { LogsService } from '../logs/logs.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class MediamtxService {
  private readonly logger = new Logger(MediamtxService.name);
  private controlUrl = process.env.MEDIAMTX_CONTROL_URL || 'http://localhost:9997';
  // The Control API v3 base for path operations. We'll construct concrete endpoints.
  private controlApiBase = process.env.MEDIAMTX_CONTROL_API_BASE || '/v3';
  private requestTimeoutMs = Number(process.env.MEDIAMTX_REQUEST_TIMEOUT_MS || 5000);
  private maxAttempts = Number(process.env.MEDIAMTX_MAX_ATTEMPTS || 3);
  private backoffBaseMs = Number(process.env.MEDIAMTX_BACKOFF_BASE_MS || 500);

  constructor(
    private readonly httpService: HttpService,
    private readonly logsService: LogsService,
  ) {}

  /**
   * Registra o actualiza un mount/path en MediaMTX para que haga pull desde la URL RTSP indicada.
   * La carga exacta depende de la Control API de MediaMTX; esta implementación envía un JSON
   * mínimo { source } y se puede ajustar mediante variables de entorno.
   */
  async registerSource(mountPath: string, rtspUrl: string) {
    const correlationId = uuidv4();
    const startTime = Date.now();
    
    // Usar la Control API v3 para añadir la configuración de un path: POST /v3/config/paths/add/{name}
    const url = `${this.controlUrl.replace(/\/$/, '')}${this.controlApiBase}/config/paths/add/${encodeURIComponent(
      mountPath,
    )}`;
    this.logger.log(`Registrando fuente en MediaMTX: ${url} (mount=${mountPath}) [${correlationId}]`);
    
    // La API espera un objeto PathConf. Enviamos campos mínimos: source (la URL RTSP)
    const body = {
      source: rtspUrl,
    };
    
    let lastErr: any = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const observable = this.httpService.post(url, body, { timeout: this.requestTimeoutMs });
        const resp: AxiosResponse<any> = await lastValueFrom(observable.pipe(timeout(this.requestTimeoutMs)) as any);
        const responseTime = Date.now() - startTime;
        
        this.logger.log(`Respuesta de registro de MediaMTX: ${resp.status} (intento ${attempt}) [${correlationId}]`);
        
        // Log de éxito
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
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        const data = err?.response?.data;
        this.logger.warn(`Intento ${attempt} falló al registrar fuente en MediaMTX: ${err?.message || err} status=${status} body=${JSON.stringify(data)} [${correlationId}]`);
        
        if (attempt < this.maxAttempts) {
          const waitMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
          this.logger.log(`Reintentando en ${waitMs}ms... [${correlationId}]`);
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
      }
    }
    
    const responseTime = Date.now() - startTime;
    const status = lastErr?.response?.status;
    const data = lastErr?.response?.data;
    
    // Log de error final
    await this.logsService.logMediaMTX({
      action: 'register_source',
      success: false,
      details: {
        mountPath,
        attempts: this.maxAttempts,
        statusCode: status,
        responseTime,
        errorData: data,
      },
      error: lastErr,
      correlationId,
    });
    this.logger.error(`No se pudo registrar la fuente en MediaMTX tras ${this.maxAttempts} intentos: ${lastErr?.message || lastErr} status=${status} body=${JSON.stringify(data)}`);
    throw new InternalServerErrorException('No se pudo registrar la fuente en MediaMTX');
    
  }

  async deregisterSource(mountPath: string) {
    const correlationId = uuidv4();
    const startTime = Date.now();
    
    // Use Control API v3 to delete path config: DELETE /v3/config/paths/delete/{name}
    const url = `${this.controlUrl.replace(/\/$/, '')}${this.controlApiBase}/config/paths/delete/${encodeURIComponent(
      mountPath,
    )}`;
    this.logger.log(`Deseleccionando (deregister) fuente en MediaMTX: ${url} [${correlationId}]`);
    
    let lastErr: any = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const observable = this.httpService.delete(url, { timeout: this.requestTimeoutMs });
        const resp: AxiosResponse<any> = await lastValueFrom(observable.pipe(timeout(this.requestTimeoutMs)) as any);
        const responseTime = Date.now() - startTime;
        
        this.logger.log(`Respuesta de deregistro de MediaMTX: ${resp.status} (intento ${attempt}) [${correlationId}]`);
        
        // Log de éxito
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
      } catch (err: any) {
        lastErr = err;
        const status = err?.response?.status;
        const data = err?.response?.data;
        this.logger.warn(`Intento ${attempt} falló al deregistrar fuente en MediaMTX: ${err?.message || err} status=${status} body=${JSON.stringify(data)} [${correlationId}]`);
        
        if (attempt < this.maxAttempts) {
          const waitMs = this.backoffBaseMs * Math.pow(2, attempt - 1);
          this.logger.log(`Reintentando deregistrar en ${waitMs}ms... [${correlationId}]`);
          await new Promise((res) => setTimeout(res, waitMs));
          continue;
        }
      }
    }
    
    const responseTime = Date.now() - startTime;
    const status = lastErr?.response?.status;
    const data = lastErr?.response?.data;
    
    // Log de error
    await this.logsService.logMediaMTX({
      action: 'deregister_source',
      success: false,
      details: {
        mountPath,
        attempts: this.maxAttempts,
        statusCode: status,
        responseTime,
        errorData: data,
      },
      error: lastErr,
      correlationId,
    });
    
    this.logger.error(`No se pudo deregistrar la fuente en MediaMTX tras ${this.maxAttempts} intentos: ${lastErr?.message || lastErr} status=${status} body=${JSON.stringify(data)} [${correlationId}]`);
    // no lanzamos excepción para evitar romper eliminaciones si MediaMTX está temporalmente no disponible
    return null;
  }

  /**
   * Consulta estado del servidor MediaMTX usando su API de control.
   * Retorna { ok: boolean, status: string, details?: any, message?: string }
   */
  async getHealth() {
    const base = this.controlUrl.replace(/\/$/, '');
    // Try a few likely control API endpoints used by MediaMTX (controlApiBase may be '/v3')
    const apiBase = this.controlApiBase || '';
    // First, try the canonical /v3/info endpoint which returns version/started info.
    const infoUrl = `${base}${apiBase}/info`;
    try {
      this.logger.debug(`Probing MediaMTX control info url: ${infoUrl}`);
      const observable = this.httpService.get(infoUrl, { timeout: this.requestTimeoutMs, responseType: 'text' as any });
      const resp: any = await lastValueFrom(observable.pipe(timeout(this.requestTimeoutMs)) as any);
      if (resp && resp.status === 200) {
        const raw = resp.data;
        let details: any = null;
        // If axios already parsed JSON, raw may be object. Otherwise it may be a string.
        if (raw && typeof raw === 'object') {
          details = {
            version: raw.version ?? raw.Version ?? null,
            started: raw.started ?? raw.Started ?? raw.started_at ?? null,
            raw: raw,
          };
        } else if (typeof raw === 'string') {
          // Try parsing as JSON first
          try {
            const parsed = JSON.parse(raw);
            details = {
              version: parsed.version ?? parsed.Version ?? null,
              started: parsed.started ?? parsed.Started ?? parsed.started_at ?? null,
              raw: parsed,
            };
          } catch {
            // Not JSON — try parsing a whitespace-separated table like the PowerShell output
            const lines = raw.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length >= 2) {
              const headers = lines[0].split(/\s+/);
              const values = lines[1].split(/\s+/);
              const m: any = {};
              for (let i = 0; i < headers.length; i++) {
                m[headers[i]] = values[i] ?? null;
              }
              details = {
                version: m.version ?? m.Version ?? null,
                started: m.started ?? m.Started ?? null,
                raw: m,
              };
            } else {
              // unknown format, return raw string
              details = { raw };
            }
          }
        }

        return { ok: true, status: 'running', details };
      }
    } catch (err: any) {
      this.logger.warn(`Probing ${infoUrl} failed: ${err?.message ?? err}`);
      // Do not fallback to other URLs; only consider /v3/info as canonical for health.
      return { ok: false, status: 'unavailable', message: err?.message ?? 'info endpoint unreachable' };
    }
  }
}
