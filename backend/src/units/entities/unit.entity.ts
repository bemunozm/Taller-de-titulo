import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
  Index,
} from 'typeorm';
import { Family } from '../../families/entities/family.entity';

/** Nombre del índice UNIQUE `(organizationId, identifier)` (migración P5.B). */
export const UNITS_ORGANIZATION_IDENTIFIER_UNIQUE =
  'UQ_units_organization_identifier';

/**
 * Fase 4 · P5.B: el identificador es único POR CONDOMINIO (antes era único en
 * toda la plataforma: el "A-101" de un condominio impedía crearlo en otro).
 * En la BD el índice es `UNIQUE NULLS NOT DISTINCT` (Postgres 15, ver la
 * migración `PerOrganizationUniqueness`): las unidades sin condominio también
 * comparten un único espacio de identificadores. TypeORM 0.3 no expresa
 * `NULLS NOT DISTINCT`, pero tampoco lo compara, así que `migration:check`
 * no reporta drift.
 */
@Entity({ name: 'units' })
@Index(UNITS_ORGANIZATION_IDENTIFIER_UNIQUE, ['organizationId', 'identifier'], {
  unique: true,
})
export class Unit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7). Ver docstring en
  // src/cameras/entities/camera.entity.ts sobre el diseño de esta columna.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  block: string | null; // "A", "B", null para casas/sin bloques

  @Column({ type: 'varchar', length: 10 })
  number: string; // "303", "101", "Casa 5"

  // Único por condominio (ver docstring de la clase).
  @Column({ type: 'varchar', length: 20 })
  identifier: string; // "A-303", "B-303", "Casa-5" (generado automáticamente)

  @Column({ type: 'int', nullable: true })
  floor: number | null; // Piso (opcional)

  @Column({ type: 'varchar', length: 50, nullable: true })
  type: string | null; // "departamento", "casa", "local comercial"

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @OneToMany(() => Family, family => family.unit)
  families: Family[]; // Historial de todas las familias (activas e inactivas)

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /**
   * Hook para generar el identificador único antes de insertar/actualizar
   * Formato: "BLOCK-NUMBER" o solo "NUMBER" si no hay bloque
   */
  @BeforeInsert()
  @BeforeUpdate()
  generateIdentifier() {
    if (this.block && this.block.trim()) {
      this.identifier = `${this.block.trim().toUpperCase()}-${this.number.trim()}`;
    } else {
      this.identifier = this.number.trim();
    }
  }
}
