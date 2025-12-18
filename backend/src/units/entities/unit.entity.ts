import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  OneToMany, 
  CreateDateColumn, 
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
} from 'typeorm';
import { Family } from '../../families/entities/family.entity';

@Entity({ name: 'units' })
export class Unit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  block: string | null; // "A", "B", null para casas/sin bloques

  @Column({ type: 'varchar', length: 10 })
  number: string; // "303", "101", "Casa 5"

  @Column({ type: 'varchar', length: 20, unique: true })
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
