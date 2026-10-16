import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// Utilidad pura (zod + net): valida el env generado ANTES de lanzar la app.
import { validateEnv } from '../../src/config/env.validation';
import { startBackend, runNodeScript } from './harness/backend-process';
import {
  createDatabase,
  databaseConfigFor,
  resolvePgServer,
  uniqueDatabaseName,
} from './harness/database';
import {
  buildE2eEnv,
  childProcessEnv,
  generateE2eSecrets,
} from './harness/e2e-env';
import {
  releaseResources,
  rememberResources,
  takeResources,
  type E2eResources,
} from './harness/e2e-resources';
import { startFakeOpenAiServer } from './harness/fake-openai-server';
import { startFakeSmtpServer } from './harness/fake-smtp-server';
import { findFreePort } from './harness/free-port';
import {
  DIST_DATA_SOURCE,
  DIST_MAIN,
  SEED_ADMIN_SCRIPT,
  TYPEORM_CLI,
} from './harness/paths';
import {
  E2E_STATE_FILE_ENV,
  writeRunState,
  type E2eRunState,
} from './harness/run-state';

/**
 * `globalSetup` de los e2e (Fase 4 · P8, docs/modulos/hardening-pre-piloto.md
 * §2 "Detalle de la P8"):
 *  1. crea una BD limpia (`vigilia_e2e_<timestamp>_<hex>`) y corre
 *     `migration:run` (el DataSource compilado, como `migration:run:prod`);
 *  2. levanta el servidor falso de OpenAI y el sumidero SMTP;
 *  3. arranca la app compilada (`node dist/main.js`) con un env de prueba
 *     generado en memoria, en un puerto libre, y espera a que responda;
 *  4. siembra el primer Super Administrador con `scripts/seed-admin.js`;
 *  5. deja `baseUrl` y credenciales en un JSON temporal
 *     (`VIGILIA_E2E_STATE_FILE`) para los tests.
 * Si algo falla a mitad, libera lo que alcanzó a crear y relanza el error.
 *
 * Variables opcionales: `E2E_DATABASE_URL` (o `DB_*`), `E2E_ADMIN_DATABASE`,
 * `E2E_ARTIFACTS_DIR` (logs; default en el temporal del SO),
 * `E2E_BOOT_TIMEOUT_MS` (default 60000), `E2E_BACKEND_LOG_LEVEL` (default
 * `warn`) y `E2E_KEEP_DATABASE=true`.
 */
const FRONTEND_ORIGIN = 'http://localhost:5173';
const DEFAULT_BOOT_TIMEOUT_MS = 60_000;
const MIGRATIONS_TIMEOUT_MS = 120_000;
const SEED_TIMEOUT_MS = 60_000;

const logger = new Logger('E2E');

function positiveIntegerFrom(
  raw: string | undefined,
  fallback: number,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function assertCompiled(): void {
  const missing = [DIST_MAIN, DIST_DATA_SOURCE, TYPEORM_CLI].filter(
    (file) => !existsSync(file),
  );
  if (missing.length > 0) {
    throw new Error(
      `Faltan archivos para los e2e (${missing.join(', ')}). Compila con \`npm run build\` o usa \`npm run test:e2e\`, que compila antes de correr.`,
    );
  }
}

function artifactsDirFor(runId: string): string {
  const configured = process.env.E2E_ARTIFACTS_DIR?.trim();
  return configured
    ? resolve(configured, runId)
    : join(tmpdir(), 'vigilia-e2e', runId);
}

export async function globalSetup(): Promise<void> {
  assertCompiled();

  const runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const artifactsDir = artifactsDirFor(runId);
  // Directorio de trabajo VACÍO de los hijos: sin `.env` que leer.
  const workDir = join(artifactsDir, 'workdir');
  mkdirSync(workDir, { recursive: true });

  const resources: E2eResources = {
    artifactsDir,
    stateFile: join(artifactsDir, 'state.json'),
    backend: null,
    fakeOpenAi: null,
    fakeSmtp: null,
    pgServer: null,
    databaseName: null,
    keepDatabase: process.env.E2E_KEEP_DATABASE?.trim() === 'true',
    exitGuard: null,
  };
  rememberResources(resources);

  try {
    const { config: pgServer, source } = resolvePgServer(process.env);
    resources.pgServer = pgServer;
    const databaseName = uniqueDatabaseName();
    await createDatabase(pgServer, databaseName);
    resources.databaseName = databaseName;
    logger.log(
      `BD ${databaseName} creada en ${pgServer.host}:${pgServer.port} (conexión desde ${source})`,
    );
    const database = databaseConfigFor(pgServer, databaseName);

    const secrets = generateE2eSecrets();
    const fakeOpenAi = await startFakeOpenAiServer({
      expectedApiKey: secrets.openAiApiKey,
    });
    resources.fakeOpenAi = fakeOpenAi;
    const fakeSmtp = await startFakeSmtpServer();
    resources.fakeSmtp = fakeSmtp;

    const port = await findFreePort();
    const appEnv = buildE2eEnv(
      {
        port,
        database,
        frontendOrigin: FRONTEND_ORIGIN,
        fakeOpenAiUrl: fakeOpenAi.url,
        smtpHost: fakeSmtp.host,
        smtpPort: fakeSmtp.port,
        logLevel: process.env.E2E_BACKEND_LOG_LEVEL?.trim() || undefined,
      },
      secrets,
    );
    validateEnv(appEnv);
    const childEnv = childProcessEnv(appEnv);

    await runNodeScript(TYPEORM_CLI, {
      args: ['migration:run', '-d', DIST_DATA_SOURCE],
      env: childEnv,
      cwd: workDir,
      logFile: join(artifactsDir, 'migrations.log'),
      timeoutMs: MIGRATIONS_TIMEOUT_MS,
      label: 'migration:run',
    });

    const backend = await startBackend({
      entry: DIST_MAIN,
      env: childEnv,
      cwd: workDir,
      port,
      logFile: join(artifactsDir, 'backend.log'),
      bootTimeoutMs: positiveIntegerFrom(
        process.env.E2E_BOOT_TIMEOUT_MS,
        DEFAULT_BOOT_TIMEOUT_MS,
      ),
    });
    resources.backend = backend;
    // Red de seguridad: si Jest termina sin teardown, no queda un backend huérfano.
    resources.exitGuard = () => backend.killNow();
    process.once('exit', resources.exitGuard);

    // Después del arranque: el seed exige el rol que siembra la app.
    const superAdmin = {
      email: 'superadmin.e2e@vigilia.test',
      password: `E2e-${randomBytes(12).toString('hex')}`,
    };
    await runNodeScript(SEED_ADMIN_SCRIPT, {
      args: [
        superAdmin.email,
        superAdmin.password,
        'Super Admin E2E',
        '11111111-1',
        '+56900000000',
      ],
      env: childEnv,
      cwd: workDir,
      logFile: join(artifactsDir, 'seed-admin.log'),
      timeoutMs: SEED_TIMEOUT_MS,
      label: 'el seed del super-admin',
    });

    const state: E2eRunState = {
      version: 1,
      baseUrl: backend.baseUrl,
      port,
      frontendOrigin: FRONTEND_ORIGIN,
      superAdmin,
      database,
      fakeOpenAi: {
        url: fakeOpenAi.url,
        ephemeralToken: fakeOpenAi.ephemeralToken,
      },
      artifactsDir,
      backendLogFile: backend.logFile,
    };
    writeRunState(resources.stateFile, state);
    process.env[E2E_STATE_FILE_ENV] = resources.stateFile;
    logger.log(
      `Backend de prueba listo en ${backend.baseUrl} (logs en ${artifactsDir})`,
    );
  } catch (error) {
    const cleanupErrors = await releaseResources(resources);
    takeResources();
    const reason = error instanceof Error ? error.message : String(error);
    const cleanup =
      cleanupErrors.length > 0
        ? `\nAdemás falló la limpieza:\n  - ${cleanupErrors.join('\n  - ')}`
        : '';
    throw new Error(
      `Falló el setup de los e2e: ${reason}${cleanup}\nArtefactos: ${artifactsDir}`,
    );
  }
}

// Jest exige que el módulo de `globalSetup` exporte la función por defecto.
export default globalSetup;
