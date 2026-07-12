import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'hubs' })
export class Hub {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7). Columna agregada al
  // esquema; sin CRUD propio todavía (solo existe HubGateway, un websocket
  // gateway sin service/controller REST) — no hay dónde estampar/filtrar por
  // ahora. Queda listo para cuando se implemente la gestión de hubs. Ver
  // docstring en src/cameras/entities/camera.entity.ts sobre el diseño.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

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
