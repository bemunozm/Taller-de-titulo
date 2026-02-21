import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Visit } from '../../visits/entities/visit.entity';

export enum SessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
}

@Entity({ name: 'concierge_sessions' })
export class ConciergeSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  sessionId: string; // ID de sesión para OpenAI

  @Column({ type: 'enum', enum: SessionStatus, default: SessionStatus.ACTIVE })
  status: SessionStatus;

  // Datos del visitante recolectados
  @Column({ type: 'varchar', length: 128, nullable: true })
  visitorName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  visitorRut: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  visitorPhone: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  vehiclePlate: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  visitReason: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  destinationHouse: string | null;

  // Residentes contactados (todos los miembros de la familia)
  @Column({ type: 'jsonb', nullable: true })
  residentsNotified: Array<{ id: string; name: string; responded: boolean }> | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  residentResponse: 'approved' | 'denied' | 'pending' | null;

  // Socket del visitante/agente para notificaciones en tiempo real
  @Column({ type: 'varchar', length: 64, nullable: true })
  visitorSocketId: string | null;

  // Hub físico que inició la sesión (si aplica)
  @Column({ type: 'varchar', length: 64, nullable: true })
  hubId: string | null;

  // Origen de la sesión: 'web' (frontend) o 'hub' (Raspberry Pi)
  @Column({ type: 'varchar', length: 16, default: 'web' })
  source: 'web' | 'hub';

  // Visita creada (si fue aprobada)
  @ManyToOne(() => Visit, { nullable: true })
  createdVisit: Visit | null;

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  transcript: any; // Array de mensajes

  @Column({ type: 'jsonb', nullable: true })
  functionCalls: any; // Log de llamadas a funciones

  @Column({ type: 'timestamptz', nullable: true })
  startTime: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endTime: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
