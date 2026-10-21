/**
 * `scripts/gate-db.cjs` (Fase 4 · P9, corrección cyber BAJO): el helper del
 * gate crea y borra bases `vigilia_gate_*` en el Postgres de `DB_HOST`. Solo
 * acepta un host local salvo `VIGILIA_ALLOW_REMOTE_TEST_DB=true`, y sale con
 * 4 (no 3, que el gate trata como SKIP). Importarlo no ejecuta nada
 * (`require.main === module`).
 */
interface GateDbModule {
  ALLOW_REMOTE_VARIABLE: string;
  EXIT_REMOTE_HOST: number;
  EXIT_UNAVAILABLE: number;
  RemoteHostError: new (message: string) => Error;
  assertLocalHost(env: Record<string, string | undefined>): void;
  exitCodeFor(error: unknown): number;
  isLocalHost(host: string): boolean;
}

// Script CommonJS sin tipos: se tipa con la interfaz de arriba.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gateDb = require('../../../scripts/gate-db.cjs') as GateDbModule;

describe('gate-db.cjs — candado de host local (Fase 4 · P9)', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    '127.0.0.1',
    '127.10.0.1',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
    '::ffff:127.0.0.1',
    '/var/run/postgresql',
  ])('%p es local', (host) => {
    expect(gateDb.isLocalHost(host)).toBe(true);
  });

  it.each([
    '0.0.0.0',
    '10.0.0.5',
    '192.168.1.20',
    'pg.piloto.vigilia.cl',
    'localhost.evil.com',
    '::',
    '::ffff:10.0.0.1',
  ])('%p NO es local', (host) => {
    expect(gateDb.isLocalHost(host)).toBe(false);
  });

  it('sin DB_HOST usa localhost (el default de la conexión): permitido', () => {
    expect(() => gateDb.assertLocalHost({})).not.toThrow();
  });

  it('un DB_HOST remoto se rechaza con RemoteHostError y un mensaje claro', () => {
    let caught: unknown;
    try {
      gateDb.assertLocalHost({
        DB_HOST: 'pg.piloto.vigilia.cl',
        DB_PASSWORD: 'clave-del-piloto',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(gateDb.RemoteHostError);
    const message = (caught as Error).message;
    expect(message).toContain('"pg.piloto.vigilia.cl" no es local');
    expect(message).toContain('VIGILIA_ALLOW_REMOTE_TEST_DB=true');
    expect(message).not.toContain('clave-del-piloto');
  });

  it.each(['true', 'TRUE', ' true '])(
    'VIGILIA_ALLOW_REMOTE_TEST_DB=%p lo permite a propósito',
    (flag) => {
      expect(() =>
        gateDb.assertLocalHost({
          DB_HOST: '10.0.0.5',
          [gateDb.ALLOW_REMOTE_VARIABLE]: flag,
        }),
      ).not.toThrow();
    },
  );

  it('código de salida: 4 para host remoto, distinto del 3 (SKIP) y del 1', () => {
    expect(gateDb.EXIT_REMOTE_HOST).toBe(4);
    expect(gateDb.EXIT_REMOTE_HOST).not.toBe(gateDb.EXIT_UNAVAILABLE);
    expect(gateDb.exitCodeFor(new gateDb.RemoteHostError('x'))).toBe(4);
    expect(gateDb.exitCodeFor(new Error('x'))).toBe(1);
  });
});
