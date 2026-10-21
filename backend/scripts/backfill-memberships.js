/**
 * Backfill de membresías de condominio (Fase 4 · P5, D11).
 *
 * Antes de la P5, las cuentas creadas desde la UI (`create-by-admin`) y por
 * `POST /users` no tenían membresía (`member` de better-auth): con el
 * aislamiento por condominio no aparecen en ninguno. Este script deriva la
 * membresía de `user.family.organizationId`. La lógica (y sus tests) vive en
 * src/organization-membership/membership-backfill.ts.
 *
 * Uso (desde backend/):
 *   node scripts/backfill-memberships.js           # dry-run (por defecto): solo reporta
 *   node scripts/backfill-memberships.js --apply   # crea las membresías del plan
 *
 * - Idempotente: correrlo de nuevo no crea nada que ya exista.
 * - No toca a los super-admin.
 * - Reporta (sin tocar) los usuarios sin familia ni membresía y los casos
 *   ambiguos (varias membresías, membresía en otro condominio que el de su
 *   familia, familia sin condominio o con un condominio inexistente).
 * - No correr dos instancias a la vez.
 *
 * Conexión: backend/.env (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME);
 * las variables ya definidas en el entorno tienen prioridad
 * (`DB_NAME=otra_bd node scripts/backfill-memberships.js`).
 */
const path = require('path');
const { Client } = require('pg');
const { Logger } = require('@nestjs/common');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const logger = new Logger('MembershipBackfill');

/**
 * Carga la lógica del backfill: el fuente TypeScript con ts-node (desarrollo)
 * o, si ts-node no está instalado (producción, sin devDependencies), el build
 * de `dist/`.
 */
function loadBackfillModule() {
  const source = path.join(
    BACKEND_ROOT,
    'src',
    'organization-membership',
    'membership-backfill.ts',
  );
  try {
    require('ts-node').register({
      transpileOnly: true,
      skipProject: true,
      compilerOptions: { module: 'commonjs', target: 'es2022' },
    });
    return require(source);
  } catch (error) {
    if (error && error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    return require(
      path.join(
        BACKEND_ROOT,
        'dist',
        'organization-membership',
        'membership-backfill.js',
      ),
    );
  }
}

function loadEnv() {
  require('dotenv').config({ path: path.join(BACKEND_ROOT, '.env') });
  const env = process.env;
  return {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  };
}

function describeUser(user) {
  return `${user.email || '(sin email)'} [${user.userId}]`;
}

function printReport(report) {
  const mode = report.dryRun ? 'DRY-RUN (no se escribió nada)' : 'APLICADO';
  logger.log(`Backfill de membresías: ${mode}`);
  logger.log(`  Ya con membresía coherente: ${report.alreadyMembers}`);
  logger.log(`  Super-admin omitidos: ${report.skippedSuperAdmins}`);
  logger.log(
    `  Membresías ${report.dryRun ? 'a crear' : 'creadas'}: ${report.dryRun ? report.toAdd.length : report.added}`,
  );
  for (const addition of report.toAdd) {
    logger.log(
      `    + ${describeUser(addition)} -> condominio ${addition.organizationId}`,
    );
  }
  if (report.withoutFamily.length > 0) {
    logger.warn(
      `  Sin familia ni membresía (resolver a mano): ${report.withoutFamily.length}`,
    );
    for (const user of report.withoutFamily) {
      logger.warn(`    ? ${describeUser(user)}`);
    }
  }
  if (report.ambiguous.length > 0) {
    logger.warn(`  Casos ambiguos (no se tocaron): ${report.ambiguous.length}`);
    for (const item of report.ambiguous) {
      logger.warn(
        `    ! ${describeUser(item)}: ${item.reason} (familia: ${item.familyOrganizationId ?? 'sin condominio'}; membresías: ${item.membershipOrganizationIds.join(', ') || 'ninguna'})`,
      );
    }
  }
  if (report.dryRun && report.toAdd.length > 0) {
    logger.log(
      'Para crear las membresías: node scripts/backfill-memberships.js --apply',
    );
  }
}

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const { runMembershipBackfill } = loadBackfillModule();

  const client = new Client(loadEnv());
  await client.connect();
  try {
    const db = {
      query: async (sql, params) => (await client.query(sql, [...params])).rows,
    };
    const report = await runMembershipBackfill(db, { apply });
    printReport(report);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(
      'El backfill de membresías falló',
      error && error.stack ? error.stack : String(error),
    );
    process.exit(1);
  });
}

module.exports = { loadBackfillModule, printReport };
