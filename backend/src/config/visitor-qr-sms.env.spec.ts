import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBooleanFlag, validateEnv } from './env.validation';

/**
 * Corrección P7 (cyber B6, decisión de Nova): `VISITOR_QR_SMS_ENABLED`
 * (default false) controla el "SMS" con el QR, que hoy es un email al sandbox
 * de Mailtrap con el teléfono y el QR del visitante.
 */
describe('VISITOR_QR_SMS_ENABLED', () => {
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
      CAMERAS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      FRONTEND_URL: 'https://app.vigilia.test',
      ...overrides,
    };
  }

  it('es opcional (vacío o ausente = apagado)', () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
    expect(() =>
      validateEnv(validEnv({ VISITOR_QR_SMS_ENABLED: '  ' })),
    ).not.toThrow();
    expect(parseBooleanFlag('VISITOR_QR_SMS_ENABLED', undefined, false)).toBe(
      false,
    );
  });

  it('acepta "true"/"false" y rechaza otros valores al arrancar', () => {
    for (const value of ['true', 'false']) {
      expect(() =>
        validateEnv(validEnv({ VISITOR_QR_SMS_ENABLED: value })),
      ).not.toThrow();
    }
    for (const value of ['yes', '1', 'on']) {
      expect(() =>
        validateEnv(validEnv({ VISITOR_QR_SMS_ENABLED: value })),
      ).toThrow('VISITOR_QR_SMS_ENABLED');
    }
  });

  it('backend/.env.example la documenta apagada', () => {
    const example = readFileSync(
      join(__dirname, '..', '..', '.env.example'),
      'utf8',
    );
    expect(example).toMatch(/^# VISITOR_QR_SMS_ENABLED=false$/m);
  });
});
