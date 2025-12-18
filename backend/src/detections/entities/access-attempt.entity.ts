import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { PlateDetection } from './plate-detection.entity';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'access_attempts' })
export class AccessAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // patente, reconocimiento facial, visitante, manual, app. 
  @Column({ type: 'varchar', length: 128, nullable: true })
  method: string | null;

  @Column({ type: 'varchar', length: 64 })
  decision: string; // "Permitido", "Denegado", "Pendiente"

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  // Relacion con tabla de users: si se conoce el residente/propietario
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'residente_id' })
  residente: User | null;

  @ManyToOne(() => PlateDetection, (d) => d.accessAttempts, { onDelete: 'CASCADE' })
  detection: PlateDetection;

  // Campos para decisiones pendientes que requieren aprobación del conserje
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null; // Solo para decisiones "Pendiente"

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'responded_by_id' })
  respondedBy: User | null; // Conserje que tomó la decisión

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null; // Cuándo se tomó la decisión

  @Column({ type: 'uuid', nullable: true })
  notificationId: string | null; // ID de la notificación enviada al conserje

  // Métrica de rendimiento: tiempo entre detección y decisión
  @Column({ type: 'int', nullable: true })
  responseTimeMs: number | null; // Tiempo de respuesta en milisegundos (T2 - T1)
}
