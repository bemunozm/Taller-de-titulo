import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { AccessAttempt } from '../../detections/entities/access-attempt.entity';

@Entity({ name: 'plate_detections' })
export class PlateDetection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
    timestamp?: string;
    confirmed_by?: string | null;
  } | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => AccessAttempt, (a) => a.detection, { cascade: true })
  accessAttempts: AccessAttempt[];
}
