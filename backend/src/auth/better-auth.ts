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
import * as nodemailer from 'nodemailer';
import { hashPassword, checkPassword } from './utils/auth.util';
import {
  buildAccountVerificationEmailHtml,
  buildOrganizationInvitationEmailHtml,
  buildPasswordResetEmailHtml,
  buildWelcomeAfterVerificationEmailHtml,
} from './templates/better-auth-email.templates';

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
 * Tarea #18 (docs sección 11/12/13, cierre del checklist de seguridad del
 * POC) — auth robusta + cierre de sign-up:
 * - `disableSignUp: true` cierra `/api/auth/sign-up/email` (política
 *   admin-only/invitaciones, doc §7b). Las cuentas nacen por
 *   `UsersService.createAccountByAdmin` (src/users/users.service.ts), que
 *   ahora dispara `auth.api.requestPasswordReset` para que el usuario
 *   establezca su propia contraseña (reusa el flujo `sendResetPassword` de
 *   abajo, con copy distinto para "cuenta nueva" — ver
 *   `buildPasswordResetEmailHtml`).
 * - `emailVerification`/`emailAndPassword.sendResetPassword` reemplazan los
 *   códigos de 6 dígitos propios (tabla `Token`, `src/tokens`) para
 *   confirm-account/forgot-password/reset-password (ver AuthController/
 *   AuthService). La tabla `Token` NO se retira todavía (queda para #21,
 *   otros módulos aún podrían depender de `TokensService`).
 * - **Bridge `user.password` (arista de sincronización, ver RESTRICCIÓN
 *   CRÍTICA de la tarea #18):** el login legacy (`/api/v1/auth/login`, JWT,
 *   AuthService.login) sigue leyendo `user.password` (columna propia), pero
 *   better-auth guarda su hash en `account.password` (tabla separada). Para
 *   que ambos caminos de login sigan viendo la MISMA contraseña tras un
 *   reset/activación vía better-auth, `emailAndPassword.onPasswordReset`
 *   (abajo) copia el hash recién escrito en `account` hacia `user.password`
 *   con una query SQL directa sobre el mismo `pool`. Es el ÚNICO punto de
 *   sincronización cableado hoy (cubre forgot-password, reset-password y la
 *   activación de cuentas nuevas — todos pasan por `resetPassword`).
 *   `databaseHooks.account.create.after` es un segundo bridge, más liviano,
 *   para cualquier OTRO flujo futuro que cree una cuenta credential por fuera
 *   de `resetPassword` (p.ej. invitaciones de organization en #19).
 *   **Limitación transitoria documentada:** `changePassword`/`setPassword`
 *   nativos de better-auth (cambio de password con sesión activa) NO están
 *   expuestos todavía (no hay UI/endpoint que los dispare) y por lo tanto no
 *   tienen bridge propio — si se cablean en una fase futura, agregar su
 *   sincronización aquí también (mismo patrón).
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

/**
 * Transporter de nodemailer construido "a mano" (mismo motivo que el
 * `pg.Pool` de arriba: este archivo no tiene DI de Nest, así que no puede
 * inyectar `MailerService`). Mismos env vars que `MailerModule.forRootAsync`
 * en src/auth/auth.module.ts — se reusa la config SMTP existente, solo que
 * sin pasar por Nest.
 */
let mailTransporter: nodemailer.Transporter | null = null;
function getMailTransporter(): nodemailer.Transporter {
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : undefined,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return mailTransporter;
}

/**
 * Envía un email de los hooks de better-auth. No relanza el error: si SMTP no
 * está configurado (dev) el flujo de auth (verificación/reset) no debe
 * romperse por eso — se loguea y sigue (mismo criterio "best effort" que
 * AuthEmailService, que también atrapa y loguea sin design para dev sin SMTP).
 */
async function sendAuthEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    await getMailTransporter().sendMail({
      from: 'UpTask <admin@uptask.com>',
      to,
      subject,
      html,
    });
    console.log(`[better-auth] Email "${subject}" enviado a ${to}`);
  } catch (error) {
    console.error(`[better-auth] Error enviando email "${subject}" a ${to}:`, error);
  }
}

/**
 * Bridge de sincronización `account.password` (better-auth, hash bcrypt vía
 * el override de arriba) → `user.password` (columna legacy que sigue leyendo
 * el login JWT propio). Ver docstring de la clase para el detalle de cuándo
 * se invoca. Query directa sobre el mismo `pool` — no hay TypeORM disponible
 * en este archivo.
 */
async function syncPasswordToLegacyUserColumn(userId: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ password: string | null }>(
      `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential' LIMIT 1`,
      [userId],
    );
    const hash = rows[0]?.password;
    if (!hash) {
      return;
    }
    await pool.query(`UPDATE "user" SET password = $1 WHERE id = $2`, [hash, userId]);
  } catch (error) {
    // No relanzamos: si el bridge falla, el usuario igual pudo resetear su
    // password vía better-auth (camino nuevo funciona); solo el login legacy
    // quedaría desincronizado hasta el próximo reset. Se loguea para que no
    // pase desapercibido.
    console.error(`[better-auth] Error sincronizando user.password (bridge) para userId=${userId}:`, error);
  }
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
    // Tarea #18 (doc §7b/§11): NADIE se auto-registra. Las cuentas nacen por
    // UsersService.createAccountByAdmin (admin-only) — ver docstring arriba.
    disableSignUp: true,
    // better-auth usa scrypt por defecto. Override a bcrypt reutilizando el
    // mismo hashing que el auth propio (src/auth/utils/auth.util.ts) para
    // mantener compatibilidad futura cuando se reconcilien los modelos de User.
    password: {
      hash: (password) => hashPassword(password),
      verify: ({ hash, password }) => checkPassword(password, hash),
    },
    // Tarea #18: reemplaza el flujo propio de forgot-password/reset-password
    // (tokens de 6 dígitos, tabla Token) — usado tanto por
    // AuthController.forgotPassword como por AuthService.login (cuenta no
    // activada) y UsersService.createAccountByAdmin (activación inicial),
    // todos vía `auth.api.requestPasswordReset`. `isNewAccount` distingue el
    // copy sin necesitar un hook separado (ver template).
    sendResetPassword: async ({ user, url }) => {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM account WHERE "userId" = $1 AND "providerId" = 'credential') AS exists`,
        [user.id],
      );
      const isNewAccount = !rows[0]?.exists;
      const html = buildPasswordResetEmailHtml(user.name, url, isNewAccount);
      const subject = isNewAccount
        ? '🎉 Establece tu contraseña - Taller de Título'
        : '🔐 Restablece tu contraseña - Taller de Título';
      await sendAuthEmail(user.email, subject, html);
    },
    // Bridge user.password (ver docstring de la clase) — se ejecuta luego de
    // que better-auth ya escribió el hash en `account` (create o update,
    // ambos casos), así que una relectura simple alcanza sin importar cuál de
    // los dos caminos internos tomó `resetPassword`.
    onPasswordReset: async ({ user }) => {
      await syncPasswordToLegacyUserColumn(user.id);
    },
  },
  // Tarea #18: reemplaza los códigos de 6 dígitos propios de
  // confirm-account/request-code (AuthController) por la verificación nativa
  // de better-auth. `user.emailVerified` es la MISMA columna que ya leía el
  // login legacy (doc §12), así que ambos caminos quedan consistentes.
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const html = buildAccountVerificationEmailHtml(user.name, url);
      await sendAuthEmail(user.email, '✨ Confirma tu cuenta - Taller de Título', html);
    },
    // Reemplaza el "email de bienvenida" que antes disparaba
    // AuthService.confirmAccount tras marcar el Token como usado. A
    // diferencia de la respuesta de `verifyEmail` (que en el caso normal NO
    // trae el usuario, solo `{status: true, user: null}`), este hook SÍ
    // recibe la fila actualizada.
    afterEmailVerification: async (user) => {
      const html = buildWelcomeAfterVerificationEmailHtml(user.name, frontendUrl);
      await sendAuthEmail(user.email, '🎉 ¡Cuenta confirmada! - Taller de Título', html);
    },
  },
  // Segundo bridge de user.password (ver docstring de la clase): cubre
  // cualquier creación de cuenta `credential` que NO pase por
  // `resetPassword` (p.ej. futuras invitaciones de organization, #19).
  // `created` trae la fila completa (a diferencia de `update`, que en
  // better-auth 1.6.x solo expone el COUNT de filas afectadas — por eso el
  // bridge principal de arriba usa `onPasswordReset` + relectura en vez de
  // `databaseHooks.account.update.after`).
  databaseHooks: {
    account: {
      create: {
        after: async (created: { providerId: string; userId: string; password?: string | null }) => {
          if (created.providerId !== 'credential' || !created.password) {
            return;
          }
          await syncPasswordToLegacyUserColumn(created.userId);
        },
      },
    },
  },
  plugins: [
    // tenant = condominio (decisión cerrada, doc sección 10.4). Tarea #19
    // (doc §7/§7b): la CREACIÓN de organizaciones queda cerrada a nivel de
    // plugin (`allowUserToCreateOrganization: false`) — nadie crea un
    // condominio vía el cliente/API pública de better-auth. Los condominios
    // nacen SOLO por el endpoint super-admin
    // (POST /onboarding/condominiums, OnboardingService.createCondominium),
    // que llama a `auth.api.createOrganization({ body: { userId, ... } })`
    // server-side — esa llamada NO pasa por `allowUserToCreateOrganization`
    // (el check solo aplica a requests de cliente con headers de sesión; ver
    // skill organization-best-practices, sección "Creating Organizations on
    // Behalf of Users").
    //
    // Roles de organización: se usan SOLO como pertenencia/tenant (owner al
    // crear el condominio, member para el resto) — el RBAC fino (79 permisos,
    // AuthorizationGuard, @RequirePermissions) sigue siendo la única fuente
    // de autorización real. No se migran permisos al access-control de
    // better-auth (fuera de alcance de #19).
    organization({
      allowUserToCreateOrganization: false,
      // Cada organización tiene su Admin (owner) + eventualmente conserjes y
      // residentes (member) — límite generoso para un condominio real.
      membershipLimit: 500,
      // No usamos el flujo de invitación (`inviteMember`) como camino
      // primario: `rut`/`phone` son additionalFields REQUERIDOS del `user`
      // (ver docstring de la clase, tarea #16) y la aceptación de invitación
      // nativa de better-auth solo pide contraseña — no hay forma de que el
      // invitado complete esos campos ahí. El camino primario de onboarding
      // (§7b) es creación directa server-side
      // (`UsersService.createAccountByAdmin` + `auth.api.addMember`, ver
      // OnboardingService). Se deja `sendInvitationEmail` configurado de
      // todas formas (plugin completo, por si un flujo futuro sí usa
      // `inviteMember` para reinvitar a alguien que ya tiene cuenta).
      invitationExpiresIn: 60 * 60 * 24 * 7, // 7 días
      sendInvitationEmail: async (data) => {
        const html = buildOrganizationInvitationEmailHtml(
          data.email,
          data.organization.name,
          data.inviter?.user?.name || 'Un administrador',
          `${frontendUrl}/auth/accept-invitation/${data.invitation.id}`,
        );
        await sendAuthEmail(
          data.email,
          `Invitación a ${data.organization.name} - Taller de Título`,
          html,
        );
      },
    }),
    // service-token para el worker LPR (decisión cerrada, doc sección 10.3).
    // `enableMetadata: true` (default es false) porque
    // AuthService.createServiceApiKey guarda `description`/`createdBy` ahí
    // para trazabilidad — sin esto el plugin rechaza la creación con
    // "Metadata is disabled" (400, METADATA_DISABLED).
    apiKey({ enableMetadata: true }),
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
