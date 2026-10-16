#!/usr/bin/env node
'use strict';
/**
 * Helper de scripts/gate.sh (Fase 4 · P8.C): crea y borra la BD TEMPORAL en la
 * que el gate corre `migration:run` + `migration:check`. Nunca toca la BD de
 * desarrollo (DB_NAME se ignora): solo crea y borra bases `vigilia_gate_*`.
 *
 *   node scripts/gate-db.cjs create          imprime el nombre de la BD creada
 *   node scripts/gate-db.cjs drop <nombre>   la borra (WITH (FORCE), PG >= 13)
 *
 * Conexión: DB_HOST, DB_PORT, DB_USER y DB_PASSWORD del entorno o, si faltan,
 * de backend/.env (el entorno gana, igual que en src/database/data-source.ts).
 * Se conecta a la BD de mantenimiento `postgres` (o GATE_DB_MAINTENANCE_DB).
 * Usa `pg` y `dotenv` de backend/node_modules: no agrega dependencias.
 *
 * Candado (Fase 4 · P9): solo trabaja contra un Postgres LOCAL (localhost,
 * 127.0.0.0/8, ::1 o un socket Unix). Si backend/.env apuntara al Postgres
 * del piloto, crearía y borraría bases ahí. Para un servidor remoto a
 * propósito: VIGILIA_ALLOW_REMOTE_TEST_DB=true.
 *
 * Salida: 0 ok · 3 Postgres no disponible (el gate lo marca SKIP) · 4 host no
 * local (el gate lo marca FAIL) · 1 otro error. Nunca imprime la contraseña.
 */
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const BACKEND_DIR = path.resolve(__dirname, '..', 'backend');
const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));

const TEMP_DB_PATTERN = /^vigilia_gate_[a-z0-9_]{1,40}$/;
const EXIT_ERROR = 1;
const EXIT_UNAVAILABLE = 3;
const EXIT_REMOTE_HOST = 4;
const CONNECT_TIMEOUT_MS = 3000;
const ALLOW_REMOTE_VARIABLE = 'VIGILIA_ALLOW_REMOTE_TEST_DB';

class PostgresUnavailableError extends Error {}
class RemoteHostError extends Error {}

/**
 * ¿`rawHost` es local? `localhost`, 127.0.0.0/8, ::1 (también ::ffff:127.x y
 * entre corchetes) o un socket Unix (ruta absoluta). Sin resolver DNS. Mismo
 * criterio que `isLoopbackHost` (backend/src/config/env.validation.ts).
 */
function isLocalHost(rawHost) {
  const host = String(rawHost).trim().toLowerCase();
  if (host.startsWith('/')) {
    return true;
  }
  const bare = host.replace(/^\[(.*)\]$/, '$1');
  if (bare === 'localhost') {
    return true;
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare);
  const candidate = mapped ? mapped[1] : bare;
  const family = net.isIP(candidate);
  if (family === 4) {
    return candidate.startsWith('127.');
  }
  if (family === 6) {
    return new URL(`http://[${candidate}]`).hostname === '[::1]';
  }
  return false;
}

/** Host de la conexión (el mismo default que `withMaintenanceClient`). */
function targetHost(env) {
  return env.DB_HOST || 'localhost';
}

/** Lanza `RemoteHostError` si el host no es local y no se permitió a propósito. */
function assertLocalHost(env) {
  const host = targetHost(env);
  if (isLocalHost(host)) {
    return;
  }
  if (String(env[ALLOW_REMOTE_VARIABLE] || '').trim().toLowerCase() === 'true') {
    return;
  }
  throw new RemoteHostError(
    `DB_HOST "${host}" no es local (localhost, 127.0.0.0/8 o ::1): el gate crea y borra bases ahí. ` +
      `Usa un Postgres local o define ${ALLOW_REMOTE_VARIABLE}=true si de verdad quieres uno remoto.`,
  );
}

function loadBackendEnv() {
  try {
    backendRequire('dotenv').config({ path: path.join(BACKEND_DIR, '.env'), quiet: true });
  } catch {
    // Sin backend/node_modules: solo cuenta el entorno.
  }
}

function describeTarget() {
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const user = process.env.DB_USER || '(sin DB_USER)';
  return `${user}@${host}:${port}`;
}

/** `localhost` prueba ::1 y 127.0.0.1: Node lanza un AggregateError sin mensaje. */
function describeConnectError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const code = 'code' in error && error.code ? String(error.code) : '';
  const inner = Array.isArray(error.errors)
    ? error.errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ')
    : '';
  return [code, error.message || inner].filter(Boolean).join(' ');
}

async function withMaintenanceClient(work) {
  let Client;
  try {
    ({ Client } = backendRequire('pg'));
  } catch {
    throw new PostgresUnavailableError(
      'no se encontró `pg` en backend/node_modules (corre `npm --prefix backend ci`)',
    );
  }
  const port = Number.parseInt(process.env.DB_PORT || '5432', 10);
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number.isNaN(port) ? 5432 : port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.GATE_DB_MAINTENANCE_DB || 'postgres',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  // Un error de socket tardío no debe tumbar el proceso sin mensaje.
  client.on('error', () => undefined);
  try {
    await client.connect();
  } catch (error) {
    throw new PostgresUnavailableError(`${describeTarget()}: ${describeConnectError(error)}`);
  }
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function newTempDbName() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `vigilia_gate_${stamp}_${crypto.randomBytes(3).toString('hex')}`;
}

async function create() {
  const name = newTempDbName();
  await withMaintenanceClient((client) => client.query(`CREATE DATABASE "${name}"`));
  process.stdout.write(`${name}\n`);
}

async function drop(name) {
  if (!TEMP_DB_PATTERN.test(name || '')) {
    throw new Error(`nombre inválido: solo se borran bases vigilia_gate_* (recibido: ${name})`);
  }
  await withMaintenanceClient((client) =>
    client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
  );
}

async function main() {
  loadBackendEnv();
  const [command, argument] = process.argv.slice(2);
  if (command !== 'create' && command !== 'drop') {
    throw new Error('uso: node scripts/gate-db.cjs create | drop <nombre>');
  }
  assertLocalHost(process.env);
  if (command === 'create') {
    await create();
  } else {
    await drop(argument);
  }
}

/** Código de salida de un error (ver la cabecera). */
function exitCodeFor(error) {
  if (error instanceof PostgresUnavailableError) {
    return EXIT_UNAVAILABLE;
  }
  if (error instanceof RemoteHostError) {
    return EXIT_REMOTE_HOST;
  }
  return EXIT_ERROR;
}

// Solo como CLI: un test puede importar las funciones sin ejecutar nada.
if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = exitCodeFor(error);
    if (code === EXIT_UNAVAILABLE) {
      process.stderr.write(`gate-db: Postgres no disponible (${message})\n`);
    } else {
      process.stderr.write(`gate-db: ${message}\n`);
    }
    process.exit(code);
  });
}

module.exports = {
  ALLOW_REMOTE_VARIABLE,
  EXIT_REMOTE_HOST,
  EXIT_UNAVAILABLE,
  RemoteHostError,
  assertLocalHost,
  exitCodeFor,
  isLocalHost,
};
