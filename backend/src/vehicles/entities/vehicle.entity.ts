import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity({ name: 'vehicles' })
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 16, unique: true })
  plate: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  color: string | null;

  @Column({ type: 'int', nullable: true })
  year: number | null;

  // residente o visitante (temporal)
  @Column({ type: 'varchar', length: 32, nullable: true })
  vehicleType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  accessLevel: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { nullable: true })
  owner: User | null;
}
