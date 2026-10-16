import { globSync, readdirSync } from 'fs';
import { basename, join } from 'path';
import { buildTypeOrmOptions, readerFromEnv } from './typeorm-options';

function build(env: Record<string, string>) {
  return buildTypeOrmOptions(readerFromEnv(env));
}

const baseEnv = {
  DB_HOST: 'db',
  DB_PORT: '5455',
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'n',
};

describe('buildTypeOrmOptions', () => {
  it('no activa synchronize por defecto, tampoco fuera de producción', () => {
    expect(build(baseEnv).synchronize).toBe(false);
    expect(build({ ...baseEnv, NODE_ENV: 'development' }).synchronize).toBe(
      false,
    );
    expect(build({ ...baseEnv, NODE_ENV: 'production' }).synchronize).toBe(
      false,
    );
  });

  it('activa synchronize solo con DB_SYNCHRONIZE=true', () => {
    expect(build({ ...baseEnv, DB_SYNCHRONIZE: 'true' }).synchronize).toBe(
      true,
    );
    expect(build({ ...baseEnv, DB_SYNCHRONIZE: 'false' }).synchronize).toBe(
      false,
    );
    expect(build({ ...baseEnv, DB_SYNCHRONIZE: '1' }).synchronize).toBe(false);
  });

  it('falla con producción + DB_SYNCHRONIZE=true', () => {
    expect(() =>
      build({ ...baseEnv, NODE_ENV: 'production', DB_SYNCHRONIZE: 'true' }),
    ).toThrow(/DB_SYNCHRONIZE=true no está permitido/);
  });

  it('no ejecuta migraciones al arrancar y usa pgcrypto', () => {
    const options = build(baseEnv);
    expect(options.migrationsRun).toBe(false);
    expect(options.uuidExtension).toBe('pgcrypto');
  });

  it('mapea la conexión y el puerto', () => {
    const options = build(baseEnv);
    expect(options).toMatchObject({
      host: 'db',
      port: 5455,
      username: 'u',
      password: 'p',
      database: 'n',
    });
    expect(build({ ...baseEnv, DB_PORT: '' }).port).toBe(5432);
  });

  it('descubre las entidades por glob (mismo set en runtime y CLI)', () => {
    const [glob] = build(baseEnv).entities;
    expect(glob.replace(/\\/g, '/')).toMatch(/\/\*\*\/\*\.entity\.\{ts,js\}$/);
  });

  it('el glob de migraciones es de un nivel y no incluye legacy/', () => {
    const [glob] = build(baseEnv).migrations;
    const normalized = glob.replace(/\\/g, '/');
    expect(normalized).toMatch(/migrations\/\*\.\{ts,js\}$/);
    expect(normalized).not.toContain('legacy');
    expect(normalized).not.toContain('**');
  });

  it('el glob REAL de migraciones resuelve solo las migraciones de primer nivel (la base), nunca legacy/', () => {
    const [glob] = build(baseEnv).migrations;
    // Misma normalización que hace TypeORM antes de expandir el glob
    // (PlatformTools.pathNormalize): separadores POSIX.
    const resolved = globSync(glob.replace(/\\/g, '/')).map((file) =>
      basename(file),
    );

    const migrationsDir = join(__dirname, '..', 'migrations');
    const topLevel = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|js)$/.test(entry.name))
      .map((entry) => entry.name);
    const legacy = readdirSync(join(migrationsDir, 'legacy')).filter((name) =>
      /\.(ts|js)$/.test(name),
    );

    expect(resolved).toContain(INITIAL_SCHEMA);
    expect(resolved.sort()).toEqual(topLevel.sort());
    // legacy/ existe y tiene migraciones, pero el glob no las alcanza.
    expect(legacy.length).toBeGreaterThan(0);
    for (const name of legacy) {
      expect(resolved).not.toContain(name);
    }
  });
});

const INITIAL_SCHEMA = '1791472216949-InitialSchema.ts';
