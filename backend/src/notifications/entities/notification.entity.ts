import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Tipos de notificaciones soportadas
 */
export enum NotificationType {
  // Visitas
  VISIT_CHECK_IN = 'VISIT_CHECK_IN',
  VISIT_CHECK_OUT = 'VISIT_CHECK_OUT',
  VISIT_APPROVED = 'VISIT_APPROVED',
  VISIT_REJECTED = 'VISIT_REJECTED',
  VISIT_EXPIRING_SOON = 'VISIT_EXPIRING_SOON',
  VISIT_EXPIRED = 'VISIT_EXPIRED',
  VISIT_COMPLETED = 'VISIT_COMPLETED',
  
  // Conserje Digital
  VISITOR_ARRIVAL = 'VISITOR_ARRIVAL',
  
  // Acceso y Seguridad
  ACCESS_DENIED = 'ACCESS_DENIED',
  VEHICLE_DETECTED = 'VEHICLE_DETECTED',
  UNKNOWN_VEHICLE = 'UNKNOWN_VEHICLE',
  
  // Vehículos
  VEHICLE_REGISTERED = 'VEHICLE_REGISTERED',
  VEHICLE_UPDATED = 'VEHICLE_UPDATED',
  VEHICLE_REMOVED = 'VEHICLE_REMOVED',
  
  // Sistema
  SYSTEM_ALERT = 'SYSTEM_ALERT',
  SYSTEM_INFO = 'SYSTEM_INFO',
  
  // Familia
  FAMILY_UPDATE = 'FAMILY_UPDATE',
  FAMILY_INVITATION = 'FAMILY_INVITATION',
  FAMILY_MEMBER_ADDED = 'FAMILY_MEMBER_ADDED',
  FAMILY_MEMBER_REMOVED = 'FAMILY_MEMBER_REMOVED',
}

/**
 * Prioridad de la notificación
 */
export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * Entidad de Notificación persistente
 */
@Entity({ name: 'notifications' })
@Index(['recipient', 'read'])
@Index(['recipient', 'createdAt'])
@Index(['type', 'read'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'enum', enum: NotificationPriority, default: NotificationPriority.NORMAL })
  priority: NotificationPriority;

  @Column({ type: 'boolean', default: false })
  read: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  data: any;

  @ManyToOne(() => User, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipientId' })
  recipient: User;

  @Column({ type: 'uuid' })
  recipientId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /**
   * Indica si la notificación requiere acción del usuario
   * Por ejemplo: aprobar/rechazar visita
   */
  @Column({ type: 'boolean', default: false })
  requiresAction: boolean;

  /**
   * Si requiresAction=true, indica si ya se tomó acción
   */
  @Column({ type: 'boolean', default: false })
  actionTaken: boolean;

  /**
   * Metadata sobre la acción tomada (si aplica)
   */
  @Column({ type: 'jsonb', nullable: true })
  actionData: any;
}
