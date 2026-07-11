// IMPORTANTE: este módulo construye el `pg.Pool` de better-auth a nivel de
// import (side-effect síncrono). Los imports de ES/CJS se resuelven ANTES de
// que corra el cuerpo de app.module.ts (donde vive `ConfigModule.forRoot()`),
// así que NO podemos depender de que @nestjs/config ya haya cargado el .env
// en process.env para ese entonces. Cargamos dotenv acá directamente para que
// este archivo sea autosuficiente (mismo patrón que usan los configs standalone
// de TypeORM CLI / better-auth CLI).
import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins/organization';
import { customSession } from 'better-auth/plugins/custom-session';
import { apiKey } from '@better-auth/api-key';
import { Pool } from 'pg';
import { hashPassword, checkPassword } from './utils/auth.util';

/**
 * Auth — Fase 0 "Auth robusta + Multi-tenant" (docs/modulos/auth-multitenant.md).
 * Tarea #16: el `user` de better-auth es la fuente de verdad del modelo de
 * usuario (opción C, sección 4/10 del doc). better-auth sigue montado EN
 * PARALELO al auth propio (JWT + RBAC fino en src/auth/*): el guard global de
 * la librería está deshabilitado (ver app.module.ts, `disableGlobalAuthGuard:
 * true`), así que esto NO reemplaza rutas ni guards todavía (eso es la tarea
 * #17).
 *
 * DECISIÓN DE SCHEMA (revisión tarea #16 — reemplaza el schema dedicado
 * `better_auth` del POC):
 * better-auth y TypeORM comparten el schema `public` y, en particular, LA
 * MISMA tabla física `user` (src/users/entities/user.entity.ts). Se descartó
 * el schema Postgres separado (`better_auth`) del POC porque las relaciones de
 * dominio (roles M:N, family N:1, y las FK de vehicles/visits/notifications/
 * detections/tokens/audit hacia `user`) viven en `public` y son gestionadas
 * por TypeORM — mantenerlas cross-schema no aporta aislamiento real (el
 * tenant/organization es el límite lógico, no el schema de Postgres) y sí
 * agrega fricción (FKs cross-schema, `search_path` no estándar para
 * herramientas/psql, relations de TypeORM más frágiles).
 *
 * Reparto de quién migra qué (evita el bug conocido #6391/#3774 de
 * `modelName` sobre tablas ajenas, ver doc sección 9):
 * - `user`: la crea y gestiona TypeORM (`synchronize: true`), porque la app
 *   necesita sus relaciones (roles, family) y 5+ módulos hacen
 *   `@InjectRepository(User)` directamente (AuthGuard, AuthorizationGuard,
 *   UsersService, etc.). La entidad TypeORM declara TODAS las columnas que
 *   better-auth espera (nativas + additionalFields de abajo), así que
 *   better-auth encuentra la tabla ya compatible y no tiene nada que migrar
 *   ahí.
 * - `session` / `account` / `verification` / `organization` / `member` /
 *   `invitation` / `apikey`: no tienen entidad TypeORM (la app no las
 *   consulta directo); las crea/actualiza el CLI de better-auth:
 *     npx @better-auth/cli migrate
 *   Volver a correrlo cada vez que cambie la config de plugins (mismo
 *   criterio que la skill better-auth-best-practices).
 * - `id`: `advanced.database.generateId: "uuid"` hace que better-auth genere
 *   IDs con `gen_random_uuid()` (ver @better-auth/core/src/utils del paquete),
 *   compatibles con las columnas `uuid` que ya usan las FK existentes
 *   (Token.userId, Vehicle.ownerId, Notification.recipientId, etc.) — así no
 *   hay que tocar esos 5+ módulos dependientes.
 *
 * Riesgo abierto (documentado para #17/#18, ver docs sección 11): `password`
 * sigue siendo una columna legacy fuera del modelo de better-auth (que guarda
 * su propio hash en `account`), y `disableSignUp` no está seteado todavía —
 * `/api/auth/sign-up/email` es alcanzable hoy pero fallará si no llegan
 * `rut`/`phone` (additionalFields requeridos, reflejando las columnas
 * NOT NULL). Cerrar junto con el resto del checklist de seguridad del POC.
 */
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// OJO: baseURL es la URL PROPIA del backend (donde better-auth monta /api/auth),
// NO la URL del frontend. trustedOrigins sí es la URL del frontend (CORS/CSRF).
const backendBaseUrl =
  process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3000}`;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

// Fila cruda que devuelve la query de roles/permisos de customSession (abajo).
interface RolePermissionRow {
  role_id: string;
  role_name: string;
  permission_name: string | null;
}

export const auth = betterAuth({
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: backendBaseUrl,
  trustedOrigins: [frontendUrl],
  database: pool,
  advanced: {
    database: {
      // IDs uuid (gen_random_uuid() en Postgres) para calzar con las FK `uuid`
      // ya existentes en el resto del dominio (ver docstring arriba).
      generateId: 'uuid',
    },
  },
  user: {
    // modelName por defecto ("user") ya apunta a la tabla que crea TypeORM.
    additionalFields: {
      rut: { type: 'string', required: true, unique: true },
      phone: { type: 'string', required: true, unique: true },
      age: { type: 'number', required: false },
      profilePicture: { type: 'string', required: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    // better-auth usa scrypt por defecto. Override a bcrypt reutilizando el
    // mismo hashing que el auth propio (src/auth/utils/auth.util.ts) para
    // mantener compatibilidad futura cuando se reconcilien los modelos de User.
    password: {
      hash: (password) => hashPassword(password),
      verify: ({ hash, password }) => checkPassword(password, hash),
    },
  },
  plugins: [
    // tenant = condominio (decisión cerrada, doc sección 10.4). Sin config
    // adicional por ahora: se deja montado para las fases siguientes.
    organization(),
    // service-token para el worker LPR (decisión cerrada, doc sección 10.3).
    // Sin config adicional por ahora: se deja montado para las fases siguientes.
    apiKey(),
    // Tarea #16, punto 5: inyecta roles + permisos (RBAC fino app-side, tabla
    // Permission/Role via user_roles_role y role_permissions_permission) en la
    // respuesta de /api/auth/get-session, para que la tarea #17 (swap de
    // AuthGuard) los tenga disponibles en `request.user` sin round-trip extra.
    // No se usa acá el ORM/DI de Nest (este archivo se construye antes de que
    // exista el módulo de Nest) — se reusa el mismo `pool` de arriba.
    customSession(async ({ user, session }) => {
      const { rows } = await pool.query<RolePermissionRow>(
        `SELECT r.id AS role_id, r.name AS role_name, p.name AS permission_name
         FROM user_roles_role urr
         INNER JOIN role r ON r.id = urr."roleId"
         LEFT JOIN role_permissions_permission rpp ON rpp."roleId" = r.id
         LEFT JOIN permission p ON p.id = rpp."permissionId"
         WHERE urr."userId" = $1`,
        [user.id],
      );

      const rolesById = new Map<string, { id: string; name: string; permissions: string[] }>();
      for (const row of rows) {
        if (!rolesById.has(row.role_id)) {
          rolesById.set(row.role_id, { id: row.role_id, name: row.role_name, permissions: [] });
        }
        if (row.permission_name) {
          rolesById.get(row.role_id)!.permissions.push(row.permission_name);
        }
      }
      const roles = Array.from(rolesById.values());
      const permissions = Array.from(new Set(roles.flatMap((r) => r.permissions)));

      return {
        user: { ...user, roles, permissions },
        session,
      };
    }),
  ],
});
