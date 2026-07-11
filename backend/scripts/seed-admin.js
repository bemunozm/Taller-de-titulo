/**
 * Seed de usuario Super Administrador para desarrollo.
 *
 * Uso:
 *   node scripts/seed-admin.js <email> <password> [nombre] [rut] [phone]
 *
 * Idempotente: si el email ya existe, actualiza password + emailVerified y
 * asegura el rol Super Administrador. Lee la config de DB desde backend/.env.
 * Usa el mismo hashing que el backend (bcrypt, 10 rounds).
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Client } = require('pg');

// --- parse .env (simple key=value) ---
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
  const [email, password, name = 'Administrador', rut = '11111111-1', phone = '+56999999999', ageArg = '30'] = process.argv.slice(2);
  const age = parseInt(ageArg, 10) || 30; // el frontend exige age numerico (no null), igual que RegisterDto
  if (!email || !password) {
    console.error('Uso: node scripts/seed-admin.js <email> <password> [nombre] [rut] [phone]');
    process.exit(1);
  }

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
        `UPDATE "user" SET password = $1, "emailVerified" = true, name = $2, "updatedAt" = now() WHERE id = $3`,
        [hash, name, userId],
      );
      console.log(`Usuario existente actualizado: ${emailLc} (${userId})`);
    } else {
      const ins = await client.query(
        `INSERT INTO "user" (rut, name, email, phone, password, "emailVerified", age)
         VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
        [rut, name, emailLc, phone, hash, age],
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

    console.log(`Rol Super Administrador asignado. Listo para login: ${emailLc}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('Error en seed-admin:', e.message);
  process.exit(1);
});
