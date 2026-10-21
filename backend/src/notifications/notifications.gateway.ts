import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { IncomingHttpHeaders } from 'http';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { BetterAuthSessionResolver } from '../auth/better-auth-session.resolver';
import {
  addSessionEndedListener,
  type SessionEndReason,
  type SessionEndedEvent,
} from '../auth/session-ended-events';
import { getUserPermissionNames } from '../auth/utils/permissions.util';
import { CONDOMINIUM_VIEW_ALL_PERMISSION } from '../common/constants/default-permissions.constant';
import { resolveTenantContext } from '../common/tenant/tenant-context.util';

/** Error del middleware de `/` ante un handshake sin sesión válida (genérico). */
export const REALTIME_UNAUTHORIZED_ERROR = 'unauthorized';

/** Evento que recibe el socket justo antes de que el servidor lo corte por fin de sesión. */
export const SESSION_ENDED_EVENT = 'session:ended';

/** Cada cuánto se revalida la sesión de un socket conectado (como máximo). */
export const SOCKET_SESSION_REVALIDATION_INTERVAL_MS = 5 * 60_000;

/** Reintento de una revalidación que falló por un error (p. ej. la BD). */
export const SOCKET_SESSION_REVALIDATION_RETRY_MS = 30_000;

/** Cuánto se recuerda una sesión terminada (cierra la carrera con el handshake). */
const ENDED_SESSION_MEMORY_MS = 5 * 60_000;

/** Tope de sesiones terminadas recordadas. */
const ENDED_SESSION_MEMORY_MAX = 10_000;

/** Permiso de lectura de detecciones/anomalías (junto con `condominium.view-all`). */
const SECURITY_FEED_PERMISSION = 'detections.read';

/**
 * Identidad de un socket del namespace `/`, resuelta por el SERVIDOR desde la
 * cookie de sesión de better-auth del handshake (Fase 4 · P6.R, D13). Es la
 * única fuente de verdad de las salas del socket; el cliente no elige nada.
 */
export interface RealtimeUserIdentity {
  userId: string;
  /** Condominio (membresía más antigua); `null` para el super-admin o sin membresía. */
  organizationId: string | null;
  /** Permisos efectivos (sin duplicados). Array, no Set: `socket.data` se serializa entre nodos. */
  permissionNames: string[];
  isSuperAdmin: boolean;
  /** `session.id` de better-auth (no el token). */
  sessionId: string;
  sessionExpiresAt: Date;
}

/** `socket.data` de un socket del namespace `/`. */
export interface RealtimeSocketData {
  user?: RealtimeUserIdentity;
}

export type RealtimeSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  RealtimeSocketData
>;

export type RealtimeServer = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  RealtimeSocketData
>;

/** Payload de `session:ended`. */
export interface SessionEndedPayload {
  reason: SessionEndReason;
}

/** Sala personal de un usuario (todas sus pestañas y dispositivos). */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Sala del feed de seguridad (anomalías) de un condominio. */
export function organizationSecurityRoom(organizationId: string): string {
  return `org:${organizationId}:security`;
}

/** Sala de una sesión de better-auth: permite cortar sus sockets al terminar. */
export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

/**
 * Sala de seguridad que le corresponde a la identidad, o `null`. Solo quien
 * ve el condominio completo y lee detecciones (`detections.read` +
 * `condominium.view-all`: Conserje, Administrador) y TIENE condominio.
 *
 * El super-admin no se une a ninguna: no pertenece a un condominio y un feed
 * en vivo de todos los condominios no tiene consumidor (la plataforma consulta
 * `GET /anomalies`). Un residente (solo `detections.read`) tampoco.
 */
export function securityRoomFor(
  identity: Pick<
    RealtimeUserIdentity,
    'organizationId' | 'isSuperAdmin' | 'permissionNames'
  >,
): string | null {
  if (identity.isSuperAdmin || !identity.organizationId) {
    return null;
  }
  const permissions = new Set(identity.permissionNames);
  if (
    !permissions.has(SECURITY_FEED_PERMISSION) ||
    !permissions.has(CONDOMINIUM_VIEW_ALL_PERMISSION)
  ) {
    return null;
  }
  return organizationSecurityRoom(identity.organizationId);
}

/** Todas las salas asignadas por el servidor a la identidad. */
export function roomsFor(identity: RealtimeUserIdentity): string[] {
  const rooms = [userRoom(identity.userId), sessionRoom(identity.sessionId)];
  const securityRoom = securityRoomFor(identity);
  if (securityRoom) {
    rooms.push(securityRoom);
  }
  return rooms;
}

/**
 * Gateway del namespace `/` (app de residentes, conserjes y administradores).
 *
 * Fase 4 · P6.R (D13), antes: CORS `*`, sockets anónimos conectados,
 * `join_room` libre (cualquiera entraba a `conserje_room` y recibía las fotos
 * de las anomalías de todos los condominios), `register { userId }` y un Map
 * `userSockets` en memoria, y `broadcast` global. Ahora:
 *  - un middleware autentica el handshake ANTES del CONNECT con la cookie de
 *    better-auth (`BetterAuthSessionResolver`, el mismo que `AuthGuard`); sin
 *    sesión el cliente recibe `connect_error` con `unauthorized`. Al validar
 *    antes del CONNECT ya no existe la carrera que obligaba a revalidar la
 *    sesión dentro de `register`: no hay mensajes del cliente que procesar
 *    antes de conocer su identidad;
 *  - las salas las asigna el servidor (`user:<id>`, `session:<id>` y, según
 *    permisos, `org:<id>:security`); no hay handlers de mensajes del cliente;
 *  - el socket se corta cuando su sesión vence (timer + revalidación cada
 *    ≤5 min) o termina (logout o revocación: hook `session.delete.after` de
 *    better-auth, ver session-ended-events.ts). Antes de cortarlo se le envía
 *    `session:ended { reason }`.
 */
@WebSocketGateway()
export class NotificationsGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: RealtimeServer;

  private readonly logger = new Logger(NotificationsGateway.name);
  /** `socket.id` -> timer de su próxima revalidación. */
  private readonly revalidationTimers = new Map<string, NodeJS.Timeout>();
  /** Sesiones terminadas hace poco (`sessionId` -> motivo y momento). */
  private readonly endedSessions = new Map<
    string,
    { reason: SessionEndReason; endedAt: number }
  >();
  private removeSessionEndedListener: (() => void) | null = null;

  constructor(
    private readonly sessionResolver: BetterAuthSessionResolver,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.removeSessionEndedListener = addSessionEndedListener((event) => {
      this.handleSessionEnded(event);
    });
  }

  onModuleDestroy(): void {
    this.removeSessionEndedListener?.();
    this.removeSessionEndedListener = null;
    for (const timer of this.revalidationTimers.values()) {
      clearTimeout(timer);
    }
    this.revalidationTimers.clear();
  }

  /** Autenticación del handshake ANTES del CONNECT (mismo patrón que `/hub`). */
  afterInit(server: RealtimeServer): void {
    server.use((socket, next) => {
      void this.authenticateHandshake(socket).then(
        (identity) => {
          if (!identity) {
            next(new Error(REALTIME_UNAUTHORIZED_ERROR));
            return;
          }
          socket.data.user = identity;
          next();
        },
        (error: unknown) => {
          this.logger.error(
            `Error autenticando el handshake del socket ${socket.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          next(new Error(REALTIME_UNAUTHORIZED_ERROR));
        },
      );
    });
  }

  /** Une el socket (ya autenticado) a sus salas y programa la revalidación. */
  handleConnection(client: RealtimeSocket): void {
    const identity = client.data.user;
    if (!identity) {
      // El middleware rechaza antes del CONNECT: llegar acá sería un bug.
      this.logger.warn(`Socket sin identidad en /: ${client.id}`);
      client.disconnect(true);
      return;
    }
    if (client.disconnected) {
      return;
    }
    const ended = this.endedSessions.get(identity.sessionId);
    if (ended) {
      // La sesión terminó mientras se autenticaba el handshake.
      this.endSocket(client, ended.reason);
      return;
    }

    void client.join(roomsFor(identity));
    this.scheduleRevalidation(client);
    this.logger.log(
      `Socket ${client.id} conectado (usuario ${identity.userId}${securityRoomFor(identity) ? ', feed de seguridad' : ''})`,
    );
  }

  handleDisconnect(client: RealtimeSocket): void {
    this.clearRevalidation(client.id);
    this.logger.log(`Socket ${client.id} desconectado`);
  }

  /** Evento a todos los sockets de un usuario (sala `user:<id>`). */
  sendToUser(userId: string, event: string, data: unknown): void {
    this.server.to(userRoom(userId)).emit(event, data);
    this.logger.debug(`Evento "${event}" enviado al usuario ${userId}`);
  }

  /**
   * Evento al feed de seguridad de UN condominio (sala
   * `org:<id>:security`). No hay emisión global ni a salas elegidas por el
   * llamador.
   */
  sendToOrganizationSecurity(
    organizationId: string,
    event: string,
    data: unknown,
  ): void {
    this.server.to(organizationSecurityRoom(organizationId)).emit(event, data);
    this.logger.debug(
      `Evento "${event}" enviado al feed de seguridad del condominio ${organizationId}`,
    );
  }

  /**
   * Identidad de una cookie de sesión: sesión vigente (sin extenderla), el
   * `User` activo con roles y permisos, y su condominio por membresía (misma
   * regla que `TenantInterceptor`). `null` si algo falta.
   */
  private async resolveIdentity(
    headers: IncomingHttpHeaders,
    now: Date = new Date(),
  ): Promise<RealtimeUserIdentity | null> {
    const session = await this.sessionResolver.resolveSession(headers, now);
    if (!session) {
      return null;
    }
    const user = await this.sessionResolver.loadSessionUser(session.userId);
    if (!user) {
      return null;
    }
    const tenant = await resolveTenantContext(user, this.dataSource);
    return {
      userId: user.id,
      organizationId: tenant.organizationId,
      isSuperAdmin: tenant.isSuperAdmin,
      permissionNames: [...new Set(getUserPermissionNames(user))],
      sessionId: session.sessionId,
      sessionExpiresAt: session.expiresAt,
    };
  }

  private async authenticateHandshake(
    socket: RealtimeSocket,
  ): Promise<RealtimeUserIdentity | null> {
    const identity = await this.resolveIdentity(socket.handshake.headers);
    if (!identity) {
      this.logger.debug(`Handshake sin sesión válida rechazado: ${socket.id}`);
      return null;
    }
    if (this.endedSessions.has(identity.sessionId)) {
      return null;
    }
    return identity;
  }

  /** Programa la revalidación: cada ≤5 min y, a más tardar, al vencer la sesión. */
  private scheduleRevalidation(
    client: RealtimeSocket,
    delayMs: number = SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
  ): void {
    this.clearRevalidation(client.id);
    const identity = client.data.user;
    if (!identity) {
      return;
    }
    const untilExpiry = identity.sessionExpiresAt.getTime() - Date.now();
    const delay = Math.max(0, Math.min(delayMs, untilExpiry));
    const timer = setTimeout(() => {
      this.revalidationTimers.delete(client.id);
      void this.revalidate(client);
    }, delay);
    timer.unref();
    this.revalidationTimers.set(client.id, timer);
  }

  private clearRevalidation(socketId: string): void {
    const timer = this.revalidationTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.revalidationTimers.delete(socketId);
    }
  }

  /**
   * Vuelve a resolver la identidad con la cookie del handshake:
   *  - sin sesión (vencida, borrada, usuario deshabilitado) o con otra
   *    sesión/usuario: corta el socket;
   *  - vigente: actualiza la expiración (si una request HTTP la extendió) y
   *    las salas (cambio de permisos o de condominio);
   *  - error inesperado: reintenta pronto, salvo que la sesión ya haya
   *    vencido (el socket nunca sobrevive a su expiración conocida).
   */
  private async revalidate(client: RealtimeSocket): Promise<void> {
    const previous = client.data.user;
    if (!previous || client.disconnected) {
      return;
    }
    const now = new Date();
    let identity: RealtimeUserIdentity | null;
    try {
      identity = await this.resolveIdentity(client.handshake.headers, now);
    } catch (error) {
      if (client.disconnected) {
        return;
      }
      if (previous.sessionExpiresAt.getTime() <= Date.now()) {
        this.endSocket(client, 'expired');
        return;
      }
      this.logger.warn(
        `No se pudo revalidar la sesión del socket ${client.id}; se reintenta: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.scheduleRevalidation(client, SOCKET_SESSION_REVALIDATION_RETRY_MS);
      return;
    }
    if (client.disconnected) {
      return;
    }
    if (
      !identity ||
      identity.sessionId !== previous.sessionId ||
      identity.userId !== previous.userId
    ) {
      this.endSocket(
        client,
        previous.sessionExpiresAt.getTime() <= now.getTime()
          ? 'expired'
          : 'revoked',
      );
      return;
    }
    this.applyIdentity(client, previous, identity);
    this.scheduleRevalidation(client);
  }

  /** Reemplaza la identidad del socket y sincroniza sus salas. */
  private applyIdentity(
    client: RealtimeSocket,
    previous: RealtimeUserIdentity,
    next: RealtimeUserIdentity,
  ): void {
    const previousRooms = new Set(roomsFor(previous));
    const nextRooms = roomsFor(next);
    for (const room of previousRooms) {
      if (!nextRooms.includes(room)) {
        void client.leave(room);
      }
    }
    const added = nextRooms.filter((room) => !previousRooms.has(room));
    if (added.length > 0) {
      void client.join(added);
    }
    client.data.user = next;
  }

  /** Fin de una sesión (hook de better-auth): corta todos sus sockets. */
  private handleSessionEnded(event: SessionEndedEvent): void {
    this.rememberEndedSession(event);
    if (!this.server) {
      return;
    }
    const room = sessionRoom(event.sessionId);
    const payload: SessionEndedPayload = { reason: event.reason };
    this.server.to(room).emit(SESSION_ENDED_EVENT, payload);
    this.server.in(room).disconnectSockets(true);
    this.logger.log(
      `Sesión ${event.sessionId} terminada (${event.reason}): se cortan sus sockets`,
    );
  }

  private rememberEndedSession(event: SessionEndedEvent): void {
    const now = Date.now();
    for (const [sessionId, ended] of this.endedSessions) {
      if (now - ended.endedAt <= ENDED_SESSION_MEMORY_MS) {
        break; // Orden de inserción: el resto es más reciente.
      }
      this.endedSessions.delete(sessionId);
    }
    this.endedSessions.delete(event.sessionId);
    this.endedSessions.set(event.sessionId, {
      reason: event.reason,
      endedAt: now,
    });
    while (this.endedSessions.size > ENDED_SESSION_MEMORY_MAX) {
      const oldest = this.endedSessions.keys().next();
      if (oldest.done) {
        break;
      }
      this.endedSessions.delete(oldest.value);
    }
  }

  /** Avisa el motivo y corta el socket (el cliente no se reconecta solo). */
  private endSocket(client: RealtimeSocket, reason: SessionEndReason): void {
    this.clearRevalidation(client.id);
    const payload: SessionEndedPayload = { reason };
    client.emit(SESSION_ENDED_EVENT, payload);
    client.disconnect(true);
    this.logger.log(
      `Socket ${client.id} cortado: sesión ${reason === 'expired' ? 'vencida' : 'terminada'} (${reason})`,
    );
  }
}
