import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AccessAttempt } from '../../detections/entities/access-attempt.entity';

@Entity({ name: 'plate_detections' })
// Fase 4 · P7.R: índices parciales del barrido de retención (filas sin
// anonimizar y filas con imágenes). Los crea la migración PrivacyRetention;
// `synchronize: false` evita que `migration:check` los reporte o los borre.
@Index('IDX_plate_detections_retention_candidates', { synchronize: false })
@Index('IDX_plate_detections_with_images', { synchronize: false })
export class PlateDetection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7) — resource-derived desde
  // la cámara asociada (`cameraId` de abajo), estampado en
  // DetectionsService.createDetection al recibir la detección del worker LPR
  // (sin sesión de usuario). Ver docstring de la misma columna en
  // access-attempt.entity.ts.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ type: 'varchar', length: 128 })
  cameraId: string;

  @Column({ type: 'varchar', length: 64 })
  plate: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  plate_raw: string | null;

  @Column({ type: 'float', nullable: true })
  det_confidence: number | null;

  @Column({ type: 'float', nullable: true })
  ocr_confidence: number | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  full_frame_path: string | null;

  // meta almacenará información opcional (bbox, snapshot, char confidences, etc.)
  @Column({ type: 'jsonb', nullable: true })
  meta: {
    bbox?: number[];
    snapshot_jpeg_b64?: string;
    char_confidences?: any;
    char_conf_min?: number | null;
    char_conf_mean?: number | null;
    confirmed_by?: string | null;
  } | null;

  @Column({ type: 'bigint', nullable: true })
  detectionTimestamp: number | null; // Timestamp real de detección desde el LPR (ms desde epoch)

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date; // Timestamp de recepción en backend

  /**
   * Fase 4 · P7.R (Ley 21.719): cuándo se anonimizó la detección (`plate` =
   * "******", `plate_raw` e imágenes a null; en sus intentos, `reason` y el
   * residente a null), por retención (`RETENTION_ACCESS_LOG_DAYS`) o por
   * supresión. La fila sigue: el dashboard la cuenta. `null` = sin anonimizar.
   */
  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt: Date | null;

  @OneToMany(() => AccessAttempt, (a) => a.detection, { cascade: true })
  accessAttempts: AccessAttempt[];
}
