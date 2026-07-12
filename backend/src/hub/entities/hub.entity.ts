import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity({ name: 'hubs' })
export class Hub {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Tarea #19 (docs/modulos/auth-multitenant.md §7). Se estampa en
  // `HubsService.provision` (Fase 1, Bloque A1.1, docs/modulos/agente-cerebro.md
  // §7/§11) — "un hub sirve a UN condominio" (decisión de la tarea), sin
  // multi-org por hub. Ver docstring en src/cameras/entities/camera.entity.ts
  // sobre el diseño general de esta columna en el resto de entidades.
  @Index()
  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ type: 'varchar', length: 64, unique: true })
  hubId: string; // hub-001, hub-002, etc.

  // Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — H1): hash
  // bcrypt (mismo `hashPassword` de src/auth/utils/auth.util.ts) del secret
  // PROPIO de este hub — reemplaza el `HUB_SECRET` global compartido (todos
  // los hubs usaban el mismo valor, así que un hub de un condominio podía
  // mandar el `X-Hub-Id` de otro y suplantarlo). El secret en claro solo se
  // devuelve UNA VEZ, en la respuesta de `HubsService.provision`/
  // `rotateSecret` — nunca se persiste ni se loguea. Nullable porque un hub
  // creado sin CRUD (filas legacy previas a esta tarea) no tiene secret
  // propio todavía: `HubAuthGuard` lo rechaza explícitamente en vez de caer a
  // un fallback inseguro.
  @Column({ type: 'varchar', length: 255, nullable: true })
  secretHash: string | null;

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
