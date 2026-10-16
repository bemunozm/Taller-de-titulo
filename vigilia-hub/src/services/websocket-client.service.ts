import axios from 'axios';
import type { Socket } from 'socket.io-client';
import type { HubConfig } from '../config';
import { hubAuthHeaders, type HubCredentials } from '../utils/hub-auth-headers';
import { Logger } from '../utils/logger';
import { ConnectivityService } from './connectivity.service';

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

/**
 * Eventos del namespace `/hub` (backend/src/hub/hub.gateway.ts). Fase 4 · P4:
 * el hub emitía `keypad`/`heartbeat` sin prefijo y el gateway escucha
 * `hub:keypad`/`hub:heartbeat`, así que nunca llegaban. El gateway identifica
 * al hub por el handshake, no por el body.
 */
export const HUB_KEYPAD_EVENT = 'hub:keypad';
export const HUB_HEARTBEAT_EVENT = 'hub:heartbeat';
export const HUB_DOOR_OPEN_EVENT = 'hub:door_open';

/** Confirmación del backend tras registrar el socket (`HubGateway.handleConnection`). */
export const HUB_CONNECTED_EVENT = 'hub:connected';

/** Intervalo del heartbeat (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Backoff de la reconexión manual (Fase 4 · P4). */
export const RECONNECT_BASE_DELAY_MS = 5_000;
export const RECONNECT_MAX_DELAY_MS = 60_000;
/**
 * Tiempo que la conexión debe seguir viva después de `hub:connected` para
 * reiniciar el backoff (Fase 4 · P4, A1).
 */
export const RECONNECT_STABLE_AFTER_MS = 30_000;

/** Motivo de `disconnect` cuando el backend cortó el socket (socket.io). */
export const SERVER_DISCONNECT_REASON = 'io server disconnect';

/**
 * Espera antes del reintento número `attempt` (desde 0): exponencial desde
 * 5 s, con jitter de ±20 % y tope de 60 s. El jitter evita que todos los hubs
 * de un condominio reintenten a la vez cuando vuelve el backend.
 */
export function computeReconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** attempt,
  );
  const jittered = exponential * (0.8 + random() * 0.4);
  return Math.min(RECONNECT_MAX_DELAY_MS, Math.round(jittered));
}

export type DoorType = 'vehicular' | 'pedestrian';

/** Tipo de acceso de una orden `hub:door_open`, o `null` si el payload no es válido. */
export function parseDoorOpenType(data: unknown): DoorType | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const type = (data as { type?: unknown }).type;
  return type === 'vehicular' || type === 'pedestrian' ? type : null;
}

export class WebSocketClientService {
  private readonly logger = new Logger(WebSocketClientService.name);
  private socket: Socket | null = null;

  /** Origen HTTP(S) del backend (llamadas a `/api/v1/...`). */
  private readonly backendUrl: string;
  /** Mismo origen con esquema WebSocket (`wss://` en producción). */
  private readonly backendSocketUrl: string;
  private readonly hubId: string;
  private readonly hubSecret: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  /**
   * Reconexión manual tras un rechazo del middleware de `/hub` o un corte del
   * backend (Fase 4 · P4).
   */
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  /** Reinicia el backoff si la conexión sigue estable (ver `RECONNECT_STABLE_AFTER_MS`). */
  private stableTimer: NodeJS.Timeout | null = null;
  /** `true` tras `disconnect()`: no se reintenta. */
  private closing = false;

  /**
   * Fase 4 · P6.M: la URL y la credencial vienen de `loadHubConfig` (validada
   * al arrancar): `https`/`wss` en producción, `HUB_ID` y `HUB_SECRET`
   * obligatorios. Antes había defaults (`http://localhost:3000`, un `hubId`
   * aleatorio) que nunca podían autenticar.
   */
  constructor(
    private readonly connectivityService: ConnectivityService,
    config: Pick<HubConfig, 'backendUrl' | 'backendSocketUrl' | 'hubId' | 'hubSecret'>,
  ) {
    this.backendUrl = config.backendUrl;
    this.backendSocketUrl = config.backendSocketUrl;
    this.hubId = config.hubId;
    this.hubSecret = config.hubSecret;
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
    const { io } = await import('socket.io-client');
    this.closing = false;

    this.logger.log(`🔌 Conectando a ${this.backendSocketUrl}/hub...`);
    this.logger.debug(`🔑 Auth: hubId=${this.hubId}`);

    const socket = io(`${this.backendSocketUrl}/hub`, {
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
    this.socket = socket;

    this.setupEventHandlers(socket);
  }

  /**
   * Configura listeners de eventos
   */
  private setupEventHandlers(socket: Socket): void {
    socket.on('connect', () => {
      this.logger.log('✅ Conectado al backend');
      this.startHeartbeat();
    });

    socket.on('disconnect', (reason: string) => {
      this.logger.warn(`❌ Desconectado del backend: ${reason}`);
      this.stopHeartbeat();
      // La conexión no duró lo suficiente para contar como estable.
      this.clearStableTimer();
      // Fase 4 · P4 (A1): con `io server disconnect` (el backend cortó el
      // socket: reconexión de otro proceso con la misma credencial, secret
      // rotado, hub desactivado o con otro tipo/condominio) socket.io-client
      // NO reintenta solo. Sin esto el portón quedaba sin socket hasta
      // reiniciar la Raspberry. Con la credencial revocada, el reintento
      // recibe `connect_error` y sigue con backoff hasta que se configure la
      // nueva.
      if (reason === SERVER_DISCONNECT_REASON) {
        this.scheduleReconnect(socket, 'el backend cerró la conexión');
      }
    });

    socket.on('connect_error', (error: Error) => {
      this.logger.error('Error de conexión al backend', error);
      // Fase 4 · P4: el backend autentica en el middleware de /hub, ANTES del
      // CONNECT. Ante ese rechazo socket.io-client NO reintenta solo
      // (`socket.active === false`): se programa una reconexión manual con
      // backoff, para que un fallo transitorio del backend (p. ej. la BD
      // caída) no deje al hub desconectado para siempre.
      if (!socket.active) {
        this.scheduleReconnect(socket, 'conexión rechazada por el backend');
      }
    });

    // Registro confirmado: el backoff se reinicia recién cuando la conexión
    // lleva `RECONNECT_STABLE_AFTER_MS` estable. Así dos procesos con la
    // misma credencial (que se expulsan entre sí, last-wins) reintentan cada
    // vez más espaciado en vez de cada pocos segundos.
    socket.on(HUB_CONNECTED_EVENT, () => {
      this.clearReconnectTimer();
      this.clearStableTimer();
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null;
        this.reconnectAttempt = 0;
      }, RECONNECT_STABLE_AFTER_MS);
    });

    socket.on('error', (error: unknown) => {
      this.logger.error('Error en socket', error);
    });
  }

  /**
   * Reconexión manual con backoff exponencial y jitter (5 s → máx. 60 s).
   * Un solo reintento pendiente a la vez; nada tras `disconnect()`.
   */
  private scheduleReconnect(socket: Socket, cause: string): void {
    if (this.closing || this.reconnectTimer) {
      return;
    }
    const delay = computeReconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.logger.warn(
      `${cause}: reintento ${this.reconnectAttempt} en ${Math.round(delay / 1000)} s`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closing) {
        socket.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  /**
   * Permite suscribirse a un evento dinámico de Socket.IO
   */
  onEvent(eventName: string, callback: (data: unknown) => void): void {
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
   * Evento especial para gatillar apertura de relés desde la nube.
   * Fail-closed: una orden con un `type` desconocido se ignora (antes caía a
   * abrir la puerta peatonal).
   */
  onDoorOpenCommand(callback: (type: DoorType) => void): void {
    if (!this.socket) {
      this.logger.warn(`No se puede suscribir a ${HUB_DOOR_OPEN_EVENT}, socket no está inicializado`);
      return;
    }
    this.socket.on(HUB_DOOR_OPEN_EVENT, (data: unknown) => {
      const type = parseDoorOpenType(data);
      if (!type) {
        this.logger.warn('Orden de apertura con payload inesperado: se ignora');
        return;
      }
      const visitId = (data as { visitId?: unknown }).visitId;
      this.logger.log(`📥 Orden de apertura recibida: ${type} (Visita ${typeof visitId === 'string' ? visitId : 'n/a'})`);
      callback(type);
    });
  }

  /**
   * Inicia heartbeat cada 30s (`hub:heartbeat`; `uptime` en ms, como lo lee
   * el gateway).
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      this.socket?.emit(HUB_HEARTBEAT_EVENT, {
        uptime: Math.round(process.uptime() * 1000),
        timestamp: Date.now(),
        status: 'active'
      });
    }, HEARTBEAT_INTERVAL_MS);
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

    this.socket.emit(HUB_KEYPAD_EVENT, {
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
  getHubCredentials(): HubCredentials {
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
            // Fase 1, Bloque A1: X-Hub-Id resuelve el tenant
            // (organizationId) desde Hub.organizationId; X-Hub-Secret lo
            // autentica.
            ...hubAuthHeaders(this.getHubCredentials()),
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
    return this.socket?.id ?? undefined;
  }

  /**
   * Verifica si está conectado
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * Desconecta del backend
   */
  disconnect(): void {
    // Cierre voluntario: ni el `disconnect` resultante ni un reintento
    // pendiente vuelven a conectar.
    this.closing = true;
    this.clearReconnectTimer();
    this.clearStableTimer();
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
