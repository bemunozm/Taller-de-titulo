import { randomBytes } from 'node:crypto';
import type { E2eDatabaseConfig } from './run-state';

/**
 * Env de la app de prueba (Fase 4 · P8), generado en memoria por corrida. Es
 * TODO el entorno de la app: el backend corre con un `cwd` vacío, así que no
 * hereda nada del `backend/.env` de desarrollo.
 *
 * Aislamiento:
 *  - sin `MEDIAMTX_*` ni `WORKER_MANAGER_*` y `CAMERAS_REGISTER_IN_MEDIAMTX=false`;
 *  - OpenAI apunta al servidor falso (`OPENAI_API_BASE_URL` para el token de
 *    voz y `OPENAI_BASE_URL` para los clientes del SDK);
 *  - SMTP apunta a un sumidero local (los emails de activación no salen);
 *  - retención apagada y QR por "SMS" apagado;
 *  - `TRUST_PROXY=1`: cada actor de los tests manda su propia IP en
 *    `X-Forwarded-For` (como detrás del reverse proxy de producción), así los
 *    rate limits por IP de login y de rutas públicas no se cruzan entre tests.
 */
export interface E2eEnvOptions {
  port: number;
  database: E2eDatabaseConfig;
  frontendOrigin: string;
  fakeOpenAiUrl: string;
  smtpHost: string;
  smtpPort: number;
  /** Default `warn`; `E2E_BACKEND_LOG_LEVEL` lo sube para diagnosticar. */
  logLevel?: string;
}

export interface E2eSecrets {
  betterAuthSecret: string;
  camerasEncryptionKey: string;
  openAiApiKey: string;
}

/**
 * Secretos aleatorios válidos: hexadecimal (nunca calza con los patrones de
 * placeholder de `env.validation.ts`) y la llave de cámaras como base64 de 32
 * bytes.
 */
export function generateE2eSecrets(): E2eSecrets {
  return {
    betterAuthSecret: randomBytes(32).toString('hex'),
    camerasEncryptionKey: randomBytes(32).toString('base64'),
    openAiApiKey: `sk-e2e-${randomBytes(16).toString('hex')}`,
  };
}

export function buildE2eEnv(
  options: E2eEnvOptions,
  secrets: E2eSecrets = generateE2eSecrets(),
): Record<string, string> {
  const backendUrl = `http://127.0.0.1:${options.port}`;
  const openAiOrigin = options.fakeOpenAiUrl.replace(/\/+$/, '');
  return {
    NODE_ENV: 'test',
    PORT: String(options.port),
    LOG_LEVEL: options.logLevel ?? 'warn',

    DB_HOST: options.database.host,
    DB_PORT: String(options.database.port),
    DB_USER: options.database.user,
    DB_PASSWORD: options.database.password,
    DB_NAME: options.database.database,
    DB_SYNCHRONIZE: 'false',

    BETTER_AUTH_SECRET: secrets.betterAuthSecret,
    BETTER_AUTH_URL: backendUrl,
    CAMERAS_ENCRYPTION_KEY: secrets.camerasEncryptionKey,
    FRONTEND_URL: options.frontendOrigin,
    TRUST_PROXY: '1',
    // Fase 4 · P9: solo loopback (el harness llama a 127.0.0.1). Con
    // TRUST_PROXY=1 es lo que pide `trustProxyExposureWarning`.
    HOST: '127.0.0.1',

    CAMERAS_REGISTER_IN_MEDIAMTX: 'false',

    OPENAI_API_KEY: secrets.openAiApiKey,
    OPENAI_API_BASE_URL: openAiOrigin,
    OPENAI_BASE_URL: `${openAiOrigin}/v1`,

    SMTP_HOST: options.smtpHost,
    SMTP_PORT: String(options.smtpPort),

    RETENTION_ENABLED: 'false',
    VISITOR_QR_SMS_ENABLED: 'false',
  };
}

/**
 * Variables del proceso padre que el hijo necesita para funcionar (binarios,
 * temporales y, en Windows, `SystemRoot` para la pila de red). Nada más: ni
 * `DB_*`, ni secretos, ni `NODE_OPTIONS` (los hooks de Jest/ts-node no deben
 * llegar a la app compilada).
 */
const INHERITED_KEYS = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
] as const;

export function childProcessEnv(
  appEnv: Record<string, string>,
  parentEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const key of INHERITED_KEYS) {
    const value = parentEnv[key];
    if (value !== undefined) {
      inherited[key] = value;
    }
  }
  return { ...inherited, ...appEnv };
}
