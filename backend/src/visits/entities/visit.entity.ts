import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { Family } from '../../families/entities/family.entity';

export enum VisitType {
  VEHICULAR = 'vehicular',
  PEDESTRIAN = 'pedestrian',
}

export enum VisitStatus {
  PENDING = 'pending',           // Programada, aún no ha ingresado nunca
  ACTIVE = 'active',             // En curso, actualmente dentro
  READY_FOR_REENTRY = 'ready',   // Salió pero puede reingresar (tiene usos disponibles)
  COMPLETED = 'completed',       // Finalizada (sin más usos disponibles)
  CANCELLED = 'cancelled',       // Cancelada
  EXPIRED = 'expired',           // Expiró sin ingresar
  DENIED = 'denied',             // Rechazada por el residente
}

@Entity({ name: 'visits' })
export class Visit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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
