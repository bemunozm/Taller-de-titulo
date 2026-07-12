import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Unit } from '../../units/entities/unit.entity';

@Entity({ name: 'families' })
export class Family {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7). Ver docstring en
  // src/cameras/entities/camera.entity.ts sobre el diseño de esta columna.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ type: 'varchar', length: 128 })
  name: string;

  @Column({ type: 'varchar', length: 256, nullable: true })
  description: string | null;

  @ManyToOne(() => Unit, unit => unit.families, { nullable: true, eager: true })
  @JoinColumn({ name: 'unit_id' })
  unit: Unit | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // Conserje Digital habilitado para esta familia
  @Column({ type: 'boolean', default: false })
  digitalConciergeEnabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => User, user => user.family)
  members: User[];
}