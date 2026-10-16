/**
 * Corrida MANUAL del barrido de retención (Fase 4 · P7.R, Ley 21.719).
 * Runbook: src/privacy/README.md.
 *
 * Uso (desde backend/):
 *   node scripts/retention-run.js           # dry-run (por defecto): solo cuenta
 *   node scripts/retention-run.js --apply   # borra/anonimiza de verdad
 *
 * - Levanta el contexto de la app (sin HTTP) con la MISMA configuración del
 *   backend (backend/.env; las variables del entorno tienen prioridad) y
 *   llama a `RetentionService.run()`. Respeta los plazos `RETENTION_*_DAYS` y
 *   `RETENTION_ENABLED` (con false solo corre la limpieza técnica).
 * - `--apply` pisa `RETENTION_DRY_RUN` solo para esta corrida.
 * - Comparte el advisory lock con el cron: si el backend está barriendo en
 *   ese momento, responde "already-running" sin tocar nada.
 * - Imprime el resumen por categoría (solo conteos) y lo deja en la
 *   auditoría (PRIVACY / RETENTION_SWEEP), como la corrida nocturna.
 * - Código de salida 1 si la corrida falló o alguna categoría falló.
 *
 * Carga el fuente TypeScript con ts-node (desarrollo) o, si ts-node no está
 * instalado (producción, sin devDependencies), el build de `dist/` (correr
 * `npm run build` antes).
 */
const path = require('path');
const { Logger } = require('@nestjs/common');

const logger = new Logger('RetentionRun');

const BACKEND_ROOT = path.resolve(__dirname, '..');
// ConfigModule lee `.env` del directorio actual.
process.chdir(BACKEND_ROOT);

function hasTsNode() {
  try {
    require.resolve('ts-node');
    require.resolve('tsconfig-paths');
    return true;
  } catch {
    return false;
  }
}

/** `AppModule` y `RetentionService` del fuente (ts-node) o de `dist/`. */
function loadModules() {
  if (hasTsNode()) {
    const project = path.join(BACKEND_ROOT, 'tsconfig.json');
    require('ts-node').register({ transpileOnly: true, project });
    require('tsconfig-paths').register({
      baseUrl: BACKEND_ROOT,
      paths: { 'src/*': ['src/*'] },
    });
    return {
      AppModule: require(path.join(BACKEND_ROOT, 'src', 'app.module.ts'))
        .AppModule,
      RetentionService: require(
        path.join(BACKEND_ROOT, 'src', 'privacy', 'retention.service.ts'),
      ).RetentionService,
    };
  }
  return {
    AppModule: require(path.join(BACKEND_ROOT, 'dist', 'app.module.js'))
      .AppModule,
    RetentionService: require(
      path.join(BACKEND_ROOT, 'dist', 'privacy', 'retention.service.js'),
    ).RetentionService,
  };
}

function printSummary(summary) {
  const mode = summary.dryRun ? 'DRY-RUN (no se escribió nada)' : 'APLICADA';
  logger.log(`Retención ${mode} · estado: ${summary.status}`);
  if (!summary.personalDataEnabled) {
    logger.warn(
      'RETENTION_ENABLED=false: solo corrió la limpieza técnica (system_logs y better-auth).',
    );
  }
  const rows = Object.entries(summary.categories).map(([category, r]) => ({
    categoria: category,
    accion: r.action,
    dias: r.days ?? 'vencimiento',
    filas: r.rows,
    tope: r.capped ? 'sí (sigue mañana)' : '',
    imagenes_pendientes: r.imagesPending ?? '',
    error: r.error ? 'sí' : '',
  }));
  if (rows.length > 0) {
    console.table(rows);
  }
  logger.log(`Duración: ${summary.durationMs} ms`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { NestFactory } = require('@nestjs/core');
  const { AppModule, RetentionService } = loadModules();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['fatal', 'error', 'warn', 'log'],
  });
  let exitCode = 0;
  try {
    const summary = await app.get(RetentionService).run({ dryRun: !apply });
    printSummary(summary);
    const failedCategory = Object.values(summary.categories).some(
      (result) => result.error,
    );
    if (summary.status !== 'completed' || failedCategory) {
      exitCode = 1;
    }
  } finally {
    await app.close();
  }
  process.exit(exitCode);
}

main().catch((error) => {
  logger.error(
    `La corrida de retención falló: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
