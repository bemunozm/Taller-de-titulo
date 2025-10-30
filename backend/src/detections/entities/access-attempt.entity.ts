import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, JoinColumn } from 'typeorm';
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
  decision: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  // Relacion con tabla de users: si se conoce el residente/propietario
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'residente_id' })
  residente: User | null;

  @ManyToOne(() => PlateDetection, (d) => d.accessAttempts, { onDelete: 'CASCADE' })
  detection: PlateDetection;
}
