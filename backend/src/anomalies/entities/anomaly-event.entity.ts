import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('anomaly_events')
export class AnomalyEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  cameraId: string;

  @Column({ type: 'varchar', length: 100 })
  anomalyType: string;

  @Column({ type: 'float' })
  confidence: number;

  @Column({ type: 'text', nullable: true })
  snapshotJpegB64: string;

  @Column({ type: 'int', nullable: true })
  durationSeconds: number;

  @Column({ type: 'int', nullable: true })
  trackId: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  suspicionLevel: string; // 'HIGH', 'MEDIUM', 'LOW'

  @Column({ type: 'text', nullable: true })
  aiReasoning: string;

  @CreateDateColumn()
  timestamp: Date;
}
