import { Role } from 'src/roles/entities/role.entity';
import { Column, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Camera {
	@PrimaryGeneratedColumn('uuid')
	id: string;

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

	@Column({ type: 'boolean', default: true })
	active: boolean;

	@ManyToMany(() => Role, (role) => role.cameras, { eager: false })
	@JoinTable({ name: 'camera_roles' })
	roles: Role[];
}
