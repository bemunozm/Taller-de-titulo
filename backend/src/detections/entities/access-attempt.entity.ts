import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  Index,
} from 'typeorm';
import { PlateDetection } from './plate-detection.entity';
import { User } from '../../users/entities/user.entity';
import { VehiclePassage } from './vehicle-passage.entity';

@Entity({ name: 'access_attempts' })
// Una pasada tiene a lo sumo UN intento: lo garantiza la BD, no solo el código.
@Index('UQ_access_attempts_passage', ['passageId'], {
  unique: true,
  where: '"passageId" IS NOT NULL',
})
export class AccessAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7) — resource-derived: se
  // copia desde `detection.organizationId` (a su vez derivado de la cámara,
  // ver DetectionsService.createDetection). NO viene de TenantContext: estos
  // registros los crea el worker LPR sin sesión de usuario (endpoint sin
  // AuthGuard, ver DetectionsController). Filtrado por tenant en los
  // endpoints de lectura (listAttempts/listPendingDetections) queda
  // PENDIENTE — ver reporte de la tarea #19.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

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

  @ManyToOne(() => PlateDetection, (d) => d.accessAttempts, {
    onDelete: 'CASCADE',
  })
  detection: PlateDetection;

  /** Pasada (`VehiclePassage`) de la que este intento es el único con efectos. */
  @Column({ type: 'uuid', nullable: true })
  passageId: string | null;

  @ManyToOne(() => VehiclePassage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'passageId' })
  passage?: VehiclePassage | null;

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
