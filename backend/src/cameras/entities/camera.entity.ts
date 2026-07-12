import { Role } from 'src/roles/entities/role.entity';
import { Column, Entity, Index, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Camera {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	// Tarea #19 (docs/modulos/auth-multitenant.md §7): tenant = condominio.
	// `null` = cámara legacy sin condominio asignado (pre-#19) o creada por
	// super-admin sin especificarlo. Sin FK gestionada por TypeORM a propósito:
	// `organization` es una tabla de better-auth (no una entidad TypeORM), mismo
	// criterio que la relación `user` <-> `session`/`account` (ver
	// src/auth/better-auth.ts). Scoping real vía TenantContextService
	// (src/common/tenant/).
	@Index()
	@Column({ type: 'uuid', nullable: true })
	organizationId: string | null;

	@Column({ type: 'varchar', length: 150 })
	name: string;

	@Column({ type: 'varchar', length: 200, nullable: true })
	location: string;

	// Encrypted RTSP URL or source identifier
	@Column({ type: 'text', nullable: true })
	encryptedSourceUrl: string;

	// Optional mount path / stream id to expose in MediaMTX (e.g. live/cam1)
	@Column({ type: 'varchar', length: 150, nullable: true, unique: true })
	mountPath: string;

	@Column({ type: 'boolean', default: false })
	registeredInMediamtx: boolean;

	@Column({ type: 'boolean', default: false })
	enableLpr: boolean;

	@Column({ type: 'boolean', default: false })
	enableGuardian: boolean;

	@Column({ type: 'jsonb', nullable: true, default: [] })
	guardianZones: any[];

	@Column({ type: 'boolean', default: true })
	active: boolean;

	@ManyToMany(() => Role, (role) => role.cameras, { eager: false })
	@JoinTable({ name: 'camera_roles' })
	roles: Role[];
}
