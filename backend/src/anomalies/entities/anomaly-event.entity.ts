import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import type { AnomalyAiStatus, AnomalyStatus } from '../anomaly-status';

@Entity('anomaly_events')
@Index('IDX_anomaly_events_org_status_timestamp', [
  'organizationId',
  'status',
  'timestamp',
])
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

  // Revisión por el Administrador/Conserje (PATCH /anomalies/:id/status).
  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: AnomalyStatus;

  @Column({ type: 'uuid', nullable: true })
  resolvedById: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  resolutionNote: string | null;

  // Análisis de IA en segundo plano: pending | done | failed | skipped.
  // NULL = anomalía anterior a este campo (se analizó de forma síncrona).
  @Column({ type: 'varchar', length: 16, nullable: true })
  aiStatus: AnomalyAiStatus | null;

  // Veredicto `isFalsePositive` de la IA (solo orientativo).
  @Column({ type: 'boolean', nullable: true })
  aiFalsePositive: boolean | null;

  @CreateDateColumn()
  timestamp: Date;
}
