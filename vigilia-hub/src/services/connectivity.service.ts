import * as dns from 'dns/promises';
import axios from 'axios';
import type { HubConfig } from '../config';
import { Logger } from '../utils/logger';

export class ConnectivityService {
  private readonly logger = new Logger(ConnectivityService.name);
  private isOnline = true;
  private lastCheckTime = 0;
  private readonly CHECK_INTERVAL_MS: number;

  /**
   * @param config URL del backend validada al arrancar (`loadHubConfig`,
   *   Fase 4 · P6.M).
   */
  constructor(private readonly config: Pick<HubConfig, 'backendUrl'>) {
    this.CHECK_INTERVAL_MS = parseInt(
      process.env.CONNECTIVITY_CHECK_INTERVAL_MS || '30000',
      10
    );
  }

  /**
   * Verifica conectividad a internet y backend
   */
  async checkConnectivity(): Promise<boolean> {
    const now = Date.now();

    // Cache: No verificar más de 1 vez por intervalo
    if (now - this.lastCheckTime < this.CHECK_INTERVAL_MS) {
      return this.isOnline;
    }

    this.lastCheckTime = now;

    try {
      // Método 1: DNS lookup (más rápido)
      await dns.lookup('google.com');
      
      // Método 2: Verificar backend específicamente
      await axios.head(`${this.config.backendUrl}/health`, {
        timeout: 2000,
        validateStatus: () => true // Aceptar cualquier status
      });

      if (!this.isOnline) {
        this.logger.log('✅ CONEXIÓN RESTAURADA');
      }

      this.isOnline = true;
      return true;

    } catch (error) {
      if (this.isOnline) {
        this.logger.error('❌ SIN CONEXIÓN A INTERNET');
      }
      
      this.isOnline = false;
      return false;
    }
  }

  /**
   * Monitoreo continuo en background
   */
  start() {
    this.startMonitoring();
  }

  private startMonitoring() {
    setInterval(async () => {
      const wasOnline = this.isOnline;
      await this.checkConnectivity();

      if (wasOnline && !this.isOnline) {
        this.logger.warn('⚠️ CONEXIÓN PERDIDA - Modo fallback activo');
      }
    }, this.CHECK_INTERVAL_MS);

    this.logger.log(`🌐 Monitoreo de conectividad iniciado (cada ${this.CHECK_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Obtener estado actual
   */
  getStatus(): boolean {
    return this.isOnline;
  }

  /**
   * Limpieza de recursos
   */
  cleanup(): void {
    // No hay timers que limpiar (setInterval no almacenado)
    this.logger.log('Cleanup de ConnectivityService completado');
  }
}
