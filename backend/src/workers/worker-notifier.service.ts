import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { LogsService } from '../logs/logs.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class WorkerNotifierService {
  private readonly logger = new Logger(WorkerNotifierService.name);
  private baseUrl = process.env.WORKER_MANAGER_URL || null;
  private secret = process.env.WORKER_MANAGER_SECRET || null;
  private timeout = parseInt(process.env.WORKER_MANAGER_TIMEOUT || '5000', 10);

  constructor(private readonly logsService: LogsService) {}

  async registerCamera(cameraId: string, rtspUrl: string, mountPath?: string) {
    if (!this.baseUrl) return;
    
    const correlationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;
      
      await axios.post(`${this.baseUrl.replace(/\/$/, '')}/register-camera`, {
        cameraId,
        rtspUrl,
        mountPath,
      }, { timeout: this.timeout, headers });
      
      const responseTime = Date.now() - startTime;
      
      this.logger.log(`Notified worker manager register for camera ${cameraId} [${correlationId}]`);
      
      // Log de éxito
      await this.logsService.logWorkerAPI({
        action: 'register_camera',
        cameraId,
        success: true,
        details: { mountPath, responseTime },
        correlationId,
      });
    } catch (err: any) {
      const responseTime = Date.now() - startTime;
      
      this.logger.warn(`Failed to notify worker manager register: ${err?.message || err} [${correlationId}]`);
      
      // Log de error
      await this.logsService.logWorkerAPI({
        action: 'register_camera',
        cameraId,
        success: false,
        details: { mountPath, responseTime },
        error: err,
        correlationId,
      });
    }
  }

  async unregisterCamera(cameraId: string) {
    if (!this.baseUrl) return;
    
    const correlationId = uuidv4();
    const startTime = Date.now();
    
    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;
      
      await axios.post(`${this.baseUrl.replace(/\/$/, '')}/unregister-camera`, { cameraId }, { timeout: this.timeout, headers });
      
      const responseTime = Date.now() - startTime;
      
      this.logger.log(`Notified worker manager unregister for camera ${cameraId} [${correlationId}]`);
      
      // Log de éxito
      await this.logsService.logWorkerAPI({
        action: 'unregister_camera',
        cameraId,
        success: true,
        details: { responseTime },
        correlationId,
      });
    } catch (err: any) {
      const responseTime = Date.now() - startTime;
      
      this.logger.warn(`Failed to notify worker manager unregister: ${err?.message || err} [${correlationId}]`);
      
      // Log de error
      await this.logsService.logWorkerAPI({
        action: 'unregister_camera',
        cameraId,
        success: false,
        details: { responseTime },
        error: err,
        correlationId,
      });
    }
  }

  /**
   * Consulta el endpoint de health del worker manager y retorna un objeto con el estado.
   * Si no hay baseUrl configurada retorna { ok: false, status: 'disabled' }
   */
  async getHealth() {
    if (!this.baseUrl) {
      return { ok: false, status: 'disabled', message: 'WORKER_MANAGER_URL not configured' };
    }

    const correlationId = uuidv4();
    const startTime = Date.now();

    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;
      const url = `${this.baseUrl.replace(/\/$/, '')}/health`;
      const resp = await axios.get(url, { timeout: this.timeout, headers });
      
      const responseTime = Date.now() - startTime;
      
      // Si el worker responde 200 asumimos running; devolveremos el payload si existe
      if (resp && resp.status === 200) {
        this.logger.log(`Worker manager health check: OK [${correlationId}]`);
        
        await this.logsService.logWorkerAPI({
          action: 'health_check',
          success: true,
          details: { status: resp.status, responseTime },
          correlationId,
        });
        
        return { ok: true, status: 'running', details: resp.data || null };
      }
      
      const responseTime2 = Date.now() - startTime;
      this.logger.warn(`Worker manager health check: ERROR status ${resp?.status} [${correlationId}]`);
      
      await this.logsService.logWorkerAPI({
        action: 'health_check',
        success: false,
        details: { status: resp?.status, responseTime: responseTime2 },
        correlationId,
      });
      
      return { ok: false, status: 'error', details: resp?.data || null };
    } catch (err: any) {
      const responseTime = Date.now() - startTime;
      
      this.logger.warn(`Failed to query worker manager health: ${err?.message || err} [${correlationId}]`);
      
      await this.logsService.logWorkerAPI({
        action: 'health_check',
        success: false,
        details: { responseTime },
        error: err,
        correlationId,
      });
      
      // Distinguimos timeout/conexion vs respuesta con error
      return { ok: false, status: 'stopped', message: err?.message || String(err) };
    }
  }
}
