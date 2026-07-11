/**
 * Crea (si no existe) el schema Postgres dedicado a better-auth: `better_auth`.
 *
 * Ver src/auth/better-auth.ts para el porqué del schema separado (evitar
 * colisión con la tabla `user` de TypeORM en `public`).
 *
 * Debe correrse UNA VEZ antes de `npx @better-auth/cli generate|migrate`,
 * porque Postgres no crea el schema solo al migrar (si no existe, las tablas
 * "sin schema" caen silenciosamente en `public` por el search_path).
 *
 * Uso:
 *   node scripts/create-better-auth-schema.js
 *
 * Lee la config de DB desde backend/.env (mismo patrón que seed-admin.js).
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const client = new Client({
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });

  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS better_auth;');
    console.log('Schema "better_auth" listo (creado o ya existía).');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Error creando el schema better_auth:', err);
  process.exit(1);
});
