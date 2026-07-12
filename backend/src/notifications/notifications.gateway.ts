import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';

@WebSocketGateway({
  cors: {
    origin: '*', // En producción, especifica tu dominio frontend
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('NotificationsGateway');
  private userSockets: Map<string, string[]> = new Map(); // userId -> socketIds[]

  constructor(private readonly betterAuthService: BetterAuthService) {}

  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado: ${client.id}`);
    // NOTA: no se resuelve la sesión acá. `handleConnection` es async por
    // naturaleza (I/O contra better-auth) pero socket.io NO espera a que
    // resuelva antes de entregarle 'connect' al cliente ni antes de
    // despachar sus siguientes mensajes — un cliente legítimo que emite
    // 'register' inmediatamente después de conectar ganaría la carrera
    // contra una validación cacheada acá. La sesión se valida de forma
    // síncrona-al-mensaje dentro de `handleRegister`, que es el único punto
    // donde realmente importa (ahí se decide el mapeo socket -> userId).
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);

    // Remover el socket de todos los usuarios
    for (const [userId, socketIds] of this.userSockets.entries()) {
      const index = socketIds.indexOf(client.id);
      if (index > -1) {
        socketIds.splice(index, 1);
        if (socketIds.length === 0) {
          this.userSockets.delete(userId);
        }
        this.logger.log(`Socket ${client.id} removido del usuario ${userId}`);
      }
    }
  }

  /** Resuelve la sesión de better-auth desde la cookie httpOnly del handshake. */
  private async resolveSessionUserId(client: Socket): Promise<string | null> {
    try {
      const session = await this.betterAuthService.api.getSession({
        headers: fromNodeHeaders(client.handshake.headers),
      });
      return session?.user?.id ?? null;
    } catch (error) {
      this.logger.debug(`No se pudo resolver sesión better-auth en handshake: ${error}`);
      return null;
    }
  }

  @SubscribeMessage('register')
  async handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const { userId } = data;
    // Fuente de verdad: la sesión better-auth resuelta desde la cookie del
    // handshake — NUNCA el `userId` que manda el cliente en el body. Se
    // valida acá (no en `handleConnection`) para evitar la carrera descrita
    // arriba y porque este es el único punto donde el resultado importa.
    const sessionUserId = await this.resolveSessionUserId(client);

    if (!sessionUserId) {
      this.logger.warn(
        `Socket ${client.id} intentó registrarse como ${userId} sin sesión válida — rechazado`,
      );
      return { success: false, message: 'No autorizado: sesión inválida o inexistente' };
    }

    if (sessionUserId !== userId) {
      this.logger.warn(
        `Socket ${client.id} (sesión ${sessionUserId}) intentó registrarse como ${userId} — rechazado`,
      );
      return { success: false, message: 'No autorizado: el userId no coincide con la sesión' };
    }

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, []);
    }

    const sockets = this.userSockets.get(userId)!;
    if (!sockets.includes(client.id)) {
      sockets.push(client.id);
      this.logger.log(`Usuario ${userId} registrado con socket ${client.id}`);
    }

    return { success: true, message: 'Registrado exitosamente' };
  }

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    if (data && data.room) {
      client.join(data.room);
      this.logger.log(`Cliente ${client.id} se unió a la sala ${data.room}`);
      return { success: true };
    }
  }

  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    if (data && data.room) {
      client.leave(data.room);
      this.logger.log(`Cliente ${client.id} abandonó la sala ${data.room}`);
      return { success: true };
    }
  }

  // Enviar a una sala específica
  sendToRoom(room: string, event: string, data: any) {
    this.server.to(room).emit(event, data);
    this.logger.log(`📡 Evento "${event}" enviado a sala ${room}`);
  }

  // Enviar a todos excepto a una sala
  broadcastExceptRoom(room: string, event: string, data: any) {
    this.server.except(room).emit(event, data);
    this.logger.log(`📡 Evento "${event}" enviado a todos excepto a sala ${room}`);
  }

  // Enviar notificación a un usuario específico
  sendToUser(userId: string, event: string, data: any) {
    const socketIds = this.userSockets.get(userId);
    if (socketIds && socketIds.length > 0) {
      socketIds.forEach(socketId => {
        this.server.to(socketId).emit(event, data);
      });
      this.logger.log(`Notificación "${event}" enviada a usuario ${userId}`);
      return true;
    }
    this.logger.warn(`Usuario ${userId} no está conectado`);
    return false;
  }

  // Enviar notificación a múltiples usuarios
  sendToUsers(userIds: string[], event: string, data: any) {
    let sent = 0;
    userIds.forEach(userId => {
      if (this.sendToUser(userId, event, data)) {
        sent++;
      }
    });
    this.logger.log(`Notificación "${event}" enviada a ${sent}/${userIds.length} usuarios`);
  }

  // Broadcast a todos los clientes conectados
  broadcast(event: string, data: any) {
    const clientsCount = this.server.sockets.sockets.size;
    this.logger.log(`📡 Broadcasting evento "${event}" a ${clientsCount} clientes conectados`);
    this.logger.debug(`Payload: ${JSON.stringify(data)}`);
    
    this.server.emit(event, data);
    
    this.logger.log(`✅ Broadcast completado`);
  }

  // Enviar evento a un socket específico por su ID
  sendToSocket(socketId: string, event: string, data: any) {
    const socket = this.server.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      socket.emit(event, data);
      this.logger.log(`📡 Evento "${event}" enviado a socket ${socketId}`);
      return true;
    }
    this.logger.warn(`⚠️ Socket ${socketId} no encontrado o no conectado`);
    return false;
  }

  // Obtener usuarios conectados
  getConnectedUsers(): string[] {
    return Array.from(this.userSockets.keys());
  }

  // Verificar si un usuario está conectado
  isUserConnected(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return sockets !== undefined && sockets.length > 0;
  }
}
