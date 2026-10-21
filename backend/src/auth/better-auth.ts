// IMPORTANTE: este módulo construye el `pg.Pool` de better-auth a nivel de
// import (side-effect síncrono). Los imports de ES/CJS se resuelven ANTES de
// que corra el cuerpo de app.module.ts (donde vive `ConfigModule.forRoot()`),
// así que NO podemos depender de que @nestjs/config ya haya cargado el .env
// en process.env para ese entonces. Cargamos dotenv acá directamente para que
// este archivo sea autosuficiente (mismo patrón que usan los configs standalone
// de TypeORM CLI / better-auth CLI).
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { APIError, BASE_ERROR_CODES, betterAuth } from 'better-auth';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import { organization } from 'better-auth/plugins/organization';
import { customSession } from 'better-auth/plugins/custom-session';
import { apiKey } from '@better-auth/api-key';
import { Pool } from 'pg';
import * as nodemailer from 'nodemailer';
import { hashPassword, checkPassword } from './utils/auth.util';
import { CLIENT_IP_HEADER } from './middleware/client-ip.middleware';
import { PASSWORD_RESET_SESSION_POLICY } from './password-reset.policy';
import { shouldUseSecureCookies } from './secure-cookies.policy';
import {
  BETTER_AUTH_BASE_PATH,
  httpAllowlistPlugin,
} from './better-auth-http-allowlist';
import {
  auditAuthEndpointResult,
  auditSessionCreated,
  auditSessionDeleted,
} from './auth-audit';
import { notifySessionDeleted } from './session-ended-events';
import {
  isSessionCreationAllowed,
  USER_DISABLED_LOOKUP_SQL,
  userDisabledFromRows,
} from './disabled-user-session.policy';
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
 * - **Una sola credencial (Fase 4 · P2, hallazgo A1):** la contraseña vive
 *   SOLO en `account.password` (cuenta `credential` de better-auth). La
 *   columna duplicada `user.password` y el puente que la sincronizaba se
 *   retiraron: `AuthService.checkPassword`/`updateCurrentUserPassword` usan
 *   `auth.api.verifyPassword`/`changePassword`, igual que el endpoint nativo
 *   `/api/auth/change-password`.
 */
// Logger fuera de DI (este módulo se construye antes de que exista el contenedor de Nest).
const logger = new Logger('BetterAuth');

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
const isProduction = process.env.NODE_ENV === 'production';

// Tarea #21 (hardening): en producción, better-auth DEBE montar sobre HTTPS —
// si no, las cookies de sesión con `secure: true` (ver `useSecureCookies`
// abajo) nunca se enviarían de vuelta al backend y el login por sesión
// quedaría roto en silencio. Falla rápido en vez de dejar ese bug a
// descubrirse en producción.
if (isProduction && !backendBaseUrl.startsWith('https://')) {
  throw new Error(
    `BETTER_AUTH_URL debe ser https:// en producción (valor actual: "${backendBaseUrl}"). ` +
      'Sin HTTPS, las cookies de sesión con `secure: true` no se envían y el login por sesión no funciona.',
  );
}

/**
 * Fase 4 · P6.R: ¿el usuario está deshabilitado (soft-delete de
 * `UsersService.disable`)? `null` si no existe. Lo usa el hook
 * `session.create.before` (ver disabled-user-session.policy.ts).
 */
async function lookupUserDisabled(userId: string): Promise<boolean | null> {
  const { rows } = await pool.query<{ deletedAt: Date | null }>(
    USER_DISABLED_LOOKUP_SQL,
    [userId],
  );
  return userDisabledFromRows(rows);
}

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
      port: process.env.SMTP_PORT
        ? parseInt(process.env.SMTP_PORT, 10)
        : undefined,
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
 * romperse por eso — se loguea y sigue ("best effort").
 */
async function sendAuthEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  try {
    await getMailTransporter().sendMail({
      from: 'UpTask <admin@uptask.com>',
      to,
      subject,
      html,
    });
    logger.log(`Email "${subject}" enviado`);
  } catch (error) {
    logger.error(
      `Error enviando email "${subject}"`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}

export const auth = betterAuth({
  basePath: BETTER_AUTH_BASE_PATH,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: backendBaseUrl,
  trustedOrigins: [frontendUrl],
  database: pool,
  // Fase 4 · P4.B: auditoría de login (LOGIN, LOGIN_FAILED, LOGOUT). La
  // lógica vive en auth-audit.ts; acá solo se conectan los hooks.
  // Best-effort: nunca bloquea el login.
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const returned = ctx.context.returned;
      await auditAuthEndpointResult({
        path: ctx.path,
        body: ctx.body,
        headers: ctx.headers,
        request: ctx.request,
        returned,
        failed: isAPIError(returned),
      });
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Fase 4 · P6.R: un usuario deshabilitado (o inexistente) no obtiene
        // sesión. Mismo error que una contraseña incorrecta: el login no
        // revela que la cuenta existe y está deshabilitada; `hooks.after` lo
        // audita como LOGIN_FAILED. Ver disabled-user-session.policy.ts.
        before: async (session) => {
          if (!(await isSessionCreationAllowed(session, lookupUserDisabled))) {
            throw APIError.from(
              'UNAUTHORIZED',
              BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD,
            );
          }
        },
        after: (session, context) => auditSessionCreated(session, context),
      },
      delete: {
        // Fase 4 · P6.R (D13): además de auditar el LOGOUT, avisa al gateway
        // de tiempo real para cortar los sockets de esa sesión (logout,
        // revocación o limpieza de una sesión vencida). Síncrono y sin
        // lanzar: ver session-ended-events.ts.
        after: async (session, context) => {
          notifySessionDeleted(session, context);
          await auditSessionDeleted(session, context);
        },
      },
    },
  },
  // Tarea #21 (docs/modulos/auth-multitenant.md §11+, hardening): sin esto
  // better-auth solo activa el rate-limit por default en producción
  // (`NODE_ENV === 'production'`) — lo forzamos ON siempre (dev incluido)
  // para que el comportamiento sea el mismo en todos los ambientes y no haya
  // sorpresas al desplegar. `storage: 'database'` (tabla `rateLimit`, la crea
  // el CLI de better-auth — correr `npx @better-auth/cli migrate` tras este
  // cambio) en vez de 'memory': sobrevive reinicios/rolling deploys y
  // funciona igual si el backend corre con más de una instancia.
  // `customRules` endurece login (fuerza bruta) por encima del rule especial
  // que ya trae better-auth por default (3 intentos / 10s en /sign-in/email)
  // — la clave del rule es el path RELATIVO a basePath (better-auth le quita
  // `/api/auth` antes de matchear, ver node_modules/better-auth/dist/api/
  // rate-limiter/index.mjs `resolveRateLimitConfig`), NO el path completo.
  rateLimit: {
    enabled: true,
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
    },
  },
  advanced: {
    database: {
      // IDs uuid (gen_random_uuid() en Postgres) para calzar con las FK `uuid`
      // ya existentes en el resto del dominio (ver docstring arriba).
      generateId: 'uuid',
    },
    // Tarea #21 (hardening): `secure: true` explícito en producción, aunque
    // un proxy termine TLS antes del backend. Fase 4 · P9: fijar la opción
    // anula la detección automática de https de better-auth, así que también
    // va ON cuando BETTER_AUTH_URL es https (un servidor sin
    // NODE_ENV=production detrás de https emitía la cookie sin `Secure`). En
    // dev (http://localhost) queda OFF. Ver secure-cookies.policy.ts.
    useSecureCookies: shouldUseSecureCookies(isProduction, backendBaseUrl),
    // Hallazgo M1: better-auth no conoce `trust proxy` de Express y, con su
    // default (`x-forwarded-for`), solo acepta un valor único — detrás de un
    // proxy el rate-limit quedaba sin IP y el cliente podía elegir la suya. La
    // única fuente es `x-client-ip`, que escribe `clientIpHeaderMiddleware`
    // (montado antes del handler de /api/auth en app.module.ts) con `req.ip`,
    // tras borrar los headers de IP que manda el cliente.
    ipAddress: {
      ipAddressHeaders: [CLIENT_IP_HEADER],
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
    // Fase 4 · P2: `revokeSessionsOnPasswordReset: true` — restablecer la
    // contraseña con el token del email cierra todas las sesiones del usuario
    // (ver password-reset.policy.ts).
    ...PASSWORD_RESET_SESSION_POLICY,
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
  },
  // Tarea #18: reemplaza los códigos de 6 dígitos propios de
  // confirm-account/request-code (AuthController) por la verificación nativa
  // de better-auth. `user.emailVerified` es la MISMA columna que ya leía el
  // login legacy (doc §12), así que ambos caminos quedan consistentes.
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const html = buildAccountVerificationEmailHtml(user.name, url);
      await sendAuthEmail(
        user.email,
        '✨ Confirma tu cuenta - Taller de Título',
        html,
      );
    },
    // Reemplaza el "email de bienvenida" que antes disparaba
    // AuthService.confirmAccount tras marcar el Token como usado. A
    // diferencia de la respuesta de `verifyEmail` (que en el caso normal NO
    // trae el usuario, solo `{status: true, user: null}`), este hook SÍ
    // recibe la fila actualizada.
    afterEmailVerification: async (user) => {
      const html = buildWelcomeAfterVerificationEmailHtml(
        user.name,
        frontendUrl,
      );
      await sendAuthEmail(
        user.email,
        '🎉 ¡Cuenta confirmada! - Taller de Título',
        html,
      );
    },
  },
  plugins: [
    // Fase 4 · P4.B (ALTO-1, cyber N2): LISTA BLANCA de la superficie HTTP.
    // Solo `POST /sign-in/email`, `POST /sign-out`, `GET
    // /reset-password/:token` y `GET /verify-email` responden por HTTP; el
    // resto (core, organization, apiKey y cualquier endpoint nuevo) da 404.
    // Va PRIMERO: los `onRequest` corren en orden. Las llamadas `auth.api.*`
    // del servidor no pasan por acá. Ver better-auth-http-allowlist.ts.
    httpAllowlistPlugin(BETTER_AUTH_BASE_PATH),
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
    // "Metadata is disabled" (400, METADATA_DISABLED). La metadata NO
    // autoriza nada: el condominio va en `permissions` (server-only).
    // El límite por key (`rateLimit`) conserva el default del plugin; las
    // keys del LPR se emiten con `rateLimitEnabled: false` (ver AuthService).
    // Los endpoints de cliente `/api-key/*` no responden por HTTP (lista
    // blanca, primer plugin): las keys las emite y revoca el backend.
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

      const rolesById = new Map<
        string,
        { id: string; name: string; permissions: string[] }
      >();
      for (const row of rows) {
        if (!rolesById.has(row.role_id)) {
          rolesById.set(row.role_id, {
            id: row.role_id,
            name: row.role_name,
            permissions: [],
          });
        }
        if (row.permission_name) {
          rolesById.get(row.role_id)!.permissions.push(row.permission_name);
        }
      }
      const roles = Array.from(rolesById.values());
      const permissions = Array.from(
        new Set(roles.flatMap((r) => r.permissions)),
      );

      return {
        user: { ...user, roles, permissions },
        session,
      };
    }),
  ],
});
