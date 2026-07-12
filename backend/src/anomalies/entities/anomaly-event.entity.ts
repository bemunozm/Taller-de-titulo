import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('anomaly_events')
export class AnomalyEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7) — resource-derived desde
  // la cámara asociada (`cameraId` de abajo), estampado en
  // AnomaliesService.createAnomaly. Ver docstring en
  // src/detections/entities/access-attempt.entity.ts.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

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
