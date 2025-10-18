import { User } from "src/users/entities/user.entity";
import { Permission } from "src/permissions/entities/permission.entity";
import { Camera } from 'src/cameras/entities/camera.entity';
import { Column, Entity, JoinTable, ManyToMany, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class Role {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({type: 'varchar', unique: true, length:100})
    name: string

    @Column({type: 'varchar', nullable: true})
    description: string

    @ManyToMany(() => User, (user) => user.roles)
    users: User[];

    @ManyToMany(() => Permission, (permission) => permission.roles)
    @JoinTable()
    permissions: Permission[];

    @ManyToMany(() => Camera, (camera) => camera.roles)
    cameras: Camera[];
}
