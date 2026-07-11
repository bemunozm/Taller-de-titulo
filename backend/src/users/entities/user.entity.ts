import { Role } from "src/roles/entities/role.entity";
import { Token } from "src/tokens/entities/token.entity";
import { Family } from "src/families/entities/family.entity";
import { Column, DeleteDateColumn, Entity, JoinTable, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * User canónico (Fase 0, tarea #16 — docs/modulos/auth-multitenant.md sección 4,
 * opción C). Esta es la ÚNICA tabla de usuario del sistema: la misma tabla física
 * `user` que lee/escribe better-auth (src/auth/better-auth.ts) para identidad y
 * sesión, extendida acá con los campos de dominio de la app.
 *
 * Quién es dueño de qué columna:
 * - Nativas de better-auth (id, name, email, emailVerified, image, createdAt,
 *   updatedAt): declaradas acá porque TypeORM (`synchronize: true`) es quien
 *   crea/migra físicamente esta tabla — better-auth las consume vía su config
 *   `user.additionalFields`/campos nativos, pero NO corre su propia migración
 *   sobre `user` (ver cabecera de better-auth.ts).
 * - Dominio (rut, phone, age, profilePicture): declaradas como
 *   `user.additionalFields` en la config de better-auth para que viajen en el
 *   payload de session/sign-up de better-auth también.
 * - `password`: NO es un additionalField de better-auth (better-auth guarda su
 *   propio hash de credenciales en su tabla `account`). Es la columna legacy que
 *   sigue usando el AuthService/AuthGuard propios (JWT) mientras no se completen
 *   las tareas #17/#18. Debe ser `nullable` porque los INSERT que haga
 *   better-auth (p.ej. `/api/auth/sign-up/email`, futuras invitaciones) no
 *   conocen esta columna y no la van a poblar.
 */
@Entity({ name: 'user' })
export class User {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    // --- Campos nativos de better-auth (BaseUser) ---
    @Column({ type: "varchar", length: 100, nullable: false })
    name: string;

    @Column({ type: "varchar", nullable: false, unique: true, transformer: { to: (value: string) => value.toLowerCase(), from: (value: string) => value } })
    email: string;

    // Reemplaza al antiguo `confirmed` propio: se reutiliza el campo nativo de
    // better-auth (mismo significado semántico — "el usuario verificó su
    // email"). El FLUJO que lo marca en true sigue siendo el propio (tokens de
    // 6 dígitos) hasta que la tarea #18 lo migre a `verification` de better-auth.
    @Column({ type: "boolean", default: false })
    emailVerified: boolean;

    // No usado hoy por la app (el frontend sigue leyendo `profilePicture`);
    // existe porque better-auth lo espera como campo nativo (avatar de OAuth,
    // futuros flujos de social login, etc.).
    @Column({ type: "varchar", length: 512, nullable: true })
    image: string | null;

    @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
    updatedAt: Date;

    // --- Dominio (better-auth `user.additionalFields`) ---
    @Column({ type: "varchar", length: 50, nullable: false, unique: true })
    rut: string;

    @Column({ type: "varchar", length: 15, nullable: false, unique: true })
    phone: string;

    @Column({ type: "int", nullable: true })
    age: number;

    @Column({ type: "varchar", length: 512, nullable: true })
    profilePicture: string | null;

    // --- Legacy (AuthService/AuthGuard propios — ver docstring de la clase) ---
    @Column({ type: "varchar", select: false, nullable: true })
    password: string;

    @DeleteDateColumn({ type: "timestamptz", nullable: true })
    deletedAt: Date;


    @ManyToMany(() => Role, (role) => role.users, { eager: true })
    @JoinTable()
    roles: Role[];

    @OneToMany(() => Token, token => token.user)
    tokens: Token[];

    @ManyToOne(() => Family, family => family.members, { nullable: true })
    family: Family | null;
}
