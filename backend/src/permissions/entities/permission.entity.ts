import { Role } from "src/roles/entities/role.entity";
import { Column, Entity, ManyToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Permission {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ type: 'varchar', unique: true, length: 100 })
    name: string;

    @Column({ type: 'varchar', length: 255 })
    description: string;

    @Column({ type: 'varchar', length: 50 })
    module: string;

    @Column({ type: 'varchar', length: 50 })
    action: string;

    @ManyToMany(() => Role, (role) => role.permissions)
    roles: Role[];
}