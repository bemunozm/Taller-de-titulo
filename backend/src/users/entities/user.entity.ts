import { Role } from "src/roles/entities/role.entity";
import { Token } from "src/tokens/entities/token.entity";
import { Column, DeleteDateColumn, Entity, JoinTable, ManyToMany, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";


@Entity()
export class User {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ type: "varchar", length: 50, nullable: false, unique: true })
    rut: string;

    @Column({ type: "varchar", length: 100, nullable: false })
    name: string;

    @Column({ type: "varchar", nullable: false, unique: true, transformer: { to: (value: string) => value.toLowerCase(), from: (value: string) => value } })
    email: string;

    @Column({ type: "varchar", length: 15, nullable: false, unique: true })
    phone: string;

    @Column({ type: "varchar", select: false, nullable: false })
    password: string;

    @Column({ type: "int", nullable: true })
    age: number;

    @Column({ type: "boolean", default: false })
    confirmed: boolean;

    @Column({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date;


    @ManyToMany(() => Role, (role) => role.users, { eager: true })
    @JoinTable()
    roles: Role[];

    @OneToMany(() => Token, (token) => token.user)
    tokens: Token[];
}
