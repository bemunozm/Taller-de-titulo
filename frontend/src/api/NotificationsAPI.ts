import api from '@/lib/axios';
import type { NotificationType } from '@/types/index';

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  read: boolean;
  readAt: string | null;
  data: any;
  recipientId: string;
  createdAt: string;
  expiresAt: string | null;
  requiresAction: boolean;
  actionTaken: boolean;
  actionData: any;
}

export interface GetNotificationsResponse {
  notifications: NotificationResponse[];
  total: number;
  unreadCount: number;
}

export interface GetNotificationsParams {
  type?: NotificationType;
  read?: boolean;
  page?: number;
  limit?: number;
}

export class NotificationsAPI {
  /**
   * Obtener notificaciones del usuario autenticado
   */
  static async getNotifications(params?: GetNotificationsParams): Promise<GetNotificationsResponse> {
    const queryParams = new URLSearchParams();
    
    if (params?.type) queryParams.append('type', params.type);
    if (params?.read !== undefined) queryParams.append('read', String(params.read));
    if (params?.page) queryParams.append('page', String(params.page));
    if (params?.limit) queryParams.append('limit', String(params.limit));

    const { data } = await api.get<GetNotificationsResponse>(
      `/notifications?${queryParams.toString()}`
    );
    return data;
  }

  /**
   * Marcar notificaciones como leídas
   */
  static async markAsRead(notificationIds: string[]): Promise<void> {
    await api.post('/notifications/mark-as-read', { notificationIds });
  }

  /**
   * Marcar todas las notificaciones como leídas
   */
  static async markAllAsRead(): Promise<void> {
    await api.post('/notifications/mark-all-as-read');
  }

  /**
   * Eliminar todas las notificaciones (soft delete)
   */
  static async deleteAll(): Promise<void> {
    await api.post('/notifications/delete-all');
  }

  /**
   * Eliminar notificaciones antiguas
   */
  static async deleteOld(daysOld: number = 30): Promise<void> {
    await api.post('/notifications/delete-old', { daysOld });
  }

  /**
   * Enviar notificación de prueba
   */
  static async sendTestNotification(options?: {
    type?: NotificationType;
    requiresAction?: boolean;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  }): Promise<void> {
    await api.post('/notifications/test', options);
  }
}

// Helper functions para usar directamente
export const getNotifications = (params?: GetNotificationsParams) => 
  NotificationsAPI.getNotifications(params);

export const markAsRead = (notificationIds: string[]) => 
  NotificationsAPI.markAsRead(notificationIds);

export const markAllAsRead = () => 
  NotificationsAPI.markAllAsRead();
