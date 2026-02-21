import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'hubs' })
export class Hub {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  hubId: string; // hub-001, hub-002, etc.

  @Column({ type: 'varchar', length: 256 })
  location: string; // "Edificio A - Panel de Calle"

  @Column({ type: 'varchar', length: 128, nullable: true })
  description: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  firmwareVersion: string | null; // 1.0.0

  @Column({ type: 'jsonb', nullable: true })
  config: any; // {relayPins: [17,27,22,23], audioDevice: "plughw:1,0"}

  @Column({ type: 'timestamptz', nullable: true })
  lastSeen: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
