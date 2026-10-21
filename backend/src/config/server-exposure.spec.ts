import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_LISTEN_HOST,
  envSchema,
  envWarnings,
  isLoopbackHost,
  parseListenHost,
  validateEnv,
  type ValidatedEnv,
} from './env.validation';
import { isSwaggerEnabled, trustProxyExposureWarning } from './server-exposure';

const validKey = Buffer.alloc(32, 7).toString('base64');

function validEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    DB_HOST: 'localhost',
    DB_PORT: '5455',
    DB_USER: 'vigilia',
    DB_PASSWORD: 'k3Jf92mQpZ8xLw1Rt5Nb',
    DB_NAME: 'vigilia',
    BETTER_AUTH_SECRET: 'pT7vQ2xLm9Zk4Rj8Wc3Yb6Nd1Hs5Fg0AeUi',
    CAMERAS_ENCRYPTION_KEY: validKey,
    FRONTEND_URL: 'http://localhost:5173',
    ...overrides,
  };
}

function captureError(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('se esperaba un error');
}

/**
 * Fase 4 · P9 (cyber MEDIO): HOST configurable. Default 0.0.0.0 (el hub y el
 * LPR llegan por la LAN); con TRUST_PROXY activo y una interfaz no loopback,
 * advertencia al arrancar.
 */
describe('HOST (Fase 4 · P9)', () => {
  it.each([
    '0.0.0.0',
    '127.0.0.1',
    '::',
    '::1',
    '192.168.1.20',
    'fe80::1',
    'localhost',
    'vigilia-backend',
    'api.condominio.cl',
    ' 127.0.0.1 ',
    '',
  ])('acepta HOST=%p', (value) => {
    expect(() => validateEnv(validEnv({ HOST: value }))).not.toThrow();
  });

  it.each([
    '[::1]',
    'http://0.0.0.0',
    '127.0.0.1:3000',
    '0.0.0.0/0',
    'host con espacios',
    '-inicio.cl',
    'a'.repeat(64),
    'evil.com;rm -rf',
  ])('rechaza HOST=%p sin imprimir el valor', (value) => {
    const message = captureError(() => validateEnv(validEnv({ HOST: value })));
    expect(message).toMatch(/HOST: debe ser una IP/);
  });

  it('parseListenHost: default 0.0.0.0, recorta y lanza ante un valor inválido', () => {
    expect(DEFAULT_LISTEN_HOST).toBe('0.0.0.0');
    expect(parseListenHost(undefined)).toBe('0.0.0.0');
    expect(parseListenHost('  ')).toBe('0.0.0.0');
    expect(parseListenHost(' 127.0.0.1 ')).toBe('127.0.0.1');
    expect(parseListenHost('::1')).toBe('::1');
    expect(() => parseListenHost('[::1]')).toThrow(/^HOST: /);
  });
});

describe('isLoopbackHost', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    ' localhost ',
    '127.0.0.1',
    '127.1.2.3',
    '127.255.255.254',
    '::1',
    '0:0:0:0:0:0:0:1',
    '[::1]',
    '::ffff:127.0.0.1',
  ])('%p es loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '::',
    '192.168.1.20',
    '10.0.0.1',
    '128.0.0.1',
    '::2',
    '::ffff:10.0.0.1',
    'localhost.evil.com',
    '127.0.0.1.nip.io',
    'db.ci',
    '',
  ])('%p NO es loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('trustProxyExposureWarning', () => {
  it.each([
    [false, '0.0.0.0'],
    [0, '0.0.0.0'],
    [1, '127.0.0.1'],
    [2, 'localhost'],
    [1, '::1'],
  ] as const)('TRUST_PROXY=%p y HOST=%p: sin advertencia', (trust, host) => {
    expect(trustProxyExposureWarning(trust, host)).toBeNull();
  });

  it.each([
    [1, '0.0.0.0'],
    [1, '::'],
    [2, '192.168.1.20'],
  ] as const)(
    'TRUST_PROXY=%p y HOST=%p: advierte firewall o HOST=127.0.0.1',
    (trust, host) => {
      const warning = trustProxyExposureWarning(trust, host);
      expect(warning).toContain(
        'con TRUST_PROXY activo el puerto debe ser accesible solo desde el proxy (firewall) o usar HOST=127.0.0.1',
      );
      expect(warning).toContain(`HOST=${host}`);
      expect(warning).toContain('X-Forwarded-For');
    },
  );
});

/** Fase 4 · P9 (cyber INFO): Swagger UI fuera de producción. */
describe('SWAGGER_ENABLED / isSwaggerEnabled (Fase 4 · P9)', () => {
  it.each([
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }, true],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' }, false],
    [{ NODE_ENV: 'production', SWAGGER_ENABLED: ' ' }, false],
    [{}, true],
    [{ NODE_ENV: 'development' }, true],
    [{ NODE_ENV: 'test' }, true],
    [{ NODE_ENV: 'development', SWAGGER_ENABLED: 'false' }, false],
  ])('%p -> %p', (env, expected) => {
    expect(isSwaggerEnabled(env)).toBe(expected);
  });

  it('un valor que no es true/false lanza (fail-closed)', () => {
    expect(() =>
      isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: 'si' }),
    ).toThrow(/SWAGGER_ENABLED/);
  });

  it('validateEnv lo valida como booleano', () => {
    expect(() =>
      validateEnv(validEnv({ SWAGGER_ENABLED: 'true' })),
    ).not.toThrow();
    expect(() => validateEnv(validEnv({ SWAGGER_ENABLED: 'yes' }))).toThrow(
      /SWAGGER_ENABLED: debe ser "true" o "false"/,
    );
  });
});

/**
 * Fase 4 · P9 (cyber BAJO): fuera de producción con URLs https, advertencia
 * (no error): las cookies salen igual con `Secure`, pero falta
 * NODE_ENV=production.
 */
describe('envWarnings / advertencias de validateEnv (Fase 4 · P9)', () => {
  function parsed(overrides: Record<string, unknown>): ValidatedEnv {
    return envSchema.parse(validEnv(overrides));
  }

  it('desarrollo en http: sin advertencias', () => {
    expect(envWarnings(parsed({ NODE_ENV: 'development' }))).toEqual([]);
  });

  it('producción con https: sin advertencias', () => {
    expect(
      envWarnings(
        parsed({
          NODE_ENV: 'production',
          BETTER_AUTH_URL: 'https://api.vigilia.cl',
          FRONTEND_URL: 'https://app.vigilia.cl',
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    [{ BETTER_AUTH_URL: 'https://api.vigilia.cl' }, 'BETTER_AUTH_URL usa'],
    [{ FRONTEND_URL: 'https://app.vigilia.cl' }, 'FRONTEND_URL usa'],
    [
      {
        BETTER_AUTH_URL: 'https://api.vigilia.cl',
        FRONTEND_URL: 'https://app.vigilia.cl',
        NODE_ENV: 'development',
      },
      'BETTER_AUTH_URL y FRONTEND_URL usa',
    ],
  ])('sin NODE_ENV=production y %p: advierte', (overrides, fragment) => {
    const warnings = envWarnings(parsed(overrides));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(fragment);
    expect(warnings[0]).toContain('NODE_ENV=production');
    // Nunca imprime los valores.
    expect(warnings[0]).not.toContain('vigilia.cl');
  });

  it('validateEnv loguea la advertencia y NO detiene el arranque', () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const env = validEnv({ BETTER_AUTH_URL: 'https://api.vigilia.cl' });
      expect(validateEnv(env)).toBe(env);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('NODE_ENV no es "production"'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * Fase 4 · P9 (QA BAJO): toda variable que valida `validateEnv`, y las
 * opcionales que se leen directo de `process.env`, aparecen (al menos
 * comentadas) en backend/.env.example.
 */
describe('backend/.env.example', () => {
  const example = readFileSync(
    join(__dirname, '..', '..', '.env.example'),
    'utf8',
  );

  it.each([
    ...Object.keys(envSchema.shape),
    'PORT',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_USER',
    'SMTP_PASS',
    'OPENAI_API_KEY',
    'AGENT_MODEL_PROVIDER',
    'AGENT_MODEL_ID',
    'MEDIAMTX_CONTROL_URL',
    'MEDIAMTX_CONTROL_API_BASE',
    'MEDIAMTX_REQUEST_TIMEOUT_MS',
    'MEDIAMTX_MAX_ATTEMPTS',
    'MEDIAMTX_BACKOFF_BASE_MS',
    'CAMERAS_STRICT_REGISTRATION',
    'WORKER_MANAGER_TIMEOUT',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ])('documenta %s', (name) => {
    expect(example).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
  });
});
