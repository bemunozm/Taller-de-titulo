import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** Nombre del índice UNIQUE `(organizationId, plate)` (migración P5.B). */
export const VEHICLES_ORGANIZATION_PLATE_UNIQUE =
  'UQ_vehicles_organization_plate';

/**
 * Fase 4 · P5.B: la patente es única POR CONDOMINIO (antes era única en toda
 * la plataforma: un auto registrado en un condominio no podía registrarse en
 * otro, y el INSERT respondía 500). En la BD el índice es
 * `UNIQUE NULLS NOT DISTINCT` (Postgres 15, ver la migración
 * `PerOrganizationUniqueness`): los vehículos sin condominio comparten un
 * único espacio de patentes. TypeORM 0.3 no expresa `NULLS NOT DISTINCT`,
 * pero tampoco lo compara, así que `migration:check` no reporta drift.
 *
 * `vehicleType`/`accessLevel` se validan contra `VehicleType`/
 * `VehicleAccessLevel` (vehicle-access.ts) en los DTO; las columnas siguen
 * siendo varchar. Fase 4 · P5.C: `vehicleType` es la carrocería
 * (descriptiva) y `accessLevel` lo único que decide el portón; la migración
 * `VehicleAccessModel` convirtió los datos del modelo anterior.
 */
@Entity({ name: 'vehicles' })
@Index(VEHICLES_ORGANIZATION_PLATE_UNIQUE, ['organizationId', 'plate'], {
  unique: true,
})
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7) — ver docstring en
  // src/cameras/entities/camera.entity.ts sobre el diseño de esta columna.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

  // Única por condominio (ver docstring de la clase).
  @Column({ type: 'varchar', length: 16 })
  plate: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  color: string | null;

  @Column({ type: 'int', nullable: true })
  year: number | null;

  // Carrocería (`VehicleType`): auto, camioneta, moto, camion, otro. No
  // interviene en el portón.
  @Column({ type: 'varchar', length: 32, nullable: true })
  vehicleType: string | null;

  // Nivel de acceso (`VehicleAccessLevel`): residente, visitante o servicio.
  // Lo único que decide el portón (ver `vehicleAccessRuleFor`).
  @Column({ type: 'varchar', length: 64, nullable: true })
  accessLevel: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: true, eager: true })
  owner: User | null;

  @Column({ type: 'uuid', nullable: true })
  ownerId: string | null;
}
