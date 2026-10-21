/**
 * Seed de usuario Super Administrador para desarrollo.
 *
 * Uso:
 *   node scripts/seed-admin.js <email> <password> [nombre] [rut] [phone]
 *
 * Idempotente: si el email ya existe, actualiza la contraseña (cuenta
 * `credential` de better-auth) + emailVerified y
 * asegura el rol Super Administrador.
 * Usa el mismo hashing que el backend (bcrypt, 10 rounds).
 *
 * Config de la BD (Fase 4 · P8): si el entorno define alguna variable `DB_*`
 * (CI, e2e, `DB_NAME=otra_bd node scripts/seed-admin.js ...`), se usan SOLO
 * las del entorno; si no, las de backend/.env (uso de siempre en desarrollo).
 * Nunca mezcla las dos fuentes.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

const DB_ENV_KEYS = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

// --- parse .env (simple key=value) ---
function loadDotEnv(envPath = path.resolve(__dirname, '..', '.env')) {
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `No hay variables DB_* en el entorno ni existe ${envPath}: define DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y DB_NAME`,
    );
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function isPresent(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Config de conexión: del entorno si define alguna `DB_*`, si no del `.env`
 * (`readDotEnv`, perezoso: no se lee el archivo si no hace falta). Exige
 * `DB_USER` y `DB_NAME` (nunca cae en defaults de `pg` como el usuario del SO).
 */
function resolveDbConfig(processEnv, readDotEnv) {
  const fromProcessEnv = DB_ENV_KEYS.some((key) => isPresent(processEnv[key]));
  const env = fromProcessEnv ? processEnv : readDotEnv();
  const source = fromProcessEnv ? 'el entorno' : 'backend/.env';
  const missing = ['DB_USER', 'DB_NAME'].filter((key) => !isPresent(env[key]));
  if (missing.length > 0) {
    throw new Error(`Faltan ${missing.join(', ')} en ${source}`);
  }
  const port = isPresent(env.DB_PORT) ? Number(env.DB_PORT) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`DB_PORT inválido en ${source}`);
  }
  return {
    source,
    connection: {
      host: isPresent(env.DB_HOST) ? env.DB_HOST : 'localhost',
      port,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    },
  };
}

async function main() {
  const [email, password, name = 'Administrador', rut = '11111111-1', phone = '+56999999999', ageArg = '30'] = process.argv.slice(2);
  const age = parseInt(ageArg, 10) || 30; // el frontend exige age numerico (no null), igual que RegisterDto
  if (!email || !password) {
    console.error('Uso: node scripts/seed-admin.js <email> <password> [nombre] [rut] [phone]');
    process.exit(1);
  }

  const { connection } = resolveDbConfig(process.env, () => loadDotEnv());
  const client = new Client(connection);
  await client.connect();

  try {
    const emailLc = email.toLowerCase();
    const hash = await bcrypt.hash(password, 10);

    // rol Super Administrador
    const roleRes = await client.query(
      `SELECT id FROM role WHERE name ILIKE '%Super Admin%' LIMIT 1`,
    );
    if (roleRes.rowCount === 0) throw new Error('No existe el rol Super Administrador (¿corriste el backend para sembrar roles?)');
    const roleId = roleRes.rows[0].id;

    // upsert user por email
    const existing = await client.query(`SELECT id FROM "user" WHERE email = $1`, [emailLc]);
    let userId;
    if (existing.rowCount > 0) {
      userId = existing.rows[0].id;
      await client.query(
        `UPDATE "user" SET "emailVerified" = true, name = $1, "updatedAt" = now() WHERE id = $2`,
        [name, userId],
      );
      console.log(`Usuario existente actualizado: ${emailLc} (${userId})`);
    } else {
      const ins = await client.query(
        `INSERT INTO "user" (rut, name, email, phone, "emailVerified", age)
         VALUES ($1, $2, $3, $4, true, $5) RETURNING id`,
        [rut, name, emailLc, phone, age],
      );
      userId = ins.rows[0].id;
      console.log(`Usuario creado: ${emailLc} (${userId})`);
    }

    // asegurar rol (idempotente)
    await client.query(
      `INSERT INTO user_roles_role ("userId", "roleId") VALUES ($1, $2)
       ON CONFLICT ("userId", "roleId") DO NOTHING`,
      [userId, roleId],
    );

    // Cuenta better-auth (provider 'credential'): es la ÚNICA credencial de
    // login (la columna `user.password` se eliminó en la Fase 4 · P2).
    // accountId = userId para el provider credential. No hay unique
    // (userId, providerId) → upsert manual.
    const acct = await client.query(
      `SELECT id FROM account WHERE "userId" = $1 AND "providerId" = 'credential' LIMIT 1`,
      [userId],
    );
    if (acct.rowCount > 0) {
      await client.query(`UPDATE account SET password = $1, "updatedAt" = now() WHERE id = $2`, [hash, acct.rows[0].id]);
    } else {
      await client.query(
        `INSERT INTO account ("accountId", "providerId", "userId", password, "updatedAt")
         VALUES ($1, 'credential', $2, $3, now())`,
        [userId, userId, hash],
      );
    }

    console.log(`Rol Super Administrador + cuenta better-auth listos. Login: ${emailLc}`);
  } finally {
    await client.end();
  }
}

module.exports = { resolveDbConfig, loadDotEnv };

// Solo como CLI: un test que importa `resolveDbConfig` no debe ejecutar el seed.
if (require.main === module) {
  main().catch((e) => {
    console.error('Error en seed-admin:', e.message);
    process.exit(1);
  });
}
