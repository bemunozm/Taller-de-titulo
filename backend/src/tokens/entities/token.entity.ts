import { User } from "src/users/entities/user.entity";
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, BeforeInsert } from "typeorm";

@Entity()
export class Token {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ type: "varchar", length: 6, nullable: false })
    token: string;

    @Column({ type: "uuid" })
    userId: string;

    @Column({ type: "timestamptz" })
    createdAt: Date;

    @Column({ type: "timestamptz" })
    expiresAt: Date;

    @ManyToOne(() => User, (user) => user.tokens, { onDelete: 'CASCADE' })
    user: User;

    @BeforeInsert()
    setExpirationDate() {
        const now = new Date();
        this.createdAt = now;
        // Establece la fecha de expiración a 10 minutos desde ahora
        // Cambia a "10 * 1000" para 10 segundos si quieres probarlo más rápido
        this.expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutos en millisegundos
    }

    // Método helper para verificar si el token ha expirado
    isExpired(): boolean {
        return new Date() > this.expiresAt;
    }
}
