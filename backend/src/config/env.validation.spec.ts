import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_LPR_PASSAGE_WINDOW_SECONDS,
  DEFAULT_OPENAI_API_BASE_URL,
  DEFAULT_VISIT_APPROVAL_TTL_MINUTES,
  DEFAULT_VISIT_CONCIERGE_VALIDITY_HOURS,
  DEFAULT_VISIT_EXIT_COOLDOWN_MINUTES,
  isPlaceholderValue,
  LOG_LEVEL_VALUES,
  normalizeIp,
  parseBooleanFlag,
  parseLprPassageFuzzySeconds,
  parseLprPassageOrphanSeconds,
  parseLprPassageReverseMinSeconds,
  parseAiVisionDailyCap,
  parseAiVisionRatePerMinute,
  parseLprPassageWindowSeconds,
  parseOpenAiApiBaseUrl,
  parseRetentionDays,
  parseMediamtxAuthAllowedIps,
  parseTrustProxy,
  parseVisitActiveGraceHours,
  parseVisitApprovalTtlMinutes,
  parseVisitConciergeValidityHours,
  parseVisitExitCooldownMinutes,
  RETENTION_PERIODS,
  type RetentionPeriodName,
  validateEnv,
} from './env.validation';
import { LOG_LEVEL_THRESHOLDS } from '../common/logging/log-levels';

const validKey = Buffer.alloc(32, 7).toString('base64');
const STRONG_WORKER_SECRET = 'Wm7Qz2Lp9Xv4Rt8Ks1Nc6Hd3Jf5Gb0YaUe';

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
    FRONTEND_URL: 'https://app.vigilia.test',
    ...overrides,
  };
}

function without(key: string): Record<string, unknown> {
  const env = validEnv();
  delete env[key];
  return env;
}

describe('validateEnv', () => {
  it('acepta una configuración válida y devuelve la config original', () => {
    const env = validEnv({
      TRUST_PROXY: '1',
      DB_SYNCHRONIZE: 'false',
      NODE_ENV: 'production',
    });
    expect(validateEnv(env)).toBe(env);
  });

  it.each([
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'BETTER_AUTH_SECRET',
    'CAMERAS_ENCRYPTION_KEY',
    'FRONTEND_URL',
  ])('rechaza si falta %s y nombra la variable', (key) => {
    expect(() => validateEnv(without(key))).toThrow(key);
  });

  it('rechaza BETTER_AUTH_SECRET de menos de 32 caracteres', () => {
    expect(() =>
      validateEnv(validEnv({ BETTER_AUTH_SECRET: 'corto-pero-real-123' })),
    ).toThrow(/32 caracteres/);
  });

  it('rechaza CAMERAS_ENCRYPTION_KEY que no es base64 de 32 bytes', () => {
    expect(() =>
      validateEnv(
        validEnv({
          CAMERAS_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
        }),
      ),
    ).toThrow(/32 bytes/);
    expect(() =>
      validateEnv(validEnv({ CAMERAS_ENCRYPTION_KEY: 'no es base64 !!!' })),
    ).toThrow(/32 bytes/);
  });

  it('rechaza FRONTEND_URL que no es una URL http(s)', () => {
    expect(() =>
      validateEnv(validEnv({ FRONTEND_URL: 'localhost:5173' })),
    ).toThrow(/FRONTEND_URL/);
  });

  it('rechaza TRUST_PROXY y DB_SYNCHRONIZE con formato inválido', () => {
    expect(() => validateEnv(validEnv({ TRUST_PROXY: 'muchos' }))).toThrow(
      /TRUST_PROXY/,
    );
    expect(() => validateEnv(validEnv({ DB_SYNCHRONIZE: 'yes' }))).toThrow(
      /DB_SYNCHRONIZE/,
    );
  });

  it('rechaza placeholders sin imprimir el valor', () => {
    const placeholder = 'your_database_password';
    let message = '';
    try {
      validateEnv(validEnv({ DB_PASSWORD: placeholder }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DB_PASSWORD');
    expect(message).toContain('placeholder');
    expect(message).not.toContain(placeholder);
  });

  it('rechaza todos los secretos de ejemplo de backend/.env.example', () => {
    const example = readFileSync(
      join(__dirname, '..', '..', '.env.example'),
      'utf8',
    );
    const values = new Map<string, string>();
    for (const line of example.split(/\r?\n/)) {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (match) values.set(match[1], match[2]);
    }
    for (const key of [
      'DB_PASSWORD',
      'BETTER_AUTH_SECRET',
      'CAMERAS_ENCRYPTION_KEY',
      'WORKER_MANAGER_SECRET',
      'MEDIAMTX_AUTH_SECRET',
    ]) {
      const value = values.get(key);
      expect(value).toBeTruthy();
      expect(() =>
        validateEnv(
          validEnv({
            WORKER_MANAGER_URL: 'http://localhost:8000',
            WORKER_MANAGER_SECRET: STRONG_WORKER_SECRET,
            [key]: value,
          }),
        ),
      ).toThrow(key);
    }
  });

  it('rechaza un NODE_ENV fuera de development/test/production', () => {
    expect(() => validateEnv(validEnv({ NODE_ENV: 'staging' }))).toThrow(
      /NODE_ENV/,
    );
  });

  it.each(['0', '70000', 'abc', '-1', '54.5'])('rechaza DB_PORT=%s', (port) => {
    expect(() => validateEnv(validEnv({ DB_PORT: port }))).toThrow(/DB_PORT/);
  });

  it.each(['DB_PASSWORD', 'BETTER_AUTH_SECRET', 'CAMERAS_ENCRYPTION_KEY'])(
    'rechaza %s compuesto solo de espacios',
    (key) => {
      expect(() => validateEnv(validEnv({ [key]: ' '.repeat(44) }))).toThrow(
        new RegExp(`${key}: es obligatoria`),
      );
    },
  );

  it.each(['no-es-una-url', 'ftp://auth.vigilia.test', '//sin-protocolo'])(
    'rechaza BETTER_AUTH_URL=%s',
    (url) => {
      expect(() => validateEnv(validEnv({ BETTER_AUTH_URL: url }))).toThrow(
        /BETTER_AUTH_URL/,
      );
    },
  );

  it('no filtra el valor de BETTER_AUTH_SECRET ni de CAMERAS_ENCRYPTION_KEY', () => {
    const shortSecret = 'SecretoCortoQueNoDebeVerse';
    const badKey = Buffer.from('clave-de-16-bytes').toString('base64');
    const message = captureError(() =>
      validateEnv(
        validEnv({
          BETTER_AUTH_SECRET: shortSecret,
          CAMERAS_ENCRYPTION_KEY: badKey,
        }),
      ),
    );
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('CAMERAS_ENCRYPTION_KEY');
    expect(message).not.toContain(shortSecret);
    expect(message).not.toContain(badKey);
  });

  it('no filtra secretos válidos cuando falla otra variable', () => {
    const env = validEnv({ DB_HOST: '' });
    const message = captureError(() => validateEnv(env));
    expect(message).toContain('DB_HOST');
    for (const key of [
      'DB_PASSWORD',
      'BETTER_AUTH_SECRET',
      'CAMERAS_ENCRYPTION_KEY',
    ]) {
      expect(message).not.toContain(env[key] as string);
    }
  });

  it('reporta todos los errores en un solo mensaje', () => {
    const env = validEnv({
      DB_PORT: 'abc',
      BETTER_AUTH_SECRET: 'corto-pero-real-123',
      FRONTEND_URL: 'localhost:5173',
    });
    delete env.DB_HOST;
    const message = captureError(() => validateEnv(env));
    for (const key of [
      'DB_HOST',
      'DB_PORT',
      'BETTER_AUTH_SECRET',
      'FRONTEND_URL',
    ]) {
      expect(message).toContain(`- ${key}:`);
    }
    expect(
      message.split('\n').filter((l) => l.startsWith('  - ')),
    ).toHaveLength(4);
  });

  describe('WORKER_MANAGER_SECRET', () => {
    it('es opcional si no hay WORKER_MANAGER_URL', () => {
      expect(() => validateEnv(validEnv())).not.toThrow();
      expect(() =>
        validateEnv(validEnv({ WORKER_MANAGER_URL: '  ' })),
      ).not.toThrow();
    });

    it('acepta un secreto real de 32+ caracteres junto a la URL', () => {
      expect(() =>
        validateEnv(
          validEnv({
            WORKER_MANAGER_URL: 'http://localhost:8000',
            WORKER_MANAGER_SECRET: STRONG_WORKER_SECRET,
          }),
        ),
      ).not.toThrow();
    });

    it.each([
      ['ausente', undefined],
      ['vacío', ''],
      ['solo espacios', '      '],
    ])('es obligatorio con WORKER_MANAGER_URL (%s)', (_label, secret) => {
      const env = validEnv({ WORKER_MANAGER_URL: 'http://localhost:8000' });
      if (secret !== undefined) env.WORKER_MANAGER_SECRET = secret;
      expect(() => validateEnv(env)).toThrow(
        /WORKER_MANAGER_SECRET: es obligatoria cuando WORKER_MANAGER_URL/,
      );
    });

    it('rechaza un secreto de menos de 32 caracteres sin imprimirlo', () => {
      const weak = 'secreto-del-manager-123';
      const message = captureError(() =>
        validateEnv(
          validEnv({
            WORKER_MANAGER_URL: 'http://localhost:8000',
            WORKER_MANAGER_SECRET: weak,
          }),
        ),
      );
      expect(message).toMatch(/WORKER_MANAGER_SECRET: .*32 caracteres/);
      expect(message).not.toContain(weak);
    });

    it.each([
      'change-me-to-a-secure-random-value',
      'change-me-generate-with-openssl-rand-base64-32',
      'your_worker_manager_secret_of_32_chars_min',
    ])('rechaza el placeholder %s', (placeholder) => {
      expect(() =>
        validateEnv(validEnv({ WORKER_MANAGER_SECRET: placeholder })),
      ).toThrow(/WORKER_MANAGER_SECRET: .*placeholder/);
    });
  });
});

/**
 * Fase 4 · P6.M (D14): secreto con el que el forward WHEP se autentica ante
 * MediaMTX (`authMethod: http`). Obligatorio si el backend usa MediaMTX.
 */
describe('MEDIAMTX_AUTH_SECRET (Fase 4 · P6.M)', () => {
  const STRONG_MEDIAMTX_SECRET = 'Hq4Vt8Zm2Lc7Rx1Nw5Kp9Bd3Fs6Gy0JaTe';

  it('es opcional si el backend no usa MediaMTX (sin URL ni registro)', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
    expect(() =>
      validateEnv(
        validEnv({ CAMERAS_REGISTER_IN_MEDIAMTX: 'false', MEDIAMTX_URL: ' ' }),
      ),
    ).not.toThrow();
  });

  it.each([
    ['MEDIAMTX_URL definida', { MEDIAMTX_URL: 'http://127.0.0.1:8889' }],
    [
      'CAMERAS_REGISTER_IN_MEDIAMTX=true',
      { CAMERAS_REGISTER_IN_MEDIAMTX: 'true' },
    ],
    [
      'CAMERAS_REGISTER_IN_MEDIAMTX=TRUE',
      { CAMERAS_REGISTER_IN_MEDIAMTX: 'TRUE' },
    ],
  ])('es obligatoria con %s', (_label, overrides) => {
    expect(() => validateEnv(validEnv(overrides))).toThrow(
      /MEDIAMTX_AUTH_SECRET: es obligatoria cuando MEDIAMTX_URL está definida o CAMERAS_REGISTER_IN_MEDIAMTX=true/,
    );
    expect(() =>
      validateEnv(validEnv({ ...overrides, MEDIAMTX_AUTH_SECRET: '   ' })),
    ).toThrow(/MEDIAMTX_AUTH_SECRET: es obligatoria/);
  });

  it('acepta un secreto real de 32+ caracteres', () => {
    expect(() =>
      validateEnv(
        validEnv({
          MEDIAMTX_URL: 'http://127.0.0.1:8889',
          CAMERAS_REGISTER_IN_MEDIAMTX: 'true',
          MEDIAMTX_AUTH_SECRET: STRONG_MEDIAMTX_SECRET,
        }),
      ),
    ).not.toThrow();
  });

  it('rechaza un secreto corto sin imprimir su valor', () => {
    const weak = 'corto-pero-real-123';
    const message = captureError(() =>
      validateEnv(
        validEnv({
          MEDIAMTX_URL: 'http://127.0.0.1:8889',
          MEDIAMTX_AUTH_SECRET: weak,
        }),
      ),
    );
    expect(message).toMatch(/MEDIAMTX_AUTH_SECRET: .*32 caracteres/);
    expect(message).not.toContain(weak);
  });

  it.each([
    'change-me-generate-with-openssl-rand-base64-32',
    'your_mediamtx_auth_secret_of_32_chars_min',
    '<secreto-compartido-con-mediamtx-de-32>',
  ])('rechaza el placeholder %s (aunque no se use MediaMTX)', (placeholder) => {
    expect(() =>
      validateEnv(validEnv({ MEDIAMTX_AUTH_SECRET: placeholder })),
    ).toThrow(/MEDIAMTX_AUTH_SECRET: .*placeholder/);
  });

  it('MEDIAMTX_URL debe ser una URL http(s)', () => {
    expect(() =>
      validateEnv(
        validEnv({
          MEDIAMTX_URL: 'mediamtx:8889',
          MEDIAMTX_AUTH_SECRET: STRONG_MEDIAMTX_SECRET,
        }),
      ),
    ).toThrow(/MEDIAMTX_URL: MEDIAMTX_URL debe ser una URL http\(s\) válida/);
  });
});

/**
 * Fase 4 · P6.M (corrección cyber): IPs desde las que MediaMTX llama al
 * endpoint interno de auth.
 */
describe('MEDIAMTX_AUTH_ALLOWED_IPS', () => {
  it('opcional; acepta IPv4/IPv6 separadas por coma', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
    expect(() =>
      validateEnv(
        validEnv({ MEDIAMTX_AUTH_ALLOWED_IPS: '127.0.0.1, ::1,10.0.0.6' }),
      ),
    ).not.toThrow();
  });

  it.each(['10.0.0.0/24', 'mediamtx.local', '127.0.0.1;10.0.0.5', ' , '])(
    'rechaza %p',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ MEDIAMTX_AUTH_ALLOWED_IPS: value })),
      ).toThrow(/MEDIAMTX_AUTH_ALLOWED_IPS: debe ser una lista de IPs/);
    },
  );

  it('parseMediamtxAuthAllowedIps: default loopback y formas canónicas', () => {
    expect([...parseMediamtxAuthAllowedIps(undefined)]).toEqual([
      '127.0.0.1',
      '::1',
    ]);
    expect([...parseMediamtxAuthAllowedIps('  ')]).toEqual([
      '127.0.0.1',
      '::1',
    ]);
    expect([
      ...parseMediamtxAuthAllowedIps('::FFFF:10.0.0.6, 0:0:0:0:0:0:0:1'),
    ]).toEqual(['10.0.0.6', '::1']);
    expect(() => parseMediamtxAuthAllowedIps('no-es-ip')).toThrow(
      /MEDIAMTX_AUTH_ALLOWED_IPS/,
    );
  });

  it('normalizeIp', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeIp('0:0:0:0:0:0:0:1')).toBe('::1');
    expect(normalizeIp('FE80::1')).toBe('fe80::1');
    expect(normalizeIp('10.0.0.300')).toBeNull();
    expect(normalizeIp('host')).toBeNull();
  });
});

function captureError(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('se esperaba que la validación fallara');
}

describe('isPlaceholderValue', () => {
  it.each([
    'change-me',
    'CHANGE_ME_please',
    'your_secret_here',
    'my-example-key',
    '<generate>',
    'changeme',
  ])('detecta %s', (value) => {
    expect(isPlaceholderValue(value)).toBe(true);
  });

  it('no marca valores reales', () => {
    expect(isPlaceholderValue('k3Jf92mQpZ8xLw1Rt5Nb')).toBe(false);
  });
});

describe('TRUST_PROXY', () => {
  it.each(['0', '1', '2', ' 3 ', 'false', '', '   '])(
    'acepta TRUST_PROXY=%p (entero >= 0, "false" o vacío)',
    (value) => {
      expect(() => validateEnv(validEnv({ TRUST_PROXY: value }))).not.toThrow();
    },
  );

  it.each(['true', 'TRUE', ' True '])(
    'rechaza TRUST_PROXY=%p con un mensaje que explica el riesgo',
    (value) => {
      const message = captureError(() =>
        validateEnv(validEnv({ TRUST_PROXY: value })),
      );
      expect(message).toMatch(/TRUST_PROXY: "true" no está permitido/);
      expect(message).toContain('X-Forwarded-For');
    },
  );

  it.each(['-1', '1.5', 'yes', 'loopback', '1,2', 'False'])(
    'rechaza TRUST_PROXY=%p',
    (value) => {
      expect(() => validateEnv(validEnv({ TRUST_PROXY: value }))).toThrow(
        /TRUST_PROXY: debe ser un entero >= 0/,
      );
    },
  );
});

describe('parseTrustProxy', () => {
  it('sin proxy: ausente, vacío o "false" -> false', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('un entero -> cantidad de proxies', () => {
    expect(parseTrustProxy('0')).toBe(0);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy(' 1 ')).toBe(1);
  });

  it.each(['true', 'TRUE', 'muchos', '-1'])(
    'nunca devuelve true: lanza ante %p (fail-closed)',
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow(/TRUST_PROXY/);
    },
  );
});

describe('VISIT_APPROVAL_TTL_MINUTES (Fase 4 · P3)', () => {
  it('es opcional', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
  });

  it.each(['1', '30', ' 45 ', '1440', '', '   '])(
    'acepta VISIT_APPROVAL_TTL_MINUTES=%p',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_APPROVAL_TTL_MINUTES: value })),
      ).not.toThrow();
    },
  );

  it.each(['0', '1441', '-5', '1.5', 'treinta', '30m'])(
    'rechaza VISIT_APPROVAL_TTL_MINUTES=%p y nombra la variable',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_APPROVAL_TTL_MINUTES: value })),
      ).toThrow(/VISIT_APPROVAL_TTL_MINUTES: debe ser un entero de minutos/);
    },
  );

  it('parseVisitApprovalTtlMinutes: ausente o vacío -> default 30', () => {
    expect(DEFAULT_VISIT_APPROVAL_TTL_MINUTES).toBe(30);
    expect(parseVisitApprovalTtlMinutes(undefined)).toBe(30);
    expect(parseVisitApprovalTtlMinutes('  ')).toBe(30);
  });

  it('parseVisitApprovalTtlMinutes: entero válido', () => {
    expect(parseVisitApprovalTtlMinutes(' 15 ')).toBe(15);
  });

  it.each(['0', '5000', 'abc'])(
    'parseVisitApprovalTtlMinutes lanza ante %p (fail-closed)',
    (value) => {
      expect(() => parseVisitApprovalTtlMinutes(value)).toThrow(
        /VISIT_APPROVAL_TTL_MINUTES/,
      );
    },
  );
});

describe('VISIT_EXIT_COOLDOWN_MINUTES (Fase 4 · P3)', () => {
  it('es opcional', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
  });

  it.each(['1', '5', ' 10 ', '120', '', '   '])(
    'acepta VISIT_EXIT_COOLDOWN_MINUTES=%p',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_EXIT_COOLDOWN_MINUTES: value })),
      ).not.toThrow();
    },
  );

  it.each(['0', '121', '-5', '2.5', 'cinco', '5m'])(
    'rechaza VISIT_EXIT_COOLDOWN_MINUTES=%p y nombra la variable',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_EXIT_COOLDOWN_MINUTES: value })),
      ).toThrow(
        /VISIT_EXIT_COOLDOWN_MINUTES: debe ser un entero de minutos entre 1 y 120/,
      );
    },
  );

  it('parseVisitExitCooldownMinutes: ausente o vacío -> default 5', () => {
    expect(DEFAULT_VISIT_EXIT_COOLDOWN_MINUTES).toBe(5);
    expect(parseVisitExitCooldownMinutes(undefined)).toBe(5);
    expect(parseVisitExitCooldownMinutes('  ')).toBe(5);
  });

  it('parseVisitExitCooldownMinutes: entero válido', () => {
    expect(parseVisitExitCooldownMinutes(' 15 ')).toBe(15);
    expect(parseVisitExitCooldownMinutes('120')).toBe(120);
  });

  it.each(['0', '121', 'abc'])(
    'parseVisitExitCooldownMinutes lanza ante %p (fail-closed)',
    (value) => {
      expect(() => parseVisitExitCooldownMinutes(value)).toThrow(
        /VISIT_EXIT_COOLDOWN_MINUTES/,
      );
    },
  );
});

describe('LPR_PASSAGE_WINDOW_SECONDS', () => {
  it.each(['1', '60', ' 90 ', '600', '', '   '])(
    'acepta LPR_PASSAGE_WINDOW_SECONDS=%p',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ LPR_PASSAGE_WINDOW_SECONDS: value })),
      ).not.toThrow();
    },
  );

  it.each(['0', '601', '-5', '1.5', 'sesenta', '60s'])(
    'rechaza LPR_PASSAGE_WINDOW_SECONDS=%p y nombra la variable',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ LPR_PASSAGE_WINDOW_SECONDS: value })),
      ).toThrow(
        /LPR_PASSAGE_WINDOW_SECONDS: debe ser un entero de segundos entre 1 y 600/,
      );
    },
  );

  it('parseLprPassageWindowSeconds: default 60, valor válido y fail-closed', () => {
    expect(DEFAULT_LPR_PASSAGE_WINDOW_SECONDS).toBe(60);
    expect(parseLprPassageWindowSeconds(undefined)).toBe(60);
    expect(parseLprPassageWindowSeconds('  ')).toBe(60);
    expect(parseLprPassageWindowSeconds(' 45 ')).toBe(45);
    expect(() => parseLprPassageWindowSeconds('601')).toThrow(
      /LPR_PASSAGE_WINDOW_SECONDS/,
    );
  });
});

describe('presupuesto de IA del Guardián', () => {
  it('AI_VISION_RATE_PER_MINUTE: default 10, válido y fail-closed', () => {
    expect(parseAiVisionRatePerMinute(undefined)).toBe(10);
    expect(parseAiVisionRatePerMinute(' ')).toBe(10);
    expect(parseAiVisionRatePerMinute(' 25 ')).toBe(25);
    expect(() => parseAiVisionRatePerMinute('0')).toThrow(
      /AI_VISION_RATE_PER_MINUTE/,
    );
    expect(() => parseAiVisionRatePerMinute('601')).toThrow(
      /AI_VISION_RATE_PER_MINUTE/,
    );
    expect(() => parseAiVisionRatePerMinute('abc')).toThrow(
      /AI_VISION_RATE_PER_MINUTE/,
    );
  });

  it('AI_VISION_DAILY_CAP: default 300, válido y fail-closed', () => {
    expect(parseAiVisionDailyCap(undefined)).toBe(300);
    expect(parseAiVisionDailyCap('1000')).toBe(1000);
    expect(() => parseAiVisionDailyCap('100001')).toThrow(
      /AI_VISION_DAILY_CAP/,
    );
    expect(() => parseAiVisionDailyCap('-5')).toThrow(/AI_VISION_DAILY_CAP/);
  });
});

describe.each([
  ['LPR_PASSAGE_REVERSE_MIN_SECONDS', parseLprPassageReverseMinSeconds, 15],
  ['LPR_PASSAGE_ORPHAN_SECONDS', parseLprPassageOrphanSeconds, 30],
] as const)('%s', (name, parse, fallback) => {
  it.each(['1', '45', ' 90 ', '600', '', '   '])('acepta %p', (value) => {
    expect(() => validateEnv(validEnv({ [name]: value }))).not.toThrow();
  });

  it.each(['0', '601', '-5', '1.5', 'diez', '15s'])(
    'rechaza %p y nombra la variable',
    (value) => {
      expect(() => validateEnv(validEnv({ [name]: value }))).toThrow(
        new RegExp(`${name}: debe ser un entero de segundos entre 1 y 600`),
      );
    },
  );

  it('parse: default, valor válido y fail-closed', () => {
    expect(parse(undefined)).toBe(fallback);
    expect(parse('  ')).toBe(fallback);
    expect(parse(' 45 ')).toBe(45);
    expect(() => parse('601')).toThrow(new RegExp(name));
  });
});

describe('LPR_PASSAGE_FUZZY_SECONDS', () => {
  it.each(['0', '1', '30', ' 45 ', '600', '', '   '])(
    'acepta LPR_PASSAGE_FUZZY_SECONDS=%p (0 la desactiva)',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ LPR_PASSAGE_FUZZY_SECONDS: value })),
      ).not.toThrow();
    },
  );

  it.each(['601', '-5', '1.5', 'treinta', '30s'])(
    'rechaza LPR_PASSAGE_FUZZY_SECONDS=%p y nombra la variable',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ LPR_PASSAGE_FUZZY_SECONDS: value })),
      ).toThrow(
        /LPR_PASSAGE_FUZZY_SECONDS: debe ser un entero de segundos entre 0 y 600/,
      );
    },
  );

  it('parseLprPassageFuzzySeconds: default 30, 0 válido y fail-closed', () => {
    expect(parseLprPassageFuzzySeconds(undefined)).toBe(30);
    expect(parseLprPassageFuzzySeconds('  ')).toBe(30);
    expect(parseLprPassageFuzzySeconds('0')).toBe(0);
    expect(parseLprPassageFuzzySeconds(' 45 ')).toBe(45);
    expect(() => parseLprPassageFuzzySeconds('601')).toThrow(
      /LPR_PASSAGE_FUZZY_SECONDS/,
    );
  });
});

describe('VISIT_CONCIERGE_VALIDITY_HOURS (Fase 4 · P3, QA N1)', () => {
  it('es opcional', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
  });

  it.each(['1', '4', ' 12 ', '24', '', '   '])(
    'acepta VISIT_CONCIERGE_VALIDITY_HOURS=%p',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_CONCIERGE_VALIDITY_HOURS: value })),
      ).not.toThrow();
    },
  );

  it.each(['0', '25', '-1', '1.5', 'cuatro', '4h'])(
    'rechaza VISIT_CONCIERGE_VALIDITY_HOURS=%p y nombra la variable',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_CONCIERGE_VALIDITY_HOURS: value })),
      ).toThrow(
        /VISIT_CONCIERGE_VALIDITY_HOURS: debe ser un entero de horas entre 1 y 24/,
      );
    },
  );

  it('parseVisitConciergeValidityHours: ausente o vacío -> default 4', () => {
    expect(DEFAULT_VISIT_CONCIERGE_VALIDITY_HOURS).toBe(4);
    expect(parseVisitConciergeValidityHours(undefined)).toBe(4);
    expect(parseVisitConciergeValidityHours('  ')).toBe(4);
  });

  it('parseVisitConciergeValidityHours: entero válido', () => {
    expect(parseVisitConciergeValidityHours(' 2 ')).toBe(2);
    expect(parseVisitConciergeValidityHours('24')).toBe(24);
  });

  it.each(['0', '25', 'abc'])(
    'parseVisitConciergeValidityHours lanza ante %p (fail-closed)',
    (value) => {
      expect(() => parseVisitConciergeValidityHours(value)).toThrow(
        /VISIT_CONCIERGE_VALIDITY_HOURS/,
      );
    },
  );
});

describe('Retención (Fase 4 · P7.R)', () => {
  const NAMES = Object.keys(RETENTION_PERIODS) as RetentionPeriodName[];

  it('los defaults son los de la tabla del §3 de privacidad-ley-21719.md', () => {
    expect(
      Object.fromEntries(
        NAMES.map((name) => [name, RETENTION_PERIODS[name].defaultDays]),
      ),
    ).toEqual({
      RETENTION_IMAGES_DAYS: 30,
      RETENTION_VISITS_DAYS: 90,
      RETENTION_ACCESS_LOG_DAYS: 90,
      RETENTION_ANOMALIES_DAYS: 90,
      RETENTION_NOTIFICATIONS_DAYS: 90,
      RETENTION_PENDING_ACTIONS_DAYS: 90,
      RETENTION_AUDIT_DAYS: 365,
      RETENTION_SYSTEM_LOGS_DAYS: 30,
      RETENTION_DISABLED_USERS_DAYS: 30,
    });
  });

  it('todas son opcionales (ausentes o vacías)', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
    const blanks = Object.fromEntries(NAMES.map((name) => [name, '  ']));
    expect(() =>
      validateEnv(
        validEnv({ ...blanks, RETENTION_ENABLED: '', RETENTION_DRY_RUN: '' }),
      ),
    ).not.toThrow();
  });

  it.each(NAMES)('%s acepta 1, el default y su máximo', (name) => {
    const { defaultDays, maxDays } = RETENTION_PERIODS[name];
    for (const value of ['1', String(defaultDays), ` ${maxDays} `]) {
      expect(() => validateEnv(validEnv({ [name]: value }))).not.toThrow();
    }
  });

  it.each(NAMES)(
    '%s rechaza 0, negativos, decimales, texto y más que el máximo',
    (name) => {
      const { maxDays } = RETENTION_PERIODS[name];
      for (const value of [
        '0',
        '-30',
        '1.5',
        'treinta',
        '30d',
        `${maxDays + 1}`,
      ]) {
        expect(() => validateEnv(validEnv({ [name]: value }))).toThrow(
          new RegExp(
            `${name}: debe ser un entero de días entre 1 y ${maxDays}`,
          ),
        );
      }
    },
  );

  it('los máximos son razonables (imágenes y logs hasta 1 año, auditoría hasta 10)', () => {
    expect(RETENTION_PERIODS.RETENTION_IMAGES_DAYS.maxDays).toBe(365);
    expect(RETENTION_PERIODS.RETENTION_SYSTEM_LOGS_DAYS.maxDays).toBe(365);
    expect(RETENTION_PERIODS.RETENTION_AUDIT_DAYS.maxDays).toBe(3650);
    for (const name of NAMES) {
      expect(RETENTION_PERIODS[name].maxDays).toBeLessThanOrEqual(3650);
      expect(RETENTION_PERIODS[name].defaultDays).toBeLessThanOrEqual(
        RETENTION_PERIODS[name].maxDays,
      );
    }
  });

  it('parseRetentionDays: default, valor válido y fail-closed', () => {
    expect(parseRetentionDays('RETENTION_IMAGES_DAYS', undefined)).toBe(30);
    expect(parseRetentionDays('RETENTION_AUDIT_DAYS', '   ')).toBe(365);
    expect(parseRetentionDays('RETENTION_VISITS_DAYS', ' 120 ')).toBe(120);
    expect(() => parseRetentionDays('RETENTION_IMAGES_DAYS', '366')).toThrow(
      /RETENTION_IMAGES_DAYS/,
    );
    expect(() => parseRetentionDays('RETENTION_VISITS_DAYS', 'abc')).toThrow(
      /RETENTION_VISITS_DAYS/,
    );
  });

  it.each(['RETENTION_ENABLED', 'RETENTION_DRY_RUN'])(
    '%s acepta "true"/"false" y rechaza otros valores',
    (name) => {
      for (const value of ['true', 'false']) {
        expect(() => validateEnv(validEnv({ [name]: value }))).not.toThrow();
      }
      for (const value of ['yes', '1', 'TRUE!']) {
        expect(() => validateEnv(validEnv({ [name]: value }))).toThrow(name);
      }
    },
  );

  it('parseBooleanFlag: default, mayúsculas y fail-closed', () => {
    expect(parseBooleanFlag('RETENTION_ENABLED', undefined, true)).toBe(true);
    expect(parseBooleanFlag('RETENTION_DRY_RUN', ' ', false)).toBe(false);
    expect(parseBooleanFlag('RETENTION_DRY_RUN', ' TRUE ', false)).toBe(true);
    expect(parseBooleanFlag('RETENTION_ENABLED', 'false', true)).toBe(false);
    expect(() => parseBooleanFlag('RETENTION_ENABLED', 'si', true)).toThrow(
      /RETENTION_ENABLED/,
    );
  });

  it('backend/.env.example documenta todas las variables de retención', () => {
    const example = readFileSync(
      join(__dirname, '..', '..', '.env.example'),
      'utf8',
    );
    for (const name of [...NAMES, 'RETENTION_ENABLED', 'RETENTION_DRY_RUN']) {
      expect(example).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
    }
  });
});

describe('LOG_LEVEL (Fase 4 · P7)', () => {
  it('valores aceptados: error|warn|log|debug|verbose (los mismos umbrales que resuelve P7.L)', () => {
    expect(LOG_LEVEL_VALUES).toEqual([
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
    expect([...LOG_LEVEL_VALUES]).toEqual([...LOG_LEVEL_THRESHOLDS]);
  });

  it('es opcional (el default por entorno lo resuelve resolveLogLevels)', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
    expect(() =>
      validateEnv(validEnv({ NODE_ENV: 'production', LOG_LEVEL: '  ' })),
    ).not.toThrow();
  });

  it.each(['error', 'warn', 'log', 'debug', 'verbose', ' LOG ', 'Warn'])(
    'acepta LOG_LEVEL=%p (también en producción)',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ NODE_ENV: 'production', LOG_LEVEL: value })),
      ).not.toThrow();
    },
  );

  it.each(['info', 'trace', 'fatal', 'all', '3', 'debug,verbose'])(
    'rechaza LOG_LEVEL=%p al arrancar y nombra la variable',
    (value) => {
      expect(() => validateEnv(validEnv({ LOG_LEVEL: value }))).toThrow(
        /LOG_LEVEL: debe ser uno de: error, warn, log, debug, verbose/,
      );
    },
  );
});

describe('VISIT_ACTIVE_GRACE_HOURS (Fase 4 · P7, QA A1)', () => {
  it.each(['1', '24', ' 72 ', '168', '', '   '])(
    'acepta VISIT_ACTIVE_GRACE_HOURS=%p',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_ACTIVE_GRACE_HOURS: value })),
      ).not.toThrow();
    },
  );

  it.each(['0', '169', '-1', '1.5', 'un día', '24h'])(
    'rechaza VISIT_ACTIVE_GRACE_HOURS=%p y nombra la variable',
    (value) => {
      expect(() =>
        validateEnv(validEnv({ VISIT_ACTIVE_GRACE_HOURS: value })),
      ).toThrow(
        /VISIT_ACTIVE_GRACE_HOURS: debe ser un entero de horas entre 1 y 168/,
      );
    },
  );

  it('parseVisitActiveGraceHours: default 24, valor válido y fail-closed', () => {
    expect(parseVisitActiveGraceHours(undefined)).toBe(24);
    expect(parseVisitActiveGraceHours('  ')).toBe(24);
    expect(parseVisitActiveGraceHours(' 48 ')).toBe(48);
    expect(() => parseVisitActiveGraceHours('200')).toThrow(
      /VISIT_ACTIVE_GRACE_HOURS/,
    );
  });
});

describe('OPENAI_API_BASE_URL (Fase 4 · P8)', () => {
  it.each([
    'https://api.openai.com',
    'https://api.openai.com/',
    'http://127.0.0.1:43123',
    'https://proxy.interno/openai/',
    '',
    '   ',
  ])('acepta OPENAI_API_BASE_URL=%p', (value) => {
    expect(() =>
      validateEnv(validEnv({ OPENAI_API_BASE_URL: value })),
    ).not.toThrow();
  });

  it.each([
    'api.openai.com',
    'ftp://api.openai.com',
    'https://user:pass@api.openai.com',
    'https://api.openai.com/?key=1',
    'https://api.openai.com/#frag',
    'no es una url',
  ])('rechaza OPENAI_API_BASE_URL=%p y nombra la variable', (value) => {
    expect(() => validateEnv(validEnv({ OPENAI_API_BASE_URL: value }))).toThrow(
      /OPENAI_API_BASE_URL: debe ser una URL http\(s\)/,
    );
  });

  it('en producción exige https (la request lleva OPENAI_API_KEY)', () => {
    expect(() =>
      validateEnv(
        validEnv({
          NODE_ENV: 'production',
          OPENAI_API_BASE_URL: 'http://openai-proxy.interno',
        }),
      ),
    ).toThrow(/OPENAI_API_BASE_URL: debe ser https:\/\/ en producción/);
    expect(() =>
      validateEnv(
        validEnv({
          NODE_ENV: 'production',
          OPENAI_API_BASE_URL: 'https://openai-proxy.interno',
        }),
      ),
    ).not.toThrow();
  });

  it('el mensaje de error no repite el valor', () => {
    const value = 'https://user:s3cr3t@api.openai.com';
    let message = '';
    try {
      validateEnv(validEnv({ OPENAI_API_BASE_URL: value }));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/OPENAI_API_BASE_URL/);
    expect(message).not.toContain('s3cr3t');
  });

  it('parseOpenAiApiBaseUrl: default oficial, sin "/" final y fail-closed', () => {
    expect(parseOpenAiApiBaseUrl(undefined)).toBe(DEFAULT_OPENAI_API_BASE_URL);
    expect(parseOpenAiApiBaseUrl('  ')).toBe('https://api.openai.com');
    expect(parseOpenAiApiBaseUrl('http://127.0.0.1:43123/')).toBe(
      'http://127.0.0.1:43123',
    );
    expect(parseOpenAiApiBaseUrl(' https://proxy.interno/openai// ')).toBe(
      'https://proxy.interno/openai',
    );
    expect(() => parseOpenAiApiBaseUrl('ftp://x')).toThrow(
      /OPENAI_API_BASE_URL/,
    );
  });
});
