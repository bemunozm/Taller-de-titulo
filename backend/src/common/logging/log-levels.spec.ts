import { defaultLogLevelThreshold, resolveLogLevels } from './log-levels';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): `LOG_LEVEL` en
 * producción sin `debug`.
 */
describe('resolveLogLevels', () => {
  it('producción sin LOG_LEVEL: log, warn, error (y fatal); sin debug ni verbose', () => {
    expect(resolveLogLevels({ NODE_ENV: 'production' })).toEqual([
      'fatal',
      'error',
      'warn',
      'log',
    ]);
  });

  it('sin NODE_ENV se trata como producción (fail-closed)', () => {
    expect(resolveLogLevels({})).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(resolveLogLevels({ NODE_ENV: 'staging' })).not.toContain('debug');
  });

  it.each(['development', 'test'])(
    '%s sin LOG_LEVEL: además debug y verbose',
    (nodeEnv) => {
      expect(resolveLogLevels({ NODE_ENV: nodeEnv })).toEqual([
        'fatal',
        'error',
        'warn',
        'log',
        'debug',
        'verbose',
      ]);
    },
  );

  it.each([
    ['error', ['fatal', 'error']],
    ['warn', ['fatal', 'error', 'warn']],
    ['log', ['fatal', 'error', 'warn', 'log']],
    ['debug', ['fatal', 'error', 'warn', 'log', 'debug']],
    ['verbose', ['fatal', 'error', 'warn', 'log', 'debug', 'verbose']],
  ])('LOG_LEVEL=%s es un umbral', (level, expected) => {
    expect(
      resolveLogLevels({ NODE_ENV: 'production', LOG_LEVEL: level }),
    ).toEqual(expected);
  });

  it('LOG_LEVEL explícito manda sobre el default de desarrollo', () => {
    expect(
      resolveLogLevels({ NODE_ENV: 'development', LOG_LEVEL: 'warn' }),
    ).toEqual(['fatal', 'error', 'warn']);
  });

  it('acepta mayúsculas y espacios', () => {
    expect(
      resolveLogLevels({ NODE_ENV: 'production', LOG_LEVEL: ' WARN ' }),
    ).toEqual(['fatal', 'error', 'warn']);
  });

  it('un valor inválido cae en el default del entorno', () => {
    expect(
      resolveLogLevels({ NODE_ENV: 'production', LOG_LEVEL: 'info' }),
    ).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(
      resolveLogLevels({ NODE_ENV: 'development', LOG_LEVEL: 'trace' }),
    ).toContain('verbose');
  });

  it('defaultLogLevelThreshold', () => {
    expect(defaultLogLevelThreshold('production')).toBe('log');
    expect(defaultLogLevelThreshold(undefined)).toBe('log');
    expect(defaultLogLevelThreshold('development')).toBe('verbose');
  });
});
