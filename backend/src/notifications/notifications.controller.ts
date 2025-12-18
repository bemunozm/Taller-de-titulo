import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiUnauthorizedResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationsService } from './notifications.service';
import { GetNotificationsDto } from './dto/get-notifications.dto';
import { MarkAsReadDto } from './dto/mark-as-read.dto';

@ApiTags('Gestión de Notificaciones')
@ApiBearerAuth('JWT-auth')
@UseGuards(AuthGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications
   * Obtener notificaciones del usuario autenticado
   * NOTA: No requiere permisos específicos - cualquier usuario autenticado puede ver SUS PROPIAS notificaciones
   */
  @Get()
  @ApiOperation({ 
    summary: 'Obtener notificaciones del usuario', 
    description: 'Retorna las notificaciones del usuario autenticado. Soporta filtros por estado (leído/no leído) y paginación. Solo muestra notificaciones del usuario actual.'
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Número de página (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Cantidad de notificaciones por página (default: 20)' })
  @ApiQuery({ name: 'unreadOnly', required: false, type: Boolean, description: 'Mostrar solo notificaciones no leídas' })
  @ApiResponse({ 
    status: 200, 
    description: 'Lista de notificaciones obtenida exitosamente',
    schema: {
      type: 'object',
      properties: {
        notifications: { 
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              type: { type: 'string' },
              title: { type: 'string' },
              message: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
              read: { type: 'boolean' },
              requiresAction: { type: 'boolean' },
              createdAt: { type: 'string', format: 'date-time' }
            }
          }
        },
        total: { type: 'number', description: 'Total de notificaciones' },
        unreadCount: { type: 'number', description: 'Cantidad de notificaciones no leídas' },
        currentPage: { type: 'number' },
        totalPages: { type: 'number' }
      }
    }
  })
  async getNotifications(
    @Request() req: any,
    @Query() dto: GetNotificationsDto,
  ) {
    const userId = req.user.id;
    this.logger.log(`📬 Obteniendo notificaciones para usuario ${userId}`);
    this.logger.debug(`Query params: ${JSON.stringify(dto)}`);
    
    try {
      const result = await this.notificationsService.findAll(dto, userId);
      this.logger.log(`✅ Retornando ${result.notifications.length} notificaciones, ${result.unreadCount} sin leer`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error obteniendo notificaciones: ${error.message}`);
      throw error;
    }
  }

  /**
   * POST /notifications/mark-as-read
   * Marcar notificaciones como leídas
   * NOTA: No requiere permisos específicos - cualquier usuario puede marcar SUS PROPIAS notificaciones
   */
  @Post('mark-as-read')
  @ApiOperation({ 
    summary: 'Marcar notificaciones como leídas', 
    description: 'Marca las notificaciones especificadas como leídas. Solo puede marcar sus propias notificaciones.'
  })
  @ApiBody({ type: MarkAsReadDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Notificaciones marcadas como leídas exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async markAsRead(
    @Request() req: any,
    @Body() dto: MarkAsReadDto,
  ) {
    const userId = req.user.id;
    this.logger.log(`📖 Marcando ${dto.notificationIds.length} notificaciones como leídas para usuario ${userId}`);
    this.logger.debug(`IDs: ${JSON.stringify(dto.notificationIds)}`);
    
    await this.notificationsService.markAsRead(dto, userId);
    
    this.logger.log(`✅ Notificaciones marcadas exitosamente`);
    return { success: true, message: `${dto.notificationIds.length} notificaciones marcadas como leídas` };
  }

  /**
   * POST /notifications/mark-all-as-read
   * Marcar todas las notificaciones como leídas
   * NOTA: No requiere permisos específicos - cualquier usuario puede marcar todas SUS notificaciones
   */
  @Post('mark-all-as-read')
  @ApiOperation({ 
    summary: 'Marcar todas las notificaciones como leídas', 
    description: 'Marca todas las notificaciones del usuario como leídas de una vez.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Todas las notificaciones marcadas como leídas',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async markAllAsRead(@Request() req: any) {
    const userId = req.user.id;
    this.logger.log(`📖 Marcando todas las notificaciones como leídas para usuario ${userId}`);
    
    await this.notificationsService.markAllAsRead(userId);
    
    this.logger.log(`✅ Todas las notificaciones marcadas como leídas`);
    return { success: true, message: 'Todas las notificaciones marcadas como leídas' };
  }

  /**
   * POST /notifications/delete-all
   * Eliminar todas las notificaciones del usuario (soft delete)
   * NOTA: No requiere permisos específicos - cualquier usuario puede eliminar SUS notificaciones
   */
  @Post('delete-all')
  @ApiOperation({ 
    summary: 'Eliminar todas las notificaciones', 
    description: 'Elimina (soft delete) todas las notificaciones del usuario autenticado.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Todas las notificaciones eliminadas',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async deleteAll(@Request() req: any) {
    const userId = req.user.id;
    this.logger.log(`🗑️ Eliminando todas las notificaciones para usuario ${userId}`);
    
    await this.notificationsService.deleteAll(userId);
    
    this.logger.log(`✅ Todas las notificaciones eliminadas`);
    return { success: true, message: 'Todas las notificaciones eliminadas' };
  }

  /**
   * POST /notifications/delete-old
   * Eliminar notificaciones antiguas leídas
   * NOTA: No requiere permisos específicos - cualquier usuario puede limpiar SUS notificaciones antiguas
   */
  @Post('delete-old')
  @ApiOperation({ 
    summary: 'Eliminar notificaciones antiguas', 
    description: 'Elimina notificaciones leídas con más de X días de antigüedad (por defecto 30 días). Útil para mantener limpio el buzón de notificaciones.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        daysOld: { type: 'number', description: 'Días de antigüedad (default: 30)', example: 30 }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Notificaciones antiguas eliminadas',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async deleteOld(
    @Request() req: any,
    @Body() body: { daysOld?: number },
  ) {
    const userId = req.user.id;
    const daysOld = body.daysOld || 30;
    this.logger.log(`🗑️ Eliminando notificaciones de más de ${daysOld} días para usuario ${userId}`);
    
    await this.notificationsService.deleteOld(userId, daysOld);
    
    this.logger.log(`✅ Notificaciones antiguas eliminadas`);
    return { success: true, message: `Notificaciones de más de ${daysOld} días eliminadas` };
  }

  /**
   * POST /notifications/test
   * Enviar una notificación de prueba (solo para desarrollo/testing)
   * NOTA: No requiere permisos - cualquier usuario puede enviarse una notificación de prueba a sí mismo
   */
  @Post('test')
  @ApiOperation({ 
    summary: 'Enviar notificación de prueba', 
    description: 'Envía una notificación de prueba al usuario autenticado. Útil para testing y demostración del sistema de notificaciones.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        type: { 
          type: 'string', 
          enum: ['VISITOR_ARRIVAL', 'VISIT_CHECK_IN', 'VISIT_APPROVED', 'VEHICLE_DETECTED', 'UNKNOWN_VEHICLE', 'SYSTEM_ALERT', 'SYSTEM_INFO'],
          description: 'Tipo de notificación de prueba',
          example: 'SYSTEM_INFO'
        },
        requiresAction: { type: 'boolean', description: 'Si requiere acción del usuario', example: false },
        priority: { 
          type: 'string', 
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Prioridad de la notificación',
          example: 'normal'
        }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Notificación de prueba enviada exitosamente',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        notification: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            message: { type: 'string' }
          }
        }
      }
    }
  })
  async sendTestNotification(
    @Request() req: any,
    @Body() body: { 
      type?: string;
      requiresAction?: boolean;
      priority?: string;
    },
  ) {
    const userId = req.user.id;
    const { type = 'SYSTEM_INFO', requiresAction = false, priority = 'normal' } = body;

    this.logger.log(`🧪 Enviando notificación de prueba tipo "${type}" a usuario ${userId}`);

    // Mapeo de tipos a mensajes
    const messages: Record<string, { title: string; message: string }> = {
      'VISITOR_ARRIVAL': {
        title: 'Visitante en Portería',
        message: 'Juan Pérez está esperando en la entrada (Patente: ABC123)',
      },
      'VISIT_CHECK_IN': {
        title: 'Visita Registrada',
        message: 'María González ha ingresado al condominio',
      },
      'VISIT_APPROVED': {
        title: 'Visita Aprobada',
        message: 'Has aprobado la visita de Carlos Rodríguez',
      },
      'VEHICLE_DETECTED': {
        title: 'Vehículo Detectado',
        message: 'Se detectó el vehículo con patente XYZ789 en la entrada',
      },
      'UNKNOWN_VEHICLE': {
        title: 'Vehículo Desconocido',
        message: 'Vehículo no registrado detectado: DEF456',
      },
      'SYSTEM_ALERT': {
        title: 'Alerta del Sistema',
        message: 'Se requiere atención en la cámara 2',
      },
      'SYSTEM_INFO': {
        title: 'Información del Sistema',
        message: 'Esta es una notificación de prueba del sistema',
      },
    };

    const notification = messages[type] || messages['SYSTEM_INFO'];
    
    await this.notificationsService.create({
      recipientId: userId,
      type: type as any,
      title: notification.title,
      message: notification.message,
      priority: priority as any,
      requiresAction,
      data: {
        test: true,
        timestamp: new Date().toISOString(),
      },
    });

    this.logger.log(`✅ Notificación de prueba enviada exitosamente`);

    return { 
      success: true, 
      message: 'Notificación de prueba enviada',
      notification,
    };
  }
}
