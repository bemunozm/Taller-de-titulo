import { Role } from 'src/roles/entities/role.entity';
import { Token } from 'src/tokens/entities/token.entity';
import { Family } from 'src/families/entities/family.entity';
import {
  Column,
  DeleteDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

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
 * - Contraseña: NO vive en esta tabla. La única credencial es el hash de
 *   better-auth en `account.password` (cuenta `credential`); la columna legacy
 *   `user.password` se eliminó en la Fase 4 (P2, hallazgo A1).
 */
@Entity({ name: 'user' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // --- Campos nativos de better-auth (BaseUser) ---
  @Column({ type: 'varchar', length: 100, nullable: false })
  name: string;

  @Column({
    type: 'varchar',
    nullable: false,
    unique: true,
    transformer: {
      to: (value: string) => value.toLowerCase(),
      from: (value: string) => value,
    },
  })
  email: string;

  // Reemplaza al antiguo `confirmed` propio: se reutiliza el campo nativo de
  // better-auth (mismo significado semántico — "el usuario verificó su
  // email"). El FLUJO que lo marca en true sigue siendo el propio (tokens de
  // 6 dígitos) hasta que la tarea #18 lo migre a `verification` de better-auth.
  @Column({ type: 'boolean', default: false })
  emailVerified: boolean;

  // No usado hoy por la app (el frontend sigue leyendo `profilePicture`);
  // existe porque better-auth lo espera como campo nativo (avatar de OAuth,
  // futuros flujos de social login, etc.).
  @Column({ type: 'varchar', length: 512, nullable: true })
  image: string | null;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  // --- Dominio (better-auth `user.additionalFields`) ---
  // Fase 4 · P7.R: nullable SOLO para la anonimización de una cuenta
  // deshabilitada (Ley 21.719). Toda cuenta activa los tiene: el alta los
  // exige (DTOs y `additionalFields` requeridos de better-auth). Siguen
  // únicos (dos NULL no chocan en Postgres).
  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  rut: string | null;

  @Column({ type: 'varchar', length: 15, nullable: true, unique: true })
  phone: string | null;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  profilePicture: string | null;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt: Date;

  /**
   * Fase 4 · P7.R (Ley 21.719): cuándo se anonimizó la cuenta deshabilitada
   * (nombre "Usuario eliminado", email no entregable, RUT, teléfono, edad
   * y fotos a null, credenciales y sesiones borradas). Las FK quedan
   * intactas. Una cuenta anonimizada no se vuelve a habilitar.
   */
  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt: Date | null;

  @ManyToMany(() => Role, (role) => role.users, { eager: true })
  @JoinTable()
  roles: Role[];

  @OneToMany(() => Token, (token) => token.user)
  tokens: Token[];

  @ManyToOne(() => Family, (family) => family.members, { nullable: true })
  family: Family | null;
}
