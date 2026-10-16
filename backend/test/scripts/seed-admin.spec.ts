import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * `scripts/seed-admin.js` (Fase 4 · P8): config de la BD desde el entorno si
 * define alguna `DB_*` (CI, e2e), si no desde `backend/.env` (uso de siempre).
 * Importarlo no ejecuta el seed (`require.main === module`).
 */
interface SeedAdminDbConfig {
  source: string;
  connection: {
    host: string;
    port: number;
    user: string;
    password: string | undefined;
    database: string;
  };
}

interface SeedAdminModule {
  resolveDbConfig(
    processEnv: NodeJS.ProcessEnv,
    readDotEnv: () => Record<string, string>,
  ): SeedAdminDbConfig;
  loadDotEnv(envPath?: string): Record<string, string>;
}

// Script CommonJS sin tipos: se tipa con la interfaz de arriba.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const seedAdmin = require('../../scripts/seed-admin.js') as SeedAdminModule;

describe('seed-admin.js — config de la BD (Fase 4 · P8)', () => {
  const failIfRead = (): Record<string, string> => {
    throw new Error('no debe leer el .env');
  };

  it('con DB_* en el entorno usa SOLO el entorno (no lee el .env)', () => {
    const config = seedAdmin.resolveDbConfig(
      {
        DB_HOST: 'db.ci',
        DB_PORT: '5433',
        DB_USER: 'ci',
        DB_PASSWORD: 'clave-ci',
        DB_NAME: 'vigilia_e2e_1_ab',
      },
      failIfRead,
    );

    expect(config).toEqual({
      source: 'el entorno',
      connection: {
        host: 'db.ci',
        port: 5433,
        user: 'ci',
        password: 'clave-ci',
        database: 'vigilia_e2e_1_ab',
      },
    });
  });

  it('en el entorno, host y puerto tienen default (localhost:5432)', () => {
    const { connection } = seedAdmin.resolveDbConfig(
      { DB_USER: 'u', DB_NAME: 'n' },
      failIfRead,
    );

    expect(connection).toMatchObject({ host: 'localhost', port: 5432 });
  });

  it('sin DB_* en el entorno usa el .env (uso de siempre) y no mezcla fuentes', () => {
    const config = seedAdmin.resolveDbConfig(
      { PATH: '/usr/bin', DB_HOST: '  ' },
      () => ({
        DB_HOST: 'localhost',
        DB_PORT: '5455',
        DB_USER: 'dev',
        DB_PASSWORD: 'dev-clave',
        DB_NAME: 'vigilia',
      }),
    );

    expect(config).toEqual({
      source: 'backend/.env',
      connection: {
        host: 'localhost',
        port: 5455,
        user: 'dev',
        password: 'dev-clave',
        database: 'vigilia',
      },
    });
  });

  it('falla si faltan DB_USER o DB_NAME en la fuente elegida', () => {
    expect(() =>
      seedAdmin.resolveDbConfig({ DB_HOST: 'h' }, failIfRead),
    ).toThrow(/Faltan DB_USER, DB_NAME en el entorno/);
    expect(() =>
      seedAdmin.resolveDbConfig({}, () => ({ DB_USER: 'u' })),
    ).toThrow(/Faltan DB_NAME en backend\/.env/);
  });

  it('rechaza un DB_PORT inválido', () => {
    expect(() =>
      seedAdmin.resolveDbConfig(
        { DB_USER: 'u', DB_NAME: 'n', DB_PORT: 'abc' },
        failIfRead,
      ),
    ).toThrow(/DB_PORT inválido/);
  });

  describe('loadDotEnv', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'vigilia-seed-admin-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('lee KEY=value del archivo', () => {
      const file = join(dir, '.env');
      writeFileSync(file, 'DB_USER=dev\r\nDB_NAME="vigilia"\n# comentario\n');

      expect(seedAdmin.loadDotEnv(file)).toEqual({
        DB_USER: 'dev',
        DB_NAME: 'vigilia',
      });
    });

    it('sin archivo falla con la instrucción', () => {
      expect(() => seedAdmin.loadDotEnv(join(dir, 'no-existe.env'))).toThrow(
        /No hay variables DB_\* en el entorno/,
      );
    });
  });
});
