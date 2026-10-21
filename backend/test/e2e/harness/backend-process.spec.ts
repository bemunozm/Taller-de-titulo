import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { childProcessEnv } from './e2e-env';
import { findFreePort } from './free-port';
import {
  readLogTail,
  runNodeScript,
  startBackend,
  type BackendProcess,
} from './backend-process';

/**
 * Pieza unitaria del harness e2e (Fase 4 · P8): lanzar, esperar y matar el
 * proceso hijo, con un doble del backend (un servidor HTTP mínimo) en vez de
 * `dist/main.js`. Verifica también que la salida queda en el log y que el
 * hijo corre en el `cwd` y con el env que se le pasan.
 */
describe('startBackend / runNodeScript (harness e2e)', () => {
  let workDir: string;
  const started: BackendProcess[] = [];

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'vigilia-e2e-harness-'));
  });

  afterEach(async () => {
    for (const backend of started.splice(0)) {
      await backend.stop();
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  function fixture(name: string, source: string): string {
    const file = join(workDir, name);
    writeFileSync(file, source, 'utf8');
    return file;
  }

  /** Doble del backend: escucha en PORT, responde 404 y loguea su cwd y un env. */
  const FAKE_BACKEND = `
    const http = require('node:http');
    console.log('cwd=' + process.cwd());
    console.log('marker=' + process.env.E2E_MARKER);
    console.error('stderr también va al log');
    http.createServer((req, res) => { res.statusCode = 404; res.end('no'); })
      .listen(Number(process.env.PORT), '127.0.0.1');
  `;

  function get(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/v1', agent: false },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('espera a que responda HTTP (cualquier status), y stop() lo termina', async () => {
    const port = await findFreePort();
    const logFile = join(workDir, 'backend.log');

    const backend = await startBackend({
      entry: fixture('fake-backend.js', FAKE_BACKEND),
      env: childProcessEnv({ PORT: String(port), E2E_MARKER: 'hola' }),
      cwd: workDir,
      port,
      logFile,
      bootTimeoutMs: 15_000,
      pollIntervalMs: 50,
    });
    started.push(backend);

    expect(backend.baseUrl).toBe(`http://127.0.0.1:${port}`);
    expect(backend.isRunning()).toBe(true);
    await expect(get(port)).resolves.toBe(404);

    await backend.stop();
    expect(backend.isRunning()).toBe(false);
    await expect(backend.stop()).resolves.toBeUndefined();

    const log = readFileSync(logFile, 'utf8');
    expect(log).toContain(`cwd=${workDir}`);
    expect(log).toContain('marker=hola');
    expect(log).toContain('stderr también va al log');
  });

  it('si el proceso termina antes de responder, falla con su código y el final del log', async () => {
    const port = await findFreePort();
    const logFile = join(workDir, 'backend.log');

    await expect(
      startBackend({
        entry: fixture(
          'crash.js',
          "console.error('Configuración de entorno inválida: DB_HOST'); process.exit(3);",
        ),
        env: childProcessEnv({}),
        cwd: workDir,
        port,
        logFile,
        bootTimeoutMs: 15_000,
        pollIntervalMs: 50,
      }),
    ).rejects.toThrow(
      /terminó con código 3[\s\S]*Configuración de entorno inválida/,
    );
  });

  it('si no responde a tiempo, lo mata y falla con el timeout', async () => {
    const port = await findFreePort();
    const logFile = join(workDir, 'backend.log');
    const pidFile = join(workDir, 'pid.txt');

    await expect(
      startBackend({
        entry: fixture(
          'hang.js',
          `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`,
        ),
        env: childProcessEnv({}),
        cwd: workDir,
        port,
        logFile,
        bootTimeoutMs: 1_500,
        pollIntervalMs: 50,
      }),
    ).rejects.toThrow(/no respondió en 1500 ms/);

    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('falla claro si no existe el build', async () => {
    await expect(
      startBackend({
        entry: join(workDir, 'dist', 'main.js'),
        env: {},
        cwd: workDir,
        port: 1,
        logFile: join(workDir, 'backend.log'),
        bootTimeoutMs: 1_000,
      }),
    ).rejects.toThrow(/npm run build/);
  });

  it('runNodeScript: resuelve con código 0 y deja la salida en el log', async () => {
    const logFile = join(workDir, 'seed.log');

    await runNodeScript(
      fixture(
        'ok.js',
        "console.log('args=' + process.argv.slice(2).join(','));",
      ),
      {
        args: ['a@b.test', 'clave'],
        env: childProcessEnv({}),
        cwd: workDir,
        logFile,
        timeoutMs: 15_000,
        label: 'el seed',
      },
    );

    expect(readLogTail(logFile)).toContain('args=a@b.test,clave');
  });

  it('runNodeScript: con código != 0 falla con la etiqueta y el log', async () => {
    const logFile = join(workDir, 'migrations.log');

    await expect(
      runNodeScript(
        fixture(
          'fail.js',
          "console.error('relation already exists'); process.exit(1);",
        ),
        {
          args: [],
          env: childProcessEnv({}),
          cwd: workDir,
          logFile,
          timeoutMs: 15_000,
          label: 'migration:run',
        },
      ),
    ).rejects.toThrow(
      /Falló migration:run: terminó con código 1[\s\S]*relation already exists/,
    );
  });

  it('readLogTail: sin archivo o vacío lo dice', () => {
    expect(readLogTail(join(workDir, 'no-existe.log'))).toBe('(sin log)');
    const empty = join(workDir, 'vacio.log');
    writeFileSync(empty, '');
    expect(readLogTail(empty)).toBe('(log vacío)');
  });
});
