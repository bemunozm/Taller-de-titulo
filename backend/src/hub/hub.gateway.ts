import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/hub', // Namespace dedicado para hubs físicos
})
export class HubGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(HubGateway.name);
  private connectedHubs: Map<string, { socket: Socket; lastSeen: Date }> = new Map();

  constructor(private readonly configService: ConfigService) {}

  /**
   * Maneja la conexión de un hub
   */
  handleConnection(client: Socket) {
    const hubId = client.handshake.auth.hubId;
    const hubSecret = client.handshake.auth.hubSecret;

    // Validar credenciales
    const validSecret = this.configService.get<string>('HUB_SECRET');
    
    if (!hubId || !hubSecret || hubSecret !== validSecret) {
      this.logger.warn(`Hub no autorizado intentó conectarse: ${client.id}`);
      client.disconnect();
      return;
    }

    // Registrar hub
    this.connectedHubs.set(hubId, {
      socket: client,
      lastSeen: new Date(),
    });

    this.logger.log(`✅ Hub conectado: ${hubId} (socket: ${client.id})`);

    // Emitir evento de conexión exitosa
    client.emit('hub:connected', {
      hubId,
      serverTime: new Date(),
      message: 'Conectado exitosamente al backend',
    });
  }

  /**
   * Maneja la desconexión de un hub
   */
  handleDisconnect(client: Socket) {
    const hubId = Array.from(this.connectedHubs.entries())
      .find(([_, data]) => data.socket.id === client.id)?.[0];
    
    if (hubId) {
      this.connectedHubs.delete(hubId);
      this.logger.log(`❌ Hub desconectado: ${hubId}`);
    }
  }

  /**
   * Hub envía número de casa marcado en el teclado
   */
  @SubscribeMessage('hub:keypad')
  async handleKeypadInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { hubId: string; houseNumber: string },
  ) {
    this.logger.log(`🔢 Keypad input de ${data.hubId}: ${data.houseNumber}`);
    
    // Actualizar lastSeen
    const hub = this.connectedHubs.get(data.hubId);
    if (hub) {
      hub.lastSeen = new Date();
    }

    // El hub manejará la lógica de intercepción localmente con su cache
    // Este evento es solo informativo para el backend
    
    return {
      success: true,
      timestamp: new Date(),
    };
  }

  /**
   * Hub reporta cambio de estado FSM
   */
  @SubscribeMessage('hub:stateChanged')
  handleStateChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { hubId: string; state: string; metadata?: any },
  ) {
    this.logger.log(`🔄 Hub ${data.hubId} cambió de estado: ${data.state}`);
    
    // Actualizar lastSeen
    const hub = this.connectedHubs.get(data.hubId);
    if (hub) {
      hub.lastSeen = new Date();
    }

    // Opcional: Guardar en BD para monitoreo
    
    return { success: true };
  }

  /**
   * Hub reporta error o evento crítico
   */
  @SubscribeMessage('hub:error')
  handleError(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { hubId: string; error: string; stack?: string },
  ) {
    this.logger.error(`❌ Error en Hub ${data.hubId}: ${data.error}`);
    
    // Opcional: Enviar alerta a administradores
    
    return { success: true };
  }

  /**
   * Hub reporta heartbeat (cada 30 segundos)
   */
  @SubscribeMessage('hub:heartbeat')
  handleHeartbeat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { 
      hubId: string; 
      uptime: number;
      cpuUsage?: number;
      memoryUsage?: number;
    },
  ) {
    const hub = this.connectedHubs.get(data.hubId);
    if (hub) {
      hub.lastSeen = new Date();
    }

    this.logger.debug(`💓 Heartbeat de ${data.hubId} (uptime: ${Math.floor(data.uptime / 1000)}s)`);
    
    return { 
      success: true,
      serverTime: new Date(),
    };
  }

  /**
   * Obtener hubs conectados
   */
  getConnectedHubs(): Array<{ hubId: string; lastSeen: Date }> {
    return Array.from(this.connectedHubs.entries()).map(([hubId, data]) => ({
      hubId,
      lastSeen: data.lastSeen,
    }));
  }

  /**
   * Verificar si un hub está conectado
   */
  isHubConnected(hubId: string): boolean {
    return this.connectedHubs.has(hubId);
  }

  /**
   * Enviar mensaje a un hub específico
   */
  sendToHub(hubId: string, event: string, data: any): boolean {
    const hub = this.connectedHubs.get(hubId);
    
    if (!hub) {
      this.logger.warn(`No se puede enviar mensaje a hub ${hubId}: no conectado`);
      return false;
    }

    hub.socket.emit(event, data);
    this.logger.debug(`📤 Enviado ${event} a hub ${hubId}`);
    
    return true;
  }

  /**
   * Broadcast a todos los hubs conectados
   */
  broadcastToAllHubs(event: string, data: any): void {
    this.server.emit(event, data);
    this.logger.debug(`📡 Broadcast ${event} a ${this.connectedHubs.size} hubs`);
  }
}
