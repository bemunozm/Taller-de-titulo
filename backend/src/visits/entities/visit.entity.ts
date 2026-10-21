import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { Family } from '../../families/entities/family.entity';

export enum VisitType {
  VEHICULAR = 'vehicular',
  PEDESTRIAN = 'pedestrian',
}

/**
 * Estados de una visita. Las transiciones permitidas viven en
 * `visits/visit-state-machine.ts` (Fase 4 · P3, D2): ningún servicio debe
 * asignar `status` sin pasar por esa tabla.
 *
 * El orden de los miembros sigue el ciclo de vida y coincide con el del tipo
 * Postgres `visits_status_enum` (`awaiting_approval` se agregó `BEFORE
 * 'pending'`, ver la migración `AddAwaitingApprovalToVisits`).
 */
export enum VisitStatus {
  AWAITING_APPROVAL = 'awaiting_approval', // Solicitada por el conserje digital; el residente aún no aprueba
  PENDING = 'pending', // Aprobada/programada, aún no ha ingresado nunca
  ACTIVE = 'active', // En curso, actualmente dentro
  READY_FOR_REENTRY = 'ready', // Salió pero puede reingresar (tiene usos disponibles)
  COMPLETED = 'completed', // Finalizada (sin más usos disponibles)
  CANCELLED = 'cancelled', // Cancelada
  EXPIRED = 'expired', // Expiró sin ingresar (o sin respuesta del residente)
  DENIED = 'denied', // Rechazada por el residente
}

@Entity({ name: 'visits' })
// Fase 4 · P7.R: índice parcial del barrido de retención (expresión de la
// fecha de cierre, solo filas sin anonimizar). TypeORM no expresa índices
// parciales ni por expresión: lo crea la migración PrivacyRetention y
// `synchronize: false` evita que `migration:check` lo reporte o lo borre.
@Index('IDX_visits_retention_candidates', { synchronize: false })
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7). Columna agregada al
  // esquema; el estampado/filtrado por tenant en VisitsService queda
  // PENDIENTE (ver reporte de la tarea #19) — se prioriza el mecanismo
  // reutilizable + las entidades más simples (cameras/units/families/
  // vehicles). Ver docstring en src/cameras/entities/camera.entity.ts sobre
  // el diseño de esta columna.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ type: 'enum', enum: VisitType })
  type: VisitType;

  @Column({ type: 'enum', enum: VisitStatus, default: VisitStatus.PENDING })
  status: VisitStatus;

  @Column({ type: 'varchar', length: 128 })
  visitorName: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  visitorRut: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true })
  visitorPhone: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  reason: string | null;

  /**
   * Patente que declaró el visitante al pedir la visita (flujo del conserje
   * digital, estado `AWAITING_APPROVAL`). Es la que el residente ve y aprueba:
   * `VisitsService.approve` crea o asocia el `Vehicle` a partir de ESTE valor,
   * nunca de la sesión del conserje (que el agente puede seguir editando
   * después de notificar). Mientras no se apruebe, la visita no tiene
   * `vehicle` y el LPR no puede reconocerla.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  requestedPlate: string | null;

  // Código QR único (para TODAS las visitas: peatonales Y vehiculares)
  // Para vehiculares sirve como respaldo si el LPR falla
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  qrCode: string | null;

  // Control de usos
  @Column({ type: 'int', nullable: true, default: null })
  maxUses: number | null; // null = ilimitado, número = cantidad máxima de usos

  @Column({ type: 'int', default: 0 })
  usedCount: number; // Contador de veces que se ha usado (check-ins realizados)

  // Fechas de validez
  @Column({ type: 'timestamptz' })
  validFrom: Date;

  @Column({ type: 'timestamptz' })
  validUntil: Date;

  // Fechas de ingreso/salida real
  @Column({ type: 'timestamptz', nullable: true })
  entryTime: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  exitTime: Date | null;

  /**
   * Fase 4 · P4 (D5): quién resolvió la solicitud del conserje digital
   * (aprobó o rechazó) y cuándo. Se escriben en el MISMO `UPDATE` condicionado
   * del claim (`VisitsService.approve`/`deny`), así que solo los guarda la
   * respuesta que ganó: es la fuente de verdad de "quién respondió"
   * (`ConciergeSession.residentResponse` es informativo). `ON DELETE SET
   * NULL`: borrar al usuario no borra la visita.
   */
  @Column({ type: 'uuid', nullable: true })
  respondedById: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'respondedById' })
  respondedBy?: User | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  /**
   * Fase 4 · P7.R (Ley 21.719): cuándo se anonimizaron los datos del
   * visitante (`visitorName` = "[anonimizado]"; RUT, teléfono, patente
   * solicitada, motivo y QR a null), por retención (`RETENTION_VISITS_DAYS`
   * desde el cierre) o por supresión (`POST /privacy/erasure`). `null` = sin
   * anonimizar. Hace idempotente el barrido; solo se anonimizan visitas
   * terminales.
   */
  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  // Relaciones
  @ManyToOne(() => User, { nullable: false })
  host: User; // El usuario que autoriza la visita (residente)

  @ManyToOne(() => Family, { nullable: true })
  family: Family | null; // La familia que recibe la visita

  @ManyToOne(() => Vehicle, { nullable: true })
  vehicle: Vehicle | null; // Vehículo asociado para visitas vehiculares
}
