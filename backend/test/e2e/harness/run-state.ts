import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Estado de una corrida e2e (Fase 4 · P8): lo escribe el `globalSetup` en un
 * JSON temporal y lo leen los tests. La ruta viaja en esta variable de
 * entorno (los workers de Jest heredan el `process.env` del proceso padre).
 */
export const E2E_STATE_FILE_ENV = 'VIGILIA_E2E_STATE_FILE';

/** Conexión a la BD de la corrida (creada y borrada por el harness). */
export interface E2eDatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface E2eCredentials {
  email: string;
  password: string;
}

export interface E2eRunState {
  version: 1;
  /** `http://127.0.0.1:<port>` (sin prefijo). */
  baseUrl: string;
  port: number;
  /** Origen del frontend (`FRONTEND_URL`): va en `Origin` de cada request. */
  frontendOrigin: string;
  superAdmin: E2eCredentials;
  database: E2eDatabaseConfig;
  fakeOpenAi: { url: string; ephemeralToken: string };
  artifactsDir: string;
  backendLogFile: string;
}

export function writeRunState(file: string, state: E2eRunState): void {
  writeFileSync(file, JSON.stringify(state, null, 2), { encoding: 'utf8' });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRunState(value: unknown): value is E2eRunState {
  if (!isRecord(value) || value.version !== 1) {
    return false;
  }
  const { superAdmin, database, fakeOpenAi } = value;
  return (
    typeof value.baseUrl === 'string' &&
    typeof value.port === 'number' &&
    typeof value.frontendOrigin === 'string' &&
    isRecord(superAdmin) &&
    typeof superAdmin.email === 'string' &&
    typeof superAdmin.password === 'string' &&
    isRecord(database) &&
    typeof database.database === 'string' &&
    isRecord(fakeOpenAi) &&
    typeof fakeOpenAi.ephemeralToken === 'string'
  );
}

/** Lee el estado de la corrida; falla claro si se corrió sin el `globalSetup`. */
export function readRunState(
  env: NodeJS.ProcessEnv = process.env,
): E2eRunState {
  const file = env[E2E_STATE_FILE_ENV];
  if (!file) {
    throw new Error(
      `${E2E_STATE_FILE_ENV} no está definida: corre los e2e con \`npm run test:e2e\` (jest --config test/jest-e2e.json), que levanta el backend en el globalSetup`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isRunState(parsed)) {
    throw new Error(`El estado e2e en ${file} no tiene el formato esperado`);
  }
  return parsed;
}
