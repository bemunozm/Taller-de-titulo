import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Visit } from '../../visits/entities/visit.entity';

export enum SessionStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
}

/**
 * Residente notificado de una solicitud del conserje digital. Fase 4 · P7.R:
 * `name` queda en `null` cuando la sesión se anonimiza (se conserva el `id`).
 */
export interface NotifiedResident {
  id: string;
  name: string | null;
}

@Entity({ name: 'concierge_sessions' })
// Fase 4 · P7.R: índice parcial del barrido de retención (fecha de cierre,
// solo filas sin anonimizar). Lo crea la migración PrivacyRetention;
// `synchronize: false` evita que `migration:check` lo reporte o lo borre.
@Index('IDX_concierge_sessions_retention_candidates', { synchronize: false })
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

  // Residentes contactados (todos los miembros de la familia). Fase 4 · P4:
  // sin el campo `responded` (nunca se actualizaba; quién respondió vive en
  // `visits.respondedById`). Las filas viejas que lo traen son inocuas.
  @Column({ type: 'jsonb', nullable: true })
  residentsNotified: NotifiedResident[] | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  residentResponse: 'approved' | 'denied' | 'pending' | null;

  /**
   * Fase 4 · P4: resultado EFECTIVO de una respuesta aprobada: `true` solo si
   * el ingreso quedó registrado por esta respuesta Y un hub físico recibió la
   * orden de apertura. `null` mientras no hay respuesta aprobada o mientras
   * se procesa (lo lee `/status`, el respaldo por polling del kiosko). Se
   * escribe junto con `residentResponse`, después de decidir la apertura.
   */
  @Column({ type: 'boolean', nullable: true })
  entryRegistered: boolean | null;

  // Socket del visitante/agente para notificaciones en tiempo real
  @Column({ type: 'varchar', length: 64, nullable: true })
  visitorSocketId: string | null;

  // Hub físico que inició la sesión (si aplica)
  @Column({ type: 'varchar', length: 64, nullable: true })
  hubId: string | null;

  // Origen de la sesión: 'web' (frontend) o 'hub' (Raspberry Pi)
  @Column({ type: 'varchar', length: 16, default: 'web' })
  source: 'web' | 'hub';

  // Fase 1, Bloque A1 (docs/modulos/agente-cerebro.md §7): tenant de la
  // sesión, derivado del Hub físico (`Hub.organizationId`, ver
  // ConciergeAuthGuard/HubAuthGuard) o de la sesión de usuario humano
  // (better-auth/JWT legacy). Mismo patrón que el resto de columnas
  // `organizationId` de Fase 0 — ver docstring en
  // src/cameras/entities/camera.entity.ts: nullable porque sesiones sin
  // tenant resuelto (hub aún no asociado a un condominio) caen en el "cajón
  // nulo" en vez de romper (stampOrganizationId).
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

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

  /**
   * Fase 4 · P7.R (Ley 21.719): cuándo se anonimizó la sesión terminal (datos
   * del visitante a null, nombres de `residentsNotified` a null conservando
   * los ids, `transcript`/`functionCalls` = []), por retención
   * (`RETENTION_VISITS_DAYS`) o por supresión. `null` = sin anonimizar.
   */
  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
