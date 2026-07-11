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
import { apiKey } from '@better-auth/api-key';
import { Pool } from 'pg';
import { hashPassword, checkPassword } from './utils/auth.util';

/**
 * POC de better-auth — Fase 0 "Auth robusta + Multi-tenant".
 * Diseño y decisiones completas: docs/modulos/auth-multitenant.md (raíz del repo).
 *
 * ALCANCE DE ESTE POC (no destructivo):
 * - Monta better-auth (identidad + sesión por cookie httpOnly) EN PARALELO al
 *   auth propio (JWT + RBAC fino en src/auth/*), sin reemplazarlo todavía.
 * - El guard global de la librería queda deshabilitado (ver app.module.ts,
 *   `disableGlobalAuthGuard: true`) para no romper las rutas existentes.
 * - Migración de flujos/guards/modelo de usuario/frontend: fases siguientes
 *   (ver sección 8 del doc de diseño).
 *
 * DECISIÓN DE SCHEMA (evitar colisión con la tabla `user` de TypeORM en `public`):
 * better-auth usa un schema de Postgres dedicado, `better_auth`, en vez de
 * prefijos por tabla (`modelName`). Se logra fijando `search_path=better_auth,public`
 * como parámetro de arranque de la conexión del pool `pg` — así CUALQUIER tabla
 * que better-auth cree (`user`, `session`, `account`, `verification`,
 * `organization`, `member`, `invitation`, `apikey`, ...) queda en `better_auth`,
 * sin tocar `public.user` (TypeORM). Se eligió schema separado sobre `modelName`
 * porque escala mejor: no hay que renombrar tabla por tabla (ni por cada tabla
 * nueva que agregue un plugin futuro) y evita los bugs conocidos de la librería
 * con `modelName` sobre tablas ya existentes (#6391 / #3774, ver doc sección 9).
 *
 * El schema `better_auth` debe existir ANTES de correr las migraciones de
 * better-auth (Postgres no crea el schema solo). Ver:
 *   node scripts/create-better-auth-schema.js
 */
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Startup parameter equivalente a `SET search_path TO better_auth, public`
  // en cada conexión nueva del pool.
  options: '-c search_path=better_auth,public',
});

// OJO: baseURL es la URL PROPIA del backend (donde better-auth monta /api/auth),
// NO la URL del frontend. trustedOrigins sí es la URL del frontend (CORS/CSRF).
const backendBaseUrl =
  process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3000}`;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

export const auth = betterAuth({
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: backendBaseUrl,
  trustedOrigins: [frontendUrl],
  database: pool,
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
  ],
});
