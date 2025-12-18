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

  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado: ${client.id}`);
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

  @SubscribeMessage('register')
  handleRegister(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const { userId } = data;
    
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
