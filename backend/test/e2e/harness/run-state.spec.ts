import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  E2E_STATE_FILE_ENV,
  readRunState,
  writeRunState,
  type E2eRunState,
} from './run-state';

/** Pieza unitaria del harness e2e (Fase 4 · P8): el estado que leen los tests. */
describe('estado de la corrida e2e (harness e2e)', () => {
  let dir: string;

  const state: E2eRunState = {
    version: 1,
    baseUrl: 'http://127.0.0.1:43210',
    port: 43_210,
    frontendOrigin: 'http://localhost:5173',
    superAdmin: { email: 'superadmin.e2e@vigilia.test', password: 'E2e-x' },
    database: {
      host: 'localhost',
      port: 5432,
      user: 'vigilia',
      password: 'clave',
      database: 'vigilia_e2e_1_ab',
    },
    fakeOpenAi: { url: 'http://127.0.0.1:45001', ephemeralToken: 'ek_e2e_1' },
    artifactsDir: '/tmp/vigilia-e2e/1',
    backendLogFile: '/tmp/vigilia-e2e/1/backend.log',
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vigilia-e2e-state-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lo que escribe el globalSetup lo leen los tests', () => {
    const file = join(dir, 'state.json');
    writeRunState(file, state);

    expect(readRunState({ [E2E_STATE_FILE_ENV]: file })).toEqual(state);
  });

  it('sin la variable falla con la instrucción de cómo correr los e2e', () => {
    expect(() => readRunState({})).toThrow(/npm run test:e2e/);
  });

  it('un archivo con otro formato se rechaza', () => {
    const file = join(dir, 'state.json');
    writeFileSync(file, JSON.stringify({ version: 2, baseUrl: 'x' }));

    expect(() => readRunState({ [E2E_STATE_FILE_ENV]: file })).toThrow(
      /no tiene el formato esperado/,
    );
  });
});
