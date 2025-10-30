import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WorkerNotifierService {
  private readonly logger = new Logger(WorkerNotifierService.name);
  private baseUrl = process.env.WORKER_MANAGER_URL || null;
  private secret = process.env.WORKER_MANAGER_SECRET || null;
  private timeout = parseInt(process.env.WORKER_MANAGER_TIMEOUT || '5000', 10);

  async registerCamera(cameraId: string, rtspUrl: string, mountPath?: string) {
    if (!this.baseUrl) return;
    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;
      await axios.post(`${this.baseUrl.replace(/\/$/, '')}/register-camera`, {
        cameraId,
        rtspUrl,
        mountPath,
      }, { timeout: this.timeout, headers });
      this.logger.log(`Notified worker manager register for camera ${cameraId}`);
    } catch (err: any) {
      this.logger.warn(`Failed to notify worker manager register: ${err?.message || err}`);
    }
  }

  async unregisterCamera(cameraId: string) {
    if (!this.baseUrl) return;
    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;
      await axios.post(`${this.baseUrl.replace(/\/$/, '')}/unregister-camera`, { cameraId }, { timeout: this.timeout, headers });
      this.logger.log(`Notified worker manager unregister for camera ${cameraId}`);
    } catch (err: any) {
      this.logger.warn(`Failed to notify worker manager unregister: ${err?.message || err}`);
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

    try {
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (this.secret) headers['Authorization'] = `Bearer ${this.secret}`;
      const url = `${this.baseUrl.replace(/\/$/, '')}/health`;
      const resp = await axios.get(url, { timeout: this.timeout, headers });
      // Si el worker responde 200 asumimos running; devolveremos el payload si existe
      if (resp && resp.status === 200) {
        return { ok: true, status: 'running', details: resp.data || null };
      }
      return { ok: false, status: 'error', details: resp?.data || null };
    } catch (err: any) {
      this.logger.warn(`Failed to query worker manager health: ${err?.message || err}`);
      // Distinguimos timeout/conexion vs respuesta con error
      return { ok: false, status: 'stopped', message: err?.message || String(err) };
    }
  }
}
