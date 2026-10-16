import {
  assertE2eDatabaseName,
  assertLocalTestDatabaseHost,
  databaseConfigFor,
  isLocalPgHost,
  parseDotEnv,
  resolvePgServer,
  uniqueDatabaseName,
} from './database';

/**
 * Pieza unitaria del harness e2e (Fase 4 · P8): de dónde sale el servidor
 * Postgres y la guarda de nombres (el harness solo crea y borra BDs
 * `vigilia_e2e_*`). Sin BD real.
 */
describe('resolvePgServer (harness e2e)', () => {
  const noDotEnv = (): null => null;

  it('prioriza E2E_DATABASE_URL (la BD del path es la de mantenimiento)', () => {
    const resolved = resolvePgServer(
      {
        E2E_DATABASE_URL: 'postgres://ci%40user:p%40ss%3Aword@db.ci:5433/maint',
        DB_HOST: 'ignorado',
        DB_USER: 'ignorado',
        // `db.ci` no es local: el candado de P9 exige permitirlo a propósito.
        VIGILIA_ALLOW_REMOTE_TEST_DB: 'true',
      },
      () => {
        throw new Error('no debe leer el .env');
      },
    );

    expect(resolved).toEqual({
      source: 'E2E_DATABASE_URL',
      config: {
        host: 'db.ci',
        port: 5433,
        user: 'ci@user',
        password: 'p@ss:word',
        adminDatabase: 'maint',
      },
    });
  });

  it('E2E_DATABASE_URL sin BD ni puerto: postgres y 5432', () => {
    const { config } = resolvePgServer(
      { E2E_DATABASE_URL: 'postgresql://vigilia:clave@localhost' },
      noDotEnv,
    );

    expect(config).toMatchObject({ port: 5432, adminDatabase: 'postgres' });
  });

  it.each(['mysql://u:p@h/db', 'no es una url'])(
    'rechaza E2E_DATABASE_URL=%p',
    (url) => {
      expect(() =>
        resolvePgServer({ E2E_DATABASE_URL: url }, noDotEnv),
      ).toThrow(/E2E_DATABASE_URL/);
    },
  );

  it('después usa DB_* del entorno (CI), con E2E_ADMIN_DATABASE opcional', () => {
    const resolved = resolvePgServer(
      {
        DB_HOST: 'localhost',
        DB_PORT: '5455',
        DB_USER: 'vigilia',
        DB_PASSWORD: 'clave',
        DB_NAME: 'no_se_usa',
        E2E_ADMIN_DATABASE: 'template1',
      },
      () => {
        throw new Error('no debe leer el .env');
      },
    );

    expect(resolved).toEqual({
      source: 'DB_* del entorno',
      config: {
        host: 'localhost',
        port: 5455,
        user: 'vigilia',
        password: 'clave',
        adminDatabase: 'template1',
      },
    });
  });

  it('por último el backend/.env (solo la conexión), con la BD de mantenimiento postgres', () => {
    const resolved = resolvePgServer({}, () => ({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'dev',
      DB_PASSWORD: 'dev-clave',
      DB_NAME: 'vigilia_dev',
    }));

    expect(resolved).toEqual({
      source: 'backend/.env',
      config: {
        host: 'localhost',
        port: 5432,
        user: 'dev',
        password: 'dev-clave',
        adminDatabase: 'postgres',
      },
    });
  });

  it('sin ninguna fuente falla con instrucciones', () => {
    expect(() => resolvePgServer({}, noDotEnv)).toThrow(
      /define E2E_DATABASE_URL .* o DB_HOST\/DB_PORT\/DB_USER\/DB_PASSWORD/,
    );
  });

  it('falla si falta el usuario o el puerto es inválido', () => {
    expect(() => resolvePgServer({ DB_HOST: 'h' }, noDotEnv)).toThrow(
      /Falta DB_USER en el entorno/,
    );
    expect(() =>
      resolvePgServer({ DB_USER: 'u', DB_PORT: '99999' }, noDotEnv),
    ).toThrow(/Puerto de Postgres inválido/);
  });
});

/**
 * Fase 4 · P9 (cyber BAJO): el harness crea, migra y BORRA bases. Si
 * `backend/.env` apuntara al Postgres del piloto, lo haría ahí: solo se
 * acepta un servidor local, salvo VIGILIA_ALLOW_REMOTE_TEST_DB=true.
 */
describe('candado de host local (harness e2e)', () => {
  const noDotEnv = (): null => null;
  const remoteDotEnv = (): Record<string, string> => ({
    DB_HOST: 'pg.piloto.vigilia.cl',
    DB_PORT: '5432',
    DB_USER: 'vigilia',
    DB_PASSWORD: 'clave-del-piloto',
  });

  it.each([
    'localhost',
    '127.0.0.1',
    '127.0.0.2',
    '::1',
    '/var/run/postgresql',
  ])('acepta DB_HOST=%p (local)', (host) => {
    expect(
      resolvePgServer({ DB_HOST: host, DB_USER: 'u' }, noDotEnv).config.host,
    ).toBe(host);
  });

  it('acepta E2E_DATABASE_URL en loopback (IPv4 e IPv6)', () => {
    expect(
      resolvePgServer(
        { E2E_DATABASE_URL: 'postgres://u:p@127.0.0.1:5455/postgres' },
        noDotEnv,
      ).config.host,
    ).toBe('127.0.0.1');
    expect(
      resolvePgServer(
        { E2E_DATABASE_URL: 'postgres://u:p@[::1]:5455/postgres' },
        noDotEnv,
      ).config.host,
    ).toBe('[::1]');
  });

  it('rechaza un backend/.env que apunta a un Postgres remoto, sin mostrar la clave', () => {
    let message = '';
    try {
      resolvePgServer({}, remoteDotEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('(backend/.env) apunta a "pg.piloto.vigilia.cl"');
    expect(message).toContain('VIGILIA_ALLOW_REMOTE_TEST_DB=true');
    expect(message).not.toContain('clave-del-piloto');
  });

  it.each([
    [{ DB_HOST: '10.0.0.5', DB_USER: 'u' }, 'DB_* del entorno'],
    [{ DB_HOST: '0.0.0.0', DB_USER: 'u' }, 'DB_* del entorno'],
    [{ DB_HOST: 'localhost.evil.com', DB_USER: 'u' }, 'DB_* del entorno'],
    [
      { E2E_DATABASE_URL: 'postgres://u:p@db.ci:5432/postgres' },
      'E2E_DATABASE_URL',
    ],
  ])('rechaza %p (%s)', (env, source) => {
    expect(() => resolvePgServer(env, noDotEnv)).toThrow(
      new RegExp(
        `\\(${source.replace(/[*]/g, '\\*')}\\) apunta a .* que no es local`,
      ),
    );
  });

  it.each(['true', 'TRUE', ' true '])(
    'VIGILIA_ALLOW_REMOTE_TEST_DB=%p lo permite a propósito',
    (flag) => {
      expect(
        resolvePgServer({ VIGILIA_ALLOW_REMOTE_TEST_DB: flag }, remoteDotEnv)
          .config.host,
      ).toBe('pg.piloto.vigilia.cl');
    },
  );

  it.each(['false', '1', 'yes', ''])(
    'VIGILIA_ALLOW_REMOTE_TEST_DB=%p no alcanza',
    (flag) => {
      expect(() =>
        resolvePgServer({ VIGILIA_ALLOW_REMOTE_TEST_DB: flag }, remoteDotEnv),
      ).toThrow(/que no es local/);
    },
  );

  it('isLocalPgHost: loopback o socket Unix', () => {
    expect(isLocalPgHost('localhost')).toBe(true);
    expect(isLocalPgHost('/tmp')).toBe(true);
    expect(isLocalPgHost('db')).toBe(false);
  });

  it('assertLocalTestDatabaseHost directo: el entorno decide la excepción', () => {
    expect(() => assertLocalTestDatabaseHost('db', 'backend/.env', {})).toThrow(
      /que no es local/,
    );
    expect(() =>
      assertLocalTestDatabaseHost('db', 'backend/.env', {
        VIGILIA_ALLOW_REMOTE_TEST_DB: 'true',
      }),
    ).not.toThrow();
  });
});

describe('nombres de BD e2e (harness e2e)', () => {
  it('uniqueDatabaseName: vigilia_e2e_<timestamp>_<hex>, distinto en cada llamada', () => {
    expect(uniqueDatabaseName(1_791_600_000_000, 'a1b2c3')).toBe(
      'vigilia_e2e_1791600000000_a1b2c3',
    );
    const first = uniqueDatabaseName();
    expect(first).toMatch(/^vigilia_e2e_\d+_[0-9a-f]{6}$/);
    expect(uniqueDatabaseName()).not.toBe(first);
  });

  it.each([
    'vigilia',
    'vigilia_dev',
    'postgres',
    'vigilia_e2e_',
    'vigilia_e2e_123_ab"; DROP DATABASE vigilia; --',
    'vigilia_e2e_abc_12',
  ])('assertE2eDatabaseName rechaza %p', (name) => {
    expect(() => assertE2eDatabaseName(name)).toThrow(
      /Nombre de BD e2e inválido/,
    );
  });

  it('databaseConfigFor arma la conexión a la BD de la corrida', () => {
    expect(
      databaseConfigFor(
        {
          host: 'h',
          port: 1,
          user: 'u',
          password: 'p',
          adminDatabase: 'postgres',
        },
        'vigilia_e2e_1_ab',
      ),
    ).toEqual({
      host: 'h',
      port: 1,
      user: 'u',
      password: 'p',
      database: 'vigilia_e2e_1_ab',
    });
  });
});

describe('parseDotEnv (harness e2e)', () => {
  it('lee KEY=value con comillas y CRLF, ignorando comentarios', () => {
    expect(
      parseDotEnv(
        '# comentario\r\nDB_HOST=localhost\r\nDB_PASSWORD="con espacio"\nVACIA=\n',
      ),
    ).toEqual({
      DB_HOST: 'localhost',
      DB_PASSWORD: 'con espacio',
      VACIA: '',
    });
  });
});
