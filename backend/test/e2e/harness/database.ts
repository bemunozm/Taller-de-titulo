import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { isLoopbackHost } from '../../../src/config/env.validation';
import { BACKEND_DOTENV } from './paths';
import type { E2eDatabaseConfig } from './run-state';

/**
 * Postgres de los e2e (Fase 4 · P8). El harness se conecta al SERVIDOR (en CI,
 * el service `postgres:15`; en local, el contenedor `vigilia_postgres`), crea
 * una BD única por corrida, la migra y la borra al final. Nunca toca otra BD.
 * Fase 4 · P9: solo en un servidor local (ver `assertLocalTestDatabaseHost`).
 */
export interface PgServerConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** BD de mantenimiento a la que se conecta para CREATE/DROP DATABASE. */
  adminDatabase: string;
}

export interface ResolvedPgServer {
  config: PgServerConfig;
  /** De dónde salió la conexión (para el mensaje de error). */
  source: 'E2E_DATABASE_URL' | 'DB_* del entorno' | 'backend/.env';
}

const DEFAULT_ADMIN_DATABASE = 'postgres';
const DB_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD'] as const;

/** Prefijo de las BDs que crea el harness: el DROP solo acepta estos nombres. */
export const E2E_DATABASE_PREFIX = 'vigilia_e2e_';
const E2E_DATABASE_NAME = /^vigilia_e2e_\d+_[0-9a-f]+$/;

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function parsePort(raw: string | undefined, source: string): number {
  if (!present(raw)) {
    return 5432;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Puerto de Postgres inválido en ${source}`);
  }
  return port;
}

function fromDatabaseUrl(raw: string): PgServerConfig {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('E2E_DATABASE_URL no es una URL válida');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(
      'E2E_DATABASE_URL debe ser postgres://usuario:clave@host:puerto/bd',
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return {
    host: url.hostname || 'localhost',
    port: parsePort(url.port, 'E2E_DATABASE_URL'),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    adminDatabase: database || DEFAULT_ADMIN_DATABASE,
  };
}

function fromDbVariables(
  vars: Readonly<Record<string, string | undefined>>,
  adminDatabase: string | undefined,
  source: string,
): PgServerConfig {
  if (!present(vars.DB_USER)) {
    throw new Error(`Falta DB_USER en ${source}`);
  }
  return {
    host: present(vars.DB_HOST) ? vars.DB_HOST : 'localhost',
    port: parsePort(vars.DB_PORT, source),
    user: vars.DB_USER,
    password: vars.DB_PASSWORD ?? '',
    adminDatabase: present(adminDatabase)
      ? adminDatabase
      : DEFAULT_ADMIN_DATABASE,
  };
}

/** `KEY=value` simple (mismo criterio que `scripts/seed-admin.js`). */
export function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (match) {
      env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

export function readBackendDotEnv(): Record<string, string> | null {
  return existsSync(BACKEND_DOTENV)
    ? parseDotEnv(readFileSync(BACKEND_DOTENV, 'utf8'))
    : null;
}

/**
 * Variable que permite, a propósito, crear y borrar las BDs de prueba en un
 * Postgres que no es local (ver `assertLocalTestDatabaseHost`).
 */
export const ALLOW_REMOTE_TEST_DB_VARIABLE = 'VIGILIA_ALLOW_REMOTE_TEST_DB';

/**
 * ¿`host` es una conexión local? Loopback (`localhost`, `127.0.0.0/8`, `::1`)
 * o el directorio de un socket Unix (ruta absoluta, como acepta `pg`).
 */
export function isLocalPgHost(host: string): boolean {
  return host.trim().startsWith('/') || isLoopbackHost(host);
}

/**
 * Candado (Fase 4 · P9, corrección cyber BAJO): el harness crea, migra y
 * BORRA bases en el servidor que resuelve `resolvePgServer`. Si
 * `backend/.env` apuntara al Postgres del piloto, lo haría ahí. Se rechaza
 * cualquier host que no sea local, venga de donde venga (también el de
 * `E2E_DATABASE_URL`), salvo con `VIGILIA_ALLOW_REMOTE_TEST_DB=true`. CI usa
 * `localhost`. El mensaje nombra el host, nunca la contraseña.
 */
export function assertLocalTestDatabaseHost(
  host: string,
  source: ResolvedPgServer['source'],
  env: NodeJS.ProcessEnv,
): void {
  if (isLocalPgHost(host)) {
    return;
  }
  if (env[ALLOW_REMOTE_TEST_DB_VARIABLE]?.trim().toLowerCase() === 'true') {
    return;
  }
  throw new Error(
    `El Postgres de los e2e (${source}) apunta a "${host}", que no es local (localhost, 127.0.0.0/8 o ::1). ` +
      'El harness crea, migra y borra bases ahí: si es el Postgres del piloto, lo haría en el piloto. ' +
      `Usa un Postgres local o, si de verdad quieres uno remoto, define ${ALLOW_REMOTE_TEST_DB_VARIABLE}=true.`,
  );
}

/**
 * Servidor Postgres de la corrida, en este orden:
 *  1. `E2E_DATABASE_URL` (la BD del path es solo la de mantenimiento);
 *  2. `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD` del entorno (CI);
 *  3. las mismas del `backend/.env` (comodidad en local). De ese archivo
 *     solo se usa la conexión: la app de prueba nunca lo lee.
 * `E2E_ADMIN_DATABASE` cambia la BD de mantenimiento (default `postgres`).
 * El host debe ser local (ver `assertLocalTestDatabaseHost`).
 */
export function resolvePgServer(
  env: NodeJS.ProcessEnv,
  readDotEnv: () => Record<string, string> | null = readBackendDotEnv,
): ResolvedPgServer {
  const resolved = resolvePgServerSource(env, readDotEnv);
  assertLocalTestDatabaseHost(resolved.config.host, resolved.source, env);
  return resolved;
}

function resolvePgServerSource(
  env: NodeJS.ProcessEnv,
  readDotEnv: () => Record<string, string> | null,
): ResolvedPgServer {
  const url = env.E2E_DATABASE_URL;
  if (present(url)) {
    return { config: fromDatabaseUrl(url.trim()), source: 'E2E_DATABASE_URL' };
  }
  if (DB_KEYS.some((key) => present(env[key]))) {
    return {
      config: fromDbVariables(env, env.E2E_ADMIN_DATABASE, 'el entorno'),
      source: 'DB_* del entorno',
    };
  }
  const dotEnv = readDotEnv();
  if (dotEnv && DB_KEYS.some((key) => present(dotEnv[key]))) {
    return {
      config: fromDbVariables(dotEnv, env.E2E_ADMIN_DATABASE, 'backend/.env'),
      source: 'backend/.env',
    };
  }
  throw new Error(
    'No hay Postgres para los e2e: define E2E_DATABASE_URL (postgres://usuario:clave@host:5432/postgres) o DB_HOST/DB_PORT/DB_USER/DB_PASSWORD',
  );
}

/** Nombre único de la BD de una corrida: `vigilia_e2e_<timestamp>_<hex>`. */
export function uniqueDatabaseName(
  now: number = Date.now(),
  suffix: string = randomBytes(3).toString('hex'),
): string {
  const name = `${E2E_DATABASE_PREFIX}${now}_${suffix}`;
  assertE2eDatabaseName(name);
  return name;
}

/** Guarda: el harness solo crea y borra BDs con el formato propio. */
export function assertE2eDatabaseName(name: string): void {
  if (!E2E_DATABASE_NAME.test(name)) {
    throw new Error(
      `Nombre de BD e2e inválido: "${name}" (se esperaba ${E2E_DATABASE_PREFIX}<timestamp>_<hex>)`,
    );
  }
}

export function databaseConfigFor(
  server: PgServerConfig,
  database: string,
): E2eDatabaseConfig {
  return {
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database,
  };
}

const CONNECT_TIMEOUT_MS = 10_000;

async function withAdminClient<T>(
  server: PgServerConfig,
  action: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    host: server.host,
    port: server.port,
    user: server.user,
    password: server.password,
    database: server.adminDatabase,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo conectar a Postgres en ${server.host}:${server.port} (BD ${server.adminDatabase}): ${reason}. ¿Está arriba el contenedor vigilia_postgres o el service de CI?`,
    );
  }
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

export async function createDatabase(
  server: PgServerConfig,
  name: string,
): Promise<void> {
  assertE2eDatabaseName(name);
  await withAdminClient(server, async (client) => {
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

/** Borra la BD de la corrida aunque el backend siga conectado (`FORCE`, PG ≥ 13). */
export async function dropDatabase(
  server: PgServerConfig,
  name: string,
): Promise<void> {
  assertE2eDatabaseName(name);
  await withAdminClient(server, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}
