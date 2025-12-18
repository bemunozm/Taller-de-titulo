import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum AuditAction {
  // CRUD Operations
  CREATE = 'CREATE',
  READ = 'READ',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  
  // Auth Operations
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  PASSWORD_RESET = 'PASSWORD_RESET',
  ACCOUNT_CONFIRM = 'ACCOUNT_CONFIRM',
  
  // Permission Operations
  PERMISSION_GRANT = 'PERMISSION_GRANT',
  PERMISSION_REVOKE = 'PERMISSION_REVOKE',
  ROLE_ASSIGN = 'ROLE_ASSIGN',
  ROLE_UNASSIGN = 'ROLE_UNASSIGN',
  
  // Camera Operations
  CAMERA_REGISTER = 'CAMERA_REGISTER',
  CAMERA_LPR_ENABLE = 'CAMERA_LPR_ENABLE',
  CAMERA_LPR_DISABLE = 'CAMERA_LPR_DISABLE',
  CAMERA_ACTIVATE = 'CAMERA_ACTIVATE',
  CAMERA_DEACTIVATE = 'CAMERA_DEACTIVATE',
  
  // Visit Operations
  VISIT_APPROVE = 'VISIT_APPROVE',
  VISIT_REJECT = 'VISIT_REJECT',
  VISIT_CHECK_IN = 'VISIT_CHECK_IN',
  VISIT_CHECK_OUT = 'VISIT_CHECK_OUT',
  VISIT_QR_VALIDATE = 'VISIT_QR_VALIDATE',
  
  // Detection Operations
  DETECTION_CREATED = 'DETECTION_CREATED',
  DETECTION_MATCHED = 'DETECTION_MATCHED',
  
  // Vehicle Operations
  VEHICLE_REGISTER = 'VEHICLE_REGISTER',
  VEHICLE_AUTHORIZE = 'VEHICLE_AUTHORIZE',
  VEHICLE_REVOKE = 'VEHICLE_REVOKE',
  
  // Family Operations
  FAMILY_MEMBER_ADD = 'FAMILY_MEMBER_ADD',
  FAMILY_MEMBER_REMOVE = 'FAMILY_MEMBER_REMOVE',
}

export enum AuditModule {
  AUTH = 'AUTH',
  USERS = 'USERS',
  ROLES = 'ROLES',
  PERMISSIONS = 'PERMISSIONS',
  FAMILIES = 'FAMILIES',
  CAMERAS = 'CAMERAS',
  STREAMS = 'STREAMS',
  VISITS = 'VISITS',
  VEHICLES = 'VEHICLES',
  DETECTIONS = 'DETECTIONS',
  NOTIFICATIONS = 'NOTIFICATIONS',
  DIGITAL_CONCIERGE = 'DIGITAL_CONCIERGE',
  MEDIAMTX = 'MEDIAMTX',
}

@Entity('audit_logs')
@Index(['module', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: AuditModule })
  module: AuditModule;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ nullable: true })
  entityId: string; // ID del registro afectado

  @Column({ nullable: true })
  entityType: string; // Tipo de entidad (User, Camera, Visit, etc.)

  @Column({ type: 'jsonb', nullable: true })
  oldValue: any; // Estado anterior (para UPDATE/DELETE)

  @Column({ type: 'jsonb', nullable: true })
  newValue: any; // Estado nuevo (para CREATE/UPDATE)

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    ip?: string;
    userAgent?: string;
    requestId?: string;
    endpoint?: string;
    method?: string;
    statusCode?: number;
    duration?: number;
  };

  @Column({ type: 'text', nullable: true })
  description: string; // Descripción legible

  @CreateDateColumn()
  createdAt: Date;
}
