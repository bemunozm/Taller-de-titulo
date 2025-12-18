import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan } from 'typeorm';
import { NotificationsGateway } from './notifications.gateway';
import { 
  Notification, 
  NotificationType, 
  NotificationPriority 
} from './entities/notification.entity';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { MarkAsReadDto } from './dto/mark-as-read.dto';
import { UsersService } from '../users/users.service';

/**
 * Payload para envío de notificaciones en tiempo real (WebSocket)
 */
export interface NotificationPayload {
  title: string;
  message: string;
  type: NotificationType;
  priority?: NotificationPriority;
  data?: any;
  timestamp?: Date;
  requiresAction?: boolean;
}

/**
 * Opciones para crear notificaciones
 */
export interface CreateNotificationOptions {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  data?: any;
  requiresAction?: boolean;
  expiresAt?: Date;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly notificationsGateway: NotificationsGateway,
    private readonly usersService: UsersService,
  ) {}

  /**
   * ==================== CRUD DE NOTIFICACIONES ====================
   */

  /**
   * Crear y enviar una notificación (persistente + tiempo real)
   */
  async create(options: CreateNotificationOptions): Promise<Notification> {
    this.logger.log(`Creating notification for user ${options.recipientId}: ${options.title}`);

    // 1. Guardar en base de datos (PERSISTENCIA)
    const notification = this.notificationRepository.create({
      recipientId: options.recipientId,
      type: options.type,
      title: options.title,
      message: options.message,
      priority: options.priority || NotificationPriority.NORMAL,
      data: options.data || null,
      requiresAction: options.requiresAction || false,
      expiresAt: options.expiresAt || null,
      read: false,
    });

    const savedNotification = await this.notificationRepository.save(notification);

    // 2. Enviar por WebSocket si el usuario está conectado (TIEMPO REAL)
    const payload: NotificationPayload = {
      title: options.title,
      message: options.message,
      type: options.type,
      priority: options.priority,
      data: {
        ...options.data,
        notificationId: savedNotification.id,
      },
      timestamp: savedNotification.createdAt,
      requiresAction: options.requiresAction,
    };

    this.notificationsGateway.sendToUser(
      options.recipientId,
      'notification',
      payload,
    );

    return savedNotification;
  }

  /**
   * Obtener notificaciones de un usuario con filtros
   */
  async findAll(dto: GetNotificationsDto, userId?: string): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const queryBuilder = this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.recipientId = :recipientId', {
        recipientId: dto.recipientId || userId,
      })
      .orderBy('notification.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    // Filtros opcionales
    if (dto.type) {
      queryBuilder.andWhere('notification.type = :type', { type: dto.type });
    }

    if (dto.read !== undefined) {
      queryBuilder.andWhere('notification.read = :read', { read: dto.read });
    }

    // Excluir notificaciones expiradas
    queryBuilder.andWhere(
      '(notification.expiresAt IS NULL OR notification.expiresAt > :now)',
      { now: new Date() },
    );

    // NUEVO: Excluir notificaciones que requieren acción pero ya fueron procesadas
    queryBuilder.andWhere(
      '(notification.requiresAction = false OR notification.actionTaken = false OR notification.actionTaken IS NULL)',
    );

    const [notifications, total] = await queryBuilder.getManyAndCount();

    // Contar no leídas (excluyendo las procesadas)
    const unreadCount = await this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.recipientId = :recipientId', {
        recipientId: dto.recipientId || userId,
      })
      .andWhere('notification.read = false')
      .andWhere(
        '(notification.expiresAt IS NULL OR notification.expiresAt > :now)',
        { now: new Date() },
      )
      .andWhere(
        '(notification.requiresAction = false OR notification.actionTaken = false OR notification.actionTaken IS NULL)',
      )
      .getCount();

    return { notifications, total, unreadCount };
  }

  /**
   * Marcar notificaciones como leídas
   */
  async markAsRead(dto: MarkAsReadDto, userId?: string): Promise<void> {
    const now = new Date();

    await this.notificationRepository.update(
      {
        id: In(dto.notificationIds),
        recipientId: userId, // Seguridad: solo puede marcar sus propias notificaciones
      },
      {
        read: true,
        readAt: now,
      },
    );

    this.logger.log(`Marked ${dto.notificationIds.length} notifications as read for user ${userId}`);
  }

  /**
   * Marcar todas las notificaciones de un usuario como leídas
   */
  async markAllAsRead(userId: string): Promise<void> {
    const now = new Date();

    const result = await this.notificationRepository.update(
      {
        recipientId: userId,
        read: false,
      },
      {
        read: true,
        readAt: now,
      },
    );

    this.logger.log(`Marked all notifications as read for user ${userId} (${result.affected} affected)`);
  }

  /**
   * Eliminar notificaciones antiguas (limpieza)
   */
  async deleteOld(userId: string, daysOld: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.notificationRepository.delete({
      recipientId: userId,
      createdAt: LessThan(cutoffDate),
      read: true,
    });

    this.logger.log(`Deleted ${result.affected} old notifications for user ${userId}`);
  }

  /**
   * Eliminar todas las notificaciones del usuario (soft delete)
   */
  async deleteAll(userId: string): Promise<void> {
    const result = await this.notificationRepository.softDelete({
      recipientId: userId,
    });

    this.logger.log(`Soft deleted all notifications for user ${userId} (${result.affected} affected)`);
  }

  /**
   * ==================== MÉTODOS DE NEGOCIO ====================
   */

  /**
   * Enviar notificación de entrada de visita al residente
   */
  async notifyVisitCheckIn(hostId: string, visitData: any): Promise<void> {
    await this.create({
      recipientId: hostId,
      type: NotificationType.VISIT_CHECK_IN,
      title: 'Visita Ingresada',
      message: `${visitData.visitorName} ha ingresado al condominio`,
      priority: NotificationPriority.HIGH,
      data: {
        visitId: visitData.id,
        visitorName: visitData.visitorName,
        entryTime: visitData.entryTime,
        type: visitData.type,
      },
    });
  }

  /**
   * Enviar notificación de salida de visita al residente
   */
  async notifyVisitCheckOut(hostId: string, visitData: any): Promise<void> {
    await this.create({
      recipientId: hostId,
      type: NotificationType.VISIT_CHECK_OUT,
      title: 'Visita Finalizada',
      message: `${visitData.visitorName} ha salido del condominio`,
      priority: NotificationPriority.NORMAL,
      data: {
        visitId: visitData.id,
        visitorName: visitData.visitorName,
        exitTime: visitData.exitTime,
        duration: this.calculateDuration(visitData.entryTime, visitData.exitTime),
      },
    });
  }

  /**
   * Notificar intento de acceso denegado
   */
  async notifyAccessDenied(userId: string, plateData: any): Promise<void> {
    await this.create({
      recipientId: userId,
      type: NotificationType.ACCESS_DENIED,
      title: 'Acceso Denegado',
      message: `Intento de acceso denegado - Patente: ${plateData.plate}`,
      priority: NotificationPriority.HIGH,
      data: {
        plate: plateData.plate,
        reason: plateData.reason,
        cameraId: plateData.cameraId,
      },
    });
  }

  /**
   * Notificar visita próxima a expirar (recordatorio)
   */
  async notifyVisitExpiringSoon(hostId: string, visitData: any): Promise<void> {
    await this.create({
      recipientId: hostId,
      type: NotificationType.VISIT_EXPIRING_SOON,
      title: 'Visita Próxima a Expirar',
      message: `La visita de ${visitData.visitorName} expira pronto`,
      priority: NotificationPriority.NORMAL,
      data: {
        visitId: visitData.id,
        visitorName: visitData.visitorName,
        validUntil: visitData.validUntil,
      },
    });
  }

  /**
   * Notificar llegada de visitante (Conserje Digital)
   * Con acción requerida: aprobar/rechazar
   */
  async notifyVisitorArrival(
    residentId: string,
    sessionId: string,
    visitorData: {
      name: string;
      rut?: string;
      phone?: string;
      plate?: string;
      reason?: string;
    },
  ): Promise<Notification> {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15); // Expira en 15 minutos

    return await this.create({
      recipientId: residentId,
      type: NotificationType.VISITOR_ARRIVAL,
      title: 'Visitante en Portería',
      message: `${visitorData.name || 'Un visitante'} está esperando en la entrada${visitorData.plate ? ` (Patente: ${visitorData.plate})` : ''}`,
      priority: NotificationPriority.URGENT,
      requiresAction: true,
      expiresAt,
      data: {
        sessionId,
        expiresAt: expiresAt.toISOString(), // Incluir en data para el frontend
        visitor: {
          name: visitorData.name,
          rut: visitorData.rut,
          phone: visitorData.phone,
          plate: visitorData.plate,
          reason: visitorData.reason,
        },
      },
    });
  }

  /**
   * Marcar notificación de visitante como acción tomada
   */
  async markVisitorActionTaken(
    notificationId: string,
    approved: boolean,
    reason?: string,
  ): Promise<void> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }

    notification.actionTaken = true;
    notification.actionData = {
      approved,
      timestamp: new Date(),
      ...(reason && { reason }), // Incluir razón si se proporciona
    };

    await this.notificationRepository.save(notification);
  }

  /**
   * Notificar a todos los usuarios online (broadcast)
   */
  async broadcastAlert(alertData: {
    title: string;
    message: string;
    priority?: NotificationPriority;
  }): Promise<void> {
    const payload: NotificationPayload = {
      ...alertData,
      type: NotificationType.SYSTEM_ALERT,
      priority: alertData.priority || NotificationPriority.HIGH,
      timestamp: new Date(),
    };

    this.notificationsGateway.broadcast('notification', payload);
  }

  /**
   * ==================== UTILIDADES ====================
   */

  /**
   * Calcular duración entre dos fechas en formato legible
   */
  private calculateDuration(start: Date, end: Date): string {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Verificar si un usuario está conectado
   */
  isUserOnline(userId: string): boolean {
    return this.notificationsGateway.isUserConnected(userId);
  }

  /**
   * Obtener usuarios conectados
   */
  getOnlineUsers(): string[] {
    return this.notificationsGateway.getConnectedUsers();
  }

  /**
   * Notificar a todos los usuarios con un rol específico
   */
  async notifyByRole(
    roleName: string,
    type: NotificationType,
    title: string,
    message: string,
    options?: {
      priority?: NotificationPriority;
      data?: any;
      requiresAction?: boolean;
    },
  ): Promise<Notification[]> {
    const users = await this.usersService.findByRole(roleName);
    
    this.logger.log(`Notificando a ${users.length} usuarios con rol ${roleName}`);

    const notifications: Notification[] = [];
    
    for (const user of users) {
      const notification = await this.create({
        recipientId: user.id,
        type,
        title,
        message,
        priority: options?.priority || NotificationPriority.NORMAL,
        data: options?.data,
        requiresAction: options?.requiresAction,
      });
      notifications.push(notification);
    }
    
    return notifications;
  }

  /**
   * Notificar a múltiples usuarios con el mismo mensaje
   */
  async notifyMultiple(
    userIds: string[],
    type: NotificationType,
    title: string,
    message: string,
    options?: {
      priority?: NotificationPriority;
      data?: any;
      requiresAction?: boolean;
    },
  ): Promise<void> {
    this.logger.log(`Notificando a ${userIds.length} usuarios`);

    for (const userId of userIds) {
      await this.create({
        recipientId: userId,
        type,
        title,
        message,
        priority: options?.priority || NotificationPriority.NORMAL,
        data: options?.data,
        requiresAction: options?.requiresAction,
      });
    }
  }
}
