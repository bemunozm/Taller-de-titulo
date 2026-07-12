import axios from 'axios';
import { Logger } from '../utils/logger';
import { ConnectivityService } from './connectivity.service';

interface ToolCallRequest {
  sessionId: string;
  toolName: string;
  toolArgs: Record<string, any>;
}

/**
 * Espejo local de `ToolResultDto`
 * (backend/src/digital-concierge/dto/execute-tool.dto.ts) — contrato que
 * `POST /concierge/session/:id/execute-tool` ya devuelve hoy para
 * CUALQUIER tool del catálogo (Fase 1, Bloque A2b), incluida
 * `finalizar_llamada` (Bloque C: `data.finalizada === true` es la señal de
 * fin de llamada que interpreta `ConciergeClientService`).
 */
export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export class WebSocketClientService {
  private readonly logger = new Logger(WebSocketClientService.name);
  private io: any; // socket.io-client
  private socket: any;
  
  private readonly backendUrl: string;
  private readonly hubId: string;
  private readonly hubSecret: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly connectivityService: ConnectivityService
  ) {
    this.backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    this.hubId = process.env.HUB_ID || `hub-${Math.random().toString(36).substr(2, 9)}`;
    this.hubSecret = process.env.HUB_SECRET || '';

    if (!this.hubSecret) {
      throw new Error('HUB_SECRET no configurado en .env');
    }
  }

  /**
   * Conecta al backend vía WebSocket
   */
  async connect(): Promise<void> {
    const isOnline = await this.connectivityService.checkConnectivity();
    
    if (!isOnline) {
      throw new Error('Sin conectividad, no se puede conectar al backend');
    }

    // Importación dinámica de socket.io-client
    const socketIO = await import('socket.io-client');
    this.io = socketIO.io;

    this.logger.log(`🔌 Conectando a ${this.backendUrl}/hub...`);
    this.logger.debug(`🔑 Auth: hubId=${this.hubId}, hubSecret=${this.hubSecret ? '***' : 'MISSING'}`);

    this.socket = this.io(`${this.backendUrl}/hub`, {
      auth: {
        hubId: this.hubId,
        hubSecret: this.hubSecret  // ✅ Cambiar de "secret" a "hubSecret"
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 10000
    });

    this.setupEventHandlers();
  }

  /**
   * Configura listeners de eventos
   */
  private setupEventHandlers(): void {
    this.socket.on('connect', () => {
      this.logger.log('✅ Conectado al backend');
      this.startHeartbeat();
    });

    this.socket.on('disconnect', (reason: string) => {
      this.logger.warn(`❌ Desconectado del backend: ${reason}`);
      this.stopHeartbeat();
    });

    this.socket.on('connect_error', (error: Error) => {
      this.logger.error('Error de conexión al backend', error);
    });

    this.socket.on('error', (error: any) => {
      this.logger.error('Error en socket', error);
    });
  }

  /**
   * Permite suscribirse a un evento dinámico de Socket.IO
   */
  onEvent(eventName: string, callback: (data: any) => void): void {
    if (!this.socket) {
      this.logger.warn(`No se puede suscribir a ${eventName}, socket no está inicializado`);
      return;
    }
    this.socket.on(eventName, callback);
    this.logger.debug(`👂 Suscrito a evento WebSocket: ${eventName}`);
  }

  /**
   * Elimina suscripción a un evento de Socket.IO
   */
  offEvent(eventName: string): void {
    if (!this.socket) return;
    this.socket.off(eventName);
  }

  /**
   * Evento especial para gatillar apertura de relés desde la nube
   */
  onDoorOpenCommand(callback: (type: 'vehicular' | 'pedestrian') => void): void {
    if (!this.socket) {
      this.logger.warn(`No se puede suscribir a hub:door_open, socket no está inicializado`);
      return;
    }
    this.socket.on('hub:door_open', (data: { type: 'vehicular' | 'pedestrian', visitId: string }) => {
      this.logger.log(`📥 Orden de apertura recibida: ${data.type} (Visita ${data.visitId})`);
      callback(data.type);
    });
  }

  /**
   * Inicia heartbeat cada 30s
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      this.socket.emit('heartbeat', {
        timestamp: Date.now(),
        status: 'active'
      });
    }, 30000);
  }

  /**
   * Detiene heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Emite evento de tecla presionada
   */
  emitKeypadEvent(houseNumber: string): void {
    if (!this.socket?.connected) {
      this.logger.warn('Socket no conectado, no se puede emitir evento');
      return;
    }

    this.socket.emit('keypad', {
      houseNumber,
      timestamp: Date.now()
    });

    this.logger.debug(`📤 Evento keypad enviado: ${houseNumber}`);
  }

  /**
   * Credenciales del hub para autenticar llamadas HTTP a `/api/v1/concierge/*`
   * (Fase 1, Bloque A1 — backend/src/hub/guards/hub-auth.guard.ts). Mismo
   * hubId/hubSecret usados para el WebSocket `/hub`, expuestos acá porque
   * `ConciergeClientService` también hace llamadas HTTP propias
   * (session/start, context, session/:id/end) que necesitan autenticarse.
   */
  getHubCredentials(): { hubId: string; hubSecret: string } {
    return { hubId: this.hubId, hubSecret: this.hubSecret };
  }

  /**
   * Ejecuta una tool del backend vía HTTP (no por WebSocket para evitar latencia)
   */
  async executeTool(toolName: string, toolArgs: Record<string, unknown>, sessionId: string): Promise<ToolExecutionResult> {
    try {
      this.logger.log(`🔧 Ejecutando tool: ${toolName}`);

      const response = await axios.post<ToolExecutionResult>(
        `${this.backendUrl}/api/v1/concierge/session/${sessionId}/execute-tool`,
        {
          toolName,
          parameters: toolArgs
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Secret': this.hubSecret,
            // Fase 1, Bloque A1: el backend ya validaba (a partir de ahora)
            // X-Hub-Secret pero no sabía QUÉ hub llamaba — X-Hub-Id resuelve
            // el tenant (organizationId) desde Hub.organizationId.
            'X-Hub-Id': this.hubId
          },
          timeout: 10000
        }
      );

      this.logger.debug(`✅ Tool ${toolName} ejecutada`);
      return response.data;
    } catch (error) {
      this.logger.error(`Error ejecutando tool ${toolName}`, error);
      throw error;
    }
  }

  /**
   * Obtiene el ID del socket actual (necesario para notificaciones)
   */
  getSocketId(): string | undefined {
    return this.socket?.id;
  }

  /**
   * Verifica si está conectado
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Desconecta del backend
   */
  disconnect(): void {
    this.stopHeartbeat();
    
    if (this.socket) {
      this.socket.disconnect();
      this.logger.log('Desconectado del backend');
    }
  }

  /**
   * Limpieza
   */
  cleanup(): void {
    this.disconnect();
  }
}
