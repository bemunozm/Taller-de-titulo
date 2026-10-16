import {
  parseListenHost,
  parseOpenAiApiBaseUrl,
  parseTrustProxy,
  validateEnv,
} from '../../../src/config/env.validation';
import { trustProxyExposureWarning } from '../../../src/config/server-exposure';
import {
  buildE2eEnv,
  childProcessEnv,
  generateE2eSecrets,
  type E2eEnvOptions,
} from './e2e-env';

/**
 * Pieza unitaria del harness e2e (Fase 4 · P8): el env generado pasa la MISMA
 * validación con la que arranca la app (`validateEnv`) y aísla la app de
 * prueba de MediaMTX, del manager LPR, de OpenAI real y del SMTP real.
 */
describe('buildE2eEnv (harness e2e)', () => {
  const options: E2eEnvOptions = {
    port: 43_210,
    database: {
      host: 'localhost',
      port: 5432,
      user: 'vigilia',
      password: 'k3Jf92mQpZ8xLw1Rt5Nb',
      database: 'vigilia_e2e_1791600000000_abc123',
    },
    frontendOrigin: 'http://localhost:5173',
    fakeOpenAiUrl: 'http://127.0.0.1:45001/',
    smtpHost: '127.0.0.1',
    smtpPort: 45_002,
  };

  it('pasa validateEnv (la validación de arranque de la app)', () => {
    const env = buildE2eEnv(options);

    expect(() => validateEnv(env)).not.toThrow();
  });

  it('es un env de prueba aislado', () => {
    const env = buildE2eEnv(options);

    expect(env).toMatchObject({
      NODE_ENV: 'test',
      PORT: '43210',
      LOG_LEVEL: 'warn',
      DB_NAME: 'vigilia_e2e_1791600000000_abc123',
      DB_SYNCHRONIZE: 'false',
      BETTER_AUTH_URL: 'http://127.0.0.1:43210',
      FRONTEND_URL: 'http://localhost:5173',
      TRUST_PROXY: '1',
      HOST: '127.0.0.1',
      CAMERAS_REGISTER_IN_MEDIAMTX: 'false',
      OPENAI_API_BASE_URL: 'http://127.0.0.1:45001',
      OPENAI_BASE_URL: 'http://127.0.0.1:45001/v1',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '45002',
      RETENTION_ENABLED: 'false',
      VISITOR_QR_SMS_ENABLED: 'false',
    });
    for (const key of [
      'MEDIAMTX_URL',
      'MEDIAMTX_AUTH_SECRET',
      'WORKER_MANAGER_URL',
      'WORKER_MANAGER_SECRET',
      'CLOUDINARY_API_KEY',
      'SMTP_USER',
      'SMTP_PASS',
    ]) {
      expect(env).not.toHaveProperty(key);
    }
    expect(parseOpenAiApiBaseUrl(env.OPENAI_API_BASE_URL)).toBe(
      'http://127.0.0.1:45001',
    );
  });

  it('Fase 4 · P9: escucha solo en loopback, así TRUST_PROXY=1 no deja el puerto expuesto', () => {
    const env = buildE2eEnv(options);

    expect(
      trustProxyExposureWarning(
        parseTrustProxy(env.TRUST_PROXY),
        parseListenHost(env.HOST),
      ),
    ).toBeNull();
  });

  it('respeta un LOG_LEVEL explícito (diagnóstico)', () => {
    expect(buildE2eEnv({ ...options, logLevel: 'debug' }).LOG_LEVEL).toBe(
      'debug',
    );
  });

  it('genera secretos nuevos y válidos en cada corrida', () => {
    const first = generateE2eSecrets();
    const second = generateE2eSecrets();

    expect(first.betterAuthSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(first.camerasEncryptionKey, 'base64')).toHaveLength(32);
    expect(first.openAiApiKey).toMatch(/^sk-e2e-[0-9a-f]{32}$/);
    expect(second.betterAuthSecret).not.toBe(first.betterAuthSecret);
    expect(second.camerasEncryptionKey).not.toBe(first.camerasEncryptionKey);
    expect(second.openAiApiKey).not.toBe(first.openAiApiKey);
  });

  it('usa los secretos que recibe (la key esperada del OpenAI falso)', () => {
    const secrets = generateE2eSecrets();

    const env = buildE2eEnv(options, secrets);

    expect(env.OPENAI_API_KEY).toBe(secrets.openAiApiKey);
    expect(env.BETTER_AUTH_SECRET).toBe(secrets.betterAuthSecret);
    expect(env.CAMERAS_ENCRYPTION_KEY).toBe(secrets.camerasEncryptionKey);
  });
});

describe('childProcessEnv (harness e2e)', () => {
  it('hereda solo lo que el proceso necesita y nunca DB_*, secretos ni NODE_OPTIONS', () => {
    const parent: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      SystemRoot: 'C:\\Windows',
      TEMP: '/tmp',
      DB_NAME: 'vigilia_dev',
      DB_PASSWORD: 'clave-de-desarrollo',
      OPENAI_API_KEY: 'sk-real',
      NODE_OPTIONS: '--require ts-node/register',
      MEDIAMTX_URL: 'http://127.0.0.1:8889',
    };

    const env = childProcessEnv(
      { DB_NAME: 'vigilia_e2e_1_ab', PORT: '1' },
      parent,
    );

    expect(env).toEqual({
      PATH: '/usr/bin',
      SystemRoot: 'C:\\Windows',
      TEMP: '/tmp',
      DB_NAME: 'vigilia_e2e_1_ab',
      PORT: '1',
    });
  });
});
