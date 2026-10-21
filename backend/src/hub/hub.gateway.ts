import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketServer,
} from '@nestjs/websockets';
import { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Hub, HubType } from './entities/hub.entity';
import { HubAuthFailureLimiter } from './hub-auth-failure-limiter';
import { HubCredentialCache } from './hub-credential-cache';
import { isValidHubId, verifyHubCredentials } from './hub-credentials';

/** Evento que acciona el relé del portón o la puerta (solo hubs físicos). */
export const DOOR_OPEN_EVENT = 'hub:door_open';

/** Prefijo del evento con la respuesta del residente (`visitor:response:<sessionId>`). */
export const VISITOR_RESPONSE_EVENT_PREFIX = 'visitor:response:';

/**
 * Identidad del dispositivo resuelta en el handshake (Fase 4 · P4, D6/D7).
 * Es la ÚNICA fuente de verdad de los handlers `hub:*`: nunca se usa el
 * `hubId` que venga en el body de un mensaje.
 */
export interface HubSocketIdentity {
  hubId: string;
  type: HubType;
  organizationId: string | null;
}

/** `socket.data` de un socket del namespace `/hub`. */
export interface HubSocketData {
  hub?: HubSocketIdentity;
  /** Contador de revocaciones del hub al autenticarse (ver `disconnectHub`). */
  authRevocation?: number;
}

export type HubSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  HubSocketData
>;

export type HubNamespace = Namespace<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  HubSocketData
>;

/**
 * Error del middleware de `/hub` ante cualquier credencial rechazada
 * (Fase 4 · P4): genérico, no revela si el `hubId` existe.
 */
export const HUB_WS_UNAUTHORIZED_ERROR = 'unauthorized';

interface ConnectedHubInfo {
  socket: HubSocket;
  lastSeen: Date;
  /** Fase 1, Bloque A1.1 (H2): dirige eventos solo al condominio correcto. */
  organizationId: string | null;
  /** Fase 4 · P4 (D7): `hub:door_open` solo va a `physical-hub`. */
  type: HubType;
}

/** Orden de apertura que recibe el hub físico (`hub:door_open`). */
export interface DoorOpenCommand {
  type: 'vehicular' | 'pedestrian';
  visitId?: string | null;
  plate?: string;
}

/** Hub y condominio a los que se dirige un evento (p. ej. una `ConciergeSession`). */
export interface HubRoutingTarget {
  hubId: string | null;
  organizationId: string | null;
}

/** Sesión del citófono dueña de un `visitor:response:<sessionId>`. */
export interface VisitorResponseTarget extends HubRoutingTarget {
  sessionId: string;
}

/**
 * Payload de `visitor:response:<sessionId>` (Fase 4 · P4). Todo emisor manda
 * `approved` y `entryRegistered`: el hub y el kiosko solo dicen "pase" si
 * ambos son `true` (fail-closed).
 */
export interface VisitorResponsePayload {
  sessionId: string;
  approved: boolean;
  entryRegistered: boolean;
  timestamp: Date;
  visitId?: string | null;
  residentResponse?: 'approved' | 'denied' | 'pending' | null;
  message?: string;
  pendingActionId?: string;
  toolName?: string;
  outcome?: 'approved' | 'rejected';
}

/** Campo de un objeto de origen externo (handshake o body de un mensaje). */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }
  return (source as Record<string, unknown>)[key];
}

function readStringField(source: unknown, key: string): string | undefined {
  const value = readField(source, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumberField(source: unknown, key: string): number | undefined {
  const value = readField(source, key);
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

// Fase 4 · P6.R (D13): sin `cors` propio. CORS y el chequeo de `Origin` del
// handshake los fija `VigiliaIoAdapter` (main.ts) para todos los namespaces;
// vigilia-hub (Node) conecta sin `Origin` y el kiosko web desde el frontend.
@WebSocketGateway({
  namespace: '/hub', // Hubs físicos y kioskos web (Fase 4 · P4, D7)
})
export class HubGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  /** Con `namespace`, Nest inyecta el `Namespace` `/hub` (no el `Server`). */
  @WebSocketServer()
  server: HubNamespace;

  private readonly logger = new Logger(HubGateway.name);
  private readonly connectedHubs = new Map<string, ConnectedHubInfo>();
  /**
   * Contador de revocaciones por hub (`disconnectHub`). Un handshake que
   * empezó antes de rotar el secret o desactivar el hub, y termina después,
   * no se acepta ni se registra (ver `authenticateHandshake` y
   * `handleConnection`).
   */
  private readonly revocations = new Map<string, number>();

  constructor(
    @InjectRepository(Hub)
    private readonly hubRepository: Repository<Hub>,
    private readonly failureLimiter: HubAuthFailureLimiter,
    private readonly credentialCache: HubCredentialCache,
  ) {}

  /**
   * Fase 4 · P4: la autenticación corre en un middleware del namespace, ANTES
   * del CONNECT. Antes se hacía en `handleConnection`, cuando socket.io ya
   * había confirmado la conexión: un cliente con la credencial revocada veía
   * `connect` y después `disconnect`, y reintentaba en bucle. Con el
   * middleware recibe `connect_error` (mensaje genérico) y no se conecta.
   */
  afterInit(server: HubNamespace): void {
    server.use((socket, next) => {
      void this.authenticateHandshake(socket).then(
        (accepted) => {
          next(accepted ? undefined : new Error(HUB_WS_UNAUTHORIZED_ERROR));
        },
        (error: unknown) => {
          this.logger.error(
            `Error autenticando el handshake del socket ${socket.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          next(new Error(HUB_WS_UNAUTHORIZED_ERROR));
        },
      );
    });
  }

  /**
   * Handshake del hub (middleware). Fase 1, Bloque A1.1 (H1): valida
   * `hubSecret` contra el `secretHash` PROPIO del hub activo
   * (`verifyHubCredentials`, mismo costo de bcrypt para cualquier rechazo).
   * Si el hub se revocó (secret rotado o desactivado) mientras se verificaba,
   * se rechaza. Deja la identidad (`hubId`, `type`, `organizationId`) en
   * `socket.data.hub`.
   *
   * @returns `true` si la credencial es válida.
   */
  private async authenticateHandshake(socket: HubSocket): Promise<boolean> {
    const auth: unknown = socket.handshake.auth;
    const hubId = readStringField(auth, 'hubId');
    const hubSecret = readStringField(auth, 'hubSecret');

    if (!hubId || !hubSecret) {
      this.logger.warn(`Hub sin credenciales intentó conectarse: ${socket.id}`);
      return false;
    }

    // Fase 4 · P4.B (cyber B7): formato de `hubId` antes de la BD o bcrypt;
    // el valor no se escribe en el log.
    if (!isValidHubId(hubId)) {
      this.logger.warn(
        `Hub con hubId de formato inválido intentó conectarse: ${socket.id}`,
      );
      return false;
    }

    const revocationAtStart = this.revocationCount(hubId);

    // Fase 4 · P4.B (cyber N1): una credencial ya verificada entra sin bcrypt
    // y sin tocar el limitador (el hub legítimo reconecta aunque su IP esté
    // bloqueada o haya una ráfaga). `disconnectHub` invalida el caché.
    const cached = this.credentialCache.lookup(hubId, hubSecret);
    if (cached) {
      socket.data.hub = cached;
      socket.data.authRevocation = revocationAtStart;
      return true;
    }
    const cacheGeneration = this.credentialCache.generation(hubId);

    // Fase 4 · P4.B (D9, cyber M1/M2): mismo limitador que `HubAuthGuard`; el
    // intento se reserva ANTES del bcrypt. El cliente recibe el mismo
    // `unauthorized` genérico (no se le revela que está limitado).
    const clientIp = this.failureLimiter.clientIpFromHandshake(
      socket.handshake,
    );
    const reservation = this.failureLimiter.tryBegin(clientIp);
    if (!reservation.ok) {
      return false;
    }
    const { attempt } = reservation;

    let result: Awaited<ReturnType<typeof verifyHubCredentials>>;
    try {
      result = await verifyHubCredentials(this.hubRepository, hubId, hubSecret);
    } catch (error) {
      // Sin veredicto (p. ej. BD caída): no cuenta como fallo del cliente.
      attempt.abort();
      throw error;
    }
    if (!result.ok) {
      attempt.fail();
      this.logger.warn(
        `Hub no autorizado intentó conectarse: ${socket.id} (hubId=${hubId}, motivo=${result.reason})`,
      );
      return false;
    }

    if (this.revocationCount(hubId) !== revocationAtStart) {
      // La credencial era válida al verificarla: no es un fallo, pero
      // tampoco se recuerda el dispositivo.
      attempt.abort();
      this.logger.warn(
        `Hub ${hubId} revocado durante el handshake (socket ${socket.id}): se rechaza la conexión`,
      );
      return false;
    }
    attempt.succeed();

    const { hub } = result;
    const identity: HubSocketIdentity = {
      hubId: hub.hubId,
      type: hub.type,
      organizationId: hub.organizationId,
    };
    this.credentialCache.store(identity, hubSecret, cacheGeneration);
    socket.data.hub = identity;
    socket.data.authRevocation = revocationAtStart;
    return true;
  }

  /**
   * Registro del socket ya autenticado por el middleware (Fase 4 · P4):
   *  - lee la identidad de `client.data.hub` (los handlers `hub:*` también);
   *  - una reconexión con el mismo `hubId` desconecta el socket anterior
   *    (last-wins), en vez de dejarlo vivo y fuera del mapa;
   *  - si el hub se revocó entre el middleware y este punto, no se registra.
   */
  handleConnection(client: HubSocket): void {
    const identity = client.data.hub;
    if (!identity) {
      // El middleware rechaza antes del CONNECT: llegar acá sería un bug.
      this.logger.warn(`Socket sin identidad de hub en /hub: ${client.id}`);
      client.disconnect(true);
      return;
    }

    if (this.revocationCount(identity.hubId) !== client.data.authRevocation) {
      this.logger.warn(
        `Hub ${identity.hubId} revocado antes de registrar el socket ${client.id}: se desconecta`,
      );
      client.disconnect(true);
      return;
    }

    if (client.disconnected) {
      // El cliente se fue entre el middleware y el registro.
      return;
    }

    const previous = this.connectedHubs.get(identity.hubId);
    this.connectedHubs.set(identity.hubId, {
      socket: client,
      lastSeen: new Date(),
      organizationId: identity.organizationId,
      type: identity.type,
    });

    if (previous && previous.socket.id !== client.id) {
      this.logger.warn(
        `Reconexión del hub ${identity.hubId}: se desconecta el socket anterior ${previous.socket.id} (nuevo: ${client.id})`,
      );
      previous.socket.disconnect(true);
    }

    this.logger.log(
      `✅ Hub conectado: ${identity.hubId} (socket: ${client.id}, tipo: ${identity.type}, org: ${identity.organizationId ?? 'sin asignar'})`,
    );

    client.emit('hub:connected', {
      hubId: identity.hubId,
      serverTime: new Date(),
      message: 'Conectado exitosamente al backend',
    });
  }

  /**
   * Desconexión de un socket. Solo borra la entrada si sigue siendo la de
   * ESTE socket: tras una reconexión (last-wins) el socket anterior se
   * desconecta y no debe sacar del mapa al socket nuevo.
   */
  handleDisconnect(client: HubSocket): void {
    const hubId = client.data.hub?.hubId;
    if (!hubId) {
      return;
    }

    const entry = this.connectedHubs.get(hubId);
    if (entry?.socket.id === client.id) {
      this.connectedHubs.delete(hubId);
      this.logger.log(`❌ Hub desconectado: ${hubId}`);
    }
  }

  /** Hub envía número de casa marcado en el teclado (informativo). */
  @SubscribeMessage('hub:keypad')
  handleKeypadInput(
    @ConnectedSocket() client: HubSocket,
    @MessageBody() data: unknown,
  ): { success: boolean; timestamp?: Date } {
    const hub = this.touchRegisteredHub(client, 'hub:keypad');
    if (!hub) {
      return { success: false };
    }

    // Fase 4 · P7.L: sin la casa marcada (con la hora, delata a quién se
    // visita); solo si llegó una.
    const hasHouseNumber = readStringField(data, 'houseNumber') !== undefined;
    this.logger.log(
      `🔢 Keypad input de ${hub.hubId} (${hasHouseNumber ? 'con casa' : 'sin casa'})`,
    );

    return { success: true, timestamp: new Date() };
  }

  /** Hub reporta cambio de estado FSM. */
  @SubscribeMessage('hub:stateChanged')
  handleStateChange(
    @ConnectedSocket() client: HubSocket,
    @MessageBody() data: unknown,
  ): { success: boolean } {
    const hub = this.touchRegisteredHub(client, 'hub:stateChanged');
    if (!hub) {
      return { success: false };
    }

    const state = readStringField(data, 'state') ?? 'desconocido';
    this.logger.log(`🔄 Hub ${hub.hubId} cambió de estado: ${state}`);

    return { success: true };
  }

  /** Hub reporta un error o evento crítico. */
  @SubscribeMessage('hub:error')
  handleError(
    @ConnectedSocket() client: HubSocket,
    @MessageBody() data: unknown,
  ): { success: boolean } {
    const hub = this.touchRegisteredHub(client, 'hub:error');
    if (!hub) {
      return { success: false };
    }

    const error = readStringField(data, 'error') ?? 'sin detalle';
    this.logger.error(`❌ Error en Hub ${hub.hubId}: ${error}`);

    return { success: true };
  }

  /**
   * Hub reporta heartbeat (cada 30 segundos). Fase 4 · P6.R: además renueva
   * su credencial en el caché (`touch`), así un hub conectado sigue
   * autenticando sus llamadas HTTP sin bcrypt mientras su socket viva (hasta
   * la edad máxima de 24 h). Solo un socket registrado llega acá.
   */
  @SubscribeMessage('hub:heartbeat')
  handleHeartbeat(
    @ConnectedSocket() client: HubSocket,
    @MessageBody() data: unknown,
  ): { success: boolean; serverTime?: Date } {
    const hub = this.touchRegisteredHub(client, 'hub:heartbeat');
    if (!hub) {
      return { success: false };
    }

    this.credentialCache.touch(hub.hubId);

    const uptime = readNumberField(data, 'uptime');
    this.logger.debug(
      `💓 Heartbeat de ${hub.hubId}${uptime === undefined ? '' : ` (uptime: ${Math.floor(uptime / 1000)}s)`}`,
    );

    return { success: true, serverTime: new Date() };
  }

  /** Hubs conectados. */
  getConnectedHubs(): Array<{ hubId: string; type: HubType; lastSeen: Date }> {
    return Array.from(this.connectedHubs.entries()).map(([hubId, data]) => ({
      hubId,
      type: data.type,
      lastSeen: data.lastSeen,
    }));
  }

  /** ¿El hub está conectado? */
  isHubConnected(hubId: string): boolean {
    return this.connectedHubs.has(hubId);
  }

  /*
   * Fase 4 · P4: no hay emisores genéricos (`sendToHub`, `sendToOrganization`,
   * `broadcastToAllHubs`). Los únicos eventos que salen del backend hacia los
   * dispositivos tienen su método dedicado con su propio enrutamiento:
   * `sendDoorOpen` y `sendVisitorResponse`.
   */

  /**
   * Fase 4 · P4 (D7): orden de apertura SOLO a hubs `physical-hub`, nunca a
   * un `web-kiosk` (que no tiene relés: si la recibiera, el portón no se
   * abriría y el kiosko quedaría como "abierto").
   *  1. Al hub de la sesión, si es físico, está conectado y es del mismo
   *     condominio.
   *  2. Si no, a todos los hubs físicos conectados del condominio.
   * Sin condominio, o sin hubs físicos conectados: no-op con `warn`.
   *
   * @returns cantidad de hubs físicos que recibieron la orden.
   */
  sendDoorOpen(target: HubRoutingTarget, command: DoorOpenCommand): number {
    const { organizationId } = target;
    if (!organizationId) {
      this.logger.warn(
        `${DOOR_OPEN_EVENT} sin condominio: no se envía a ningún hub (hubId=${target.hubId ?? 'n/a'})`,
      );
      return 0;
    }

    const own = target.hubId ? this.connectedHubs.get(target.hubId) : undefined;
    if (
      own &&
      own.type === HubType.PHYSICAL_HUB &&
      own.organizationId === organizationId
    ) {
      own.socket.emit(DOOR_OPEN_EVENT, command);
      this.logger.log(
        `📤 ${DOOR_OPEN_EVENT} (${command.type}) al hub físico de la sesión ${target.hubId}`,
      );
      return 1;
    }

    let sentCount = 0;
    for (const [hubId, info] of this.connectedHubs.entries()) {
      if (
        info.type === HubType.PHYSICAL_HUB &&
        info.organizationId === organizationId
      ) {
        info.socket.emit(DOOR_OPEN_EVENT, command);
        sentCount += 1;
        this.logger.log(
          `📤 ${DOOR_OPEN_EVENT} (${command.type}) al hub físico ${hubId} (org: ${organizationId})`,
        );
      }
    }

    if (sentCount === 0) {
      this.logger.warn(
        `${DOOR_OPEN_EVENT} no entregado: no hay hubs físicos conectados del condominio ${organizationId}`,
      );
    }

    return sentCount;
  }

  /**
   * Fase 4 · P4 (D7): `visitor:response:<sessionId>` SOLO al socket dueño de
   * la sesión (`session.hubId`), sin caer al condominio: esa caída filtraría
   * la respuesta a otros hubs o kioskos. Si el dueño no está conectado:
   * no-op con `warn` (el kiosko se respalda con polling de `/status`).
   *
   * @returns `true` si se entregó.
   */
  sendVisitorResponse(
    session: VisitorResponseTarget,
    payload: Omit<VisitorResponsePayload, 'sessionId'>,
  ): boolean {
    const event = `${VISITOR_RESPONSE_EVENT_PREFIX}${session.sessionId}`;

    if (!session.hubId) {
      this.logger.warn(
        `${event} no entregado: la sesión no tiene un hub dueño`,
      );
      return false;
    }

    const owner = this.connectedHubs.get(session.hubId);
    if (!owner) {
      this.logger.warn(
        `${event} no entregado: el hub dueño ${session.hubId} no está conectado`,
      );
      return false;
    }

    if (owner.organizationId !== session.organizationId) {
      this.logger.warn(
        `${event} no entregado: el hub ${session.hubId} no pertenece al condominio de la sesión`,
      );
      return false;
    }

    const message: VisitorResponsePayload = {
      ...payload,
      sessionId: session.sessionId,
    };
    owner.socket.emit(event, message);
    this.logger.debug(`📤 Enviado ${event} al hub ${session.hubId}`);
    return true;
  }

  /**
   * Corta el socket conectado de un hub (Fase 4 · P4): lo usa `HubsService`
   * al rotar el secret, desactivar el hub o cambiar su tipo o condominio,
   * para que un socket autenticado con la identidad vieja no siga recibiendo
   * eventos. También invalida un handshake en curso del mismo hub.
   *
   * @returns `true` si había un socket conectado.
   */
  disconnectHub(hubId: string, reason: string): boolean {
    this.revocations.set(hubId, this.revocationCount(hubId) + 1);
    // Fase 4 · P4.B (cyber N1): la credencial verificada deja de valer (rotar
    // secret, desactivar, cambiar tipo o condominio pasan por acá).
    this.credentialCache.invalidate(hubId);

    const entry = this.connectedHubs.get(hubId);
    if (!entry) {
      return false;
    }

    this.connectedHubs.delete(hubId);
    entry.socket.disconnect(true);
    this.logger.warn(`Hub ${hubId} desconectado por el servidor: ${reason}`);
    return true;
  }

  private revocationCount(hubId: string): number {
    return this.revocations.get(hubId) ?? 0;
  }

  /**
   * Identidad del handshake de un socket registrado (y actualiza su
   * `lastSeen`). Un socket sin identidad, o que ya no es el registrado para
   * su `hubId` (p. ej. reemplazado por una reconexión), se ignora con `warn`.
   */
  private touchRegisteredHub(
    client: HubSocket,
    event: string,
  ): HubSocketIdentity | null {
    const identity = client.data.hub;
    if (!identity) {
      this.logger.warn(
        `${event} desde un socket no registrado (${client.id}): se ignora`,
      );
      return null;
    }

    const entry = this.connectedHubs.get(identity.hubId);
    if (entry?.socket.id !== client.id) {
      this.logger.warn(
        `${event} desde un socket que ya no es el registrado para ${identity.hubId} (${client.id}): se ignora`,
      );
      return null;
    }

    entry.lastSeen = new Date();
    return identity;
  }
}
