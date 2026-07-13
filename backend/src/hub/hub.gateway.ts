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
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { checkPassword } from '../auth/utils/auth.util';
import { Hub } from './entities/hub.entity';

interface ConnectedHubInfo {
  socket: Socket;
  lastSeen: Date;
  /** Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — H2): necesario
   *  para dirigir eventos (p.ej. `hub:door_open`) SOLO al/los hub(s) del
   *  condominio correcto — ver `sendToOrganization`. */
  organizationId: string | null;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/hub', // Namespace dedicado para hubs físicos
})
export class HubGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(HubGateway.name);
  private connectedHubs: Map<string, ConnectedHubInfo> = new Map();

  constructor(
    @InjectRepository(Hub)
    private readonly hubRepository: Repository<Hub>,
  ) {}

  /**
   * Maneja la conexión de un hub. Fase 1, Bloque A1.1 (hallazgo H1 de la
   * auditoría): valida el `hubSecret` del handshake contra el `secretHash`
   * PROPIO del hub (ya no contra un `HUB_SECRET` global compartido) — mismo
   * esquema que `HubAuthGuard` para las llamadas HTTP a `/concierge/*`.
   * Async porque necesita el lookup a BD antes de aceptar/rechazar la
   * conexión. Guarda `organizationId` en `connectedHubs` — lo usa
   * `sendToOrganization` (hallazgo H2) para dirigir eventos por condominio.
   */
  async handleConnection(client: Socket) {
    const hubId = client.handshake.auth.hubId;
    const hubSecret = client.handshake.auth.hubSecret;

    if (!hubId || !hubSecret) {
      this.logger.warn(`Hub sin credenciales intentó conectarse: ${client.id}`);
      client.disconnect();
      return;
    }

    const hub = await this.hubRepository.findOne({ where: { hubId, active: true } });
    if (!hub || !hub.secretHash || !(await checkPassword(hubSecret, hub.secretHash))) {
      this.logger.warn(`Hub no autorizado intentó conectarse: ${client.id} (hubId=${hubId})`);
      client.disconnect();
      return;
    }

    // Registrar hub
    this.connectedHubs.set(hubId, {
      socket: client,
      lastSeen: new Date(),
      organizationId: hub.organizationId,
    });

    this.logger.log(`✅ Hub conectado: ${hubId} (socket: ${client.id}, org: ${hub.organizationId ?? 'sin asignar'})`);

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
   * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgo H2):
   * envía un evento SOLO a los hubs cuyo `organizationId` coincide con el
   * condominio dado — reemplaza `broadcastToAllHubs` para eventos sensibles
   * por condominio (p.ej. `hub:door_open`), donde un broadcast global
   * abriría el portón físico de TODOS los condominios conectados.
   *
   * `organizationId: null` NO hace match con hubs de `organizationId: null`
   * a propósito (comparación estricta `===`, ambos lados nulos igual
   * calzarían) — ver docstring de la llamada en
   * `DigitalConciergeService.respondToVisitor` sobre el caso "cajón nulo".
   */
  sendToOrganization(organizationId: string | null, event: string, data: any): number {
    if (!organizationId) {
      this.logger.warn(
        `sendToOrganization llamado sin organizationId — no se envía ${event} a ningún hub (evita el "cajón nulo" de abrir a hubs sin condominio asignado).`,
      );
      return 0;
    }

    let sentCount = 0;
    for (const [hubId, info] of this.connectedHubs.entries()) {
      if (info.organizationId === organizationId) {
        info.socket.emit(event, data);
        sentCount += 1;
        this.logger.debug(`📤 Enviado ${event} a hub ${hubId} (org: ${organizationId})`);
      }
    }

    if (sentCount === 0) {
      this.logger.warn(`sendToOrganization: ningún hub conectado pertenece a la organización ${organizationId} (evento ${event} no entregado)`);
    }

    return sentCount;
  }

  /**
   * Limpieza post-auditoría (dedup DUP1): encapsula el patrón "hub propio
   * conectado vs. broadcast por organización" que estaba triplicado en
   * `DigitalConciergeService.notifyHub`, `AbrirAccesoTool.execute` y
   * `PendingActionsService.notifyVisitorLive` — mismo criterio EXACTO en los
   * tres call-sites originales: si `session.hubId` está seteado y ESE hub
   * está conectado, se dirige SOLO a él (`sendToHub`); si no, se hace
   * broadcast por organización (`sendToOrganization`, nunca broadcast global
   * — ver su docstring sobre el "cajón nulo" cuando `organizationId` es
   * `null`).
   *
   * Recibe solo los dos campos que necesita (no una `ConciergeSession`
   * completa) para no acoplar `HubGateway` a esa entidad — cualquier objeto
   * con esta forma (incluida una `ConciergeSession`) es asignable acá por
   * tipado estructural.
   */
  sendToSession(
    session: { hubId: string | null; organizationId: string | null },
    event: string,
    data: any,
  ): void {
    if (session.hubId && this.isHubConnected(session.hubId)) {
      this.sendToHub(session.hubId, event, data);
      return;
    }

    this.sendToOrganization(session.organizationId, event, data);
  }

  /**
   * Broadcast a todos los hubs conectados. OJO: NO usar para eventos que
   * disparen una acción física dirigida a UN condominio (p.ej. abrir
   * portón/puerta) — usar `sendToOrganization` en esos casos (hallazgo H2).
   * Se conserva para eventos genuinamente globales (ninguno identificado hoy).
   */
  broadcastToAllHubs(event: string, data: any): void {
    this.server.emit(event, data);
    this.logger.debug(`📡 Broadcast ${event} a ${this.connectedHubs.size} hubs`);
  }
}
