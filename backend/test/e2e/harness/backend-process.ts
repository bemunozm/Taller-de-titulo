import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { request } from 'node:http';

/**
 * Procesos hijos del harness e2e (Fase 4 · P8): la app compilada
 * (`node dist/main.js`) y los scripts de preparación (migraciones y seed).
 * Toda su salida va a un archivo de log de la corrida (stdout y stderr del
 * hijo apuntan directo al archivo, así no se pierde aunque Jest se cuelgue).
 */
export interface BackendProcess {
  readonly pid: number | undefined;
  readonly baseUrl: string;
  readonly logFile: string;
  /** `true` mientras el proceso no haya terminado. */
  isRunning(): boolean;
  /** Termina el proceso (SIGTERM y, si no sale a tiempo, SIGKILL). Idempotente. */
  stop(): Promise<void>;
  /** SIGKILL síncrono, para el handler de `exit` del proceso de Jest. */
  killNow(): void;
}

export interface StartBackendOptions {
  /** Script de entrada (default: `dist/main.js`; los specs del harness usan un doble). */
  entry: string;
  env: Record<string, string>;
  /** Directorio de trabajo del hijo: vacío, sin `.env`. */
  cwd: string;
  port: number;
  logFile: string;
  /** Tiempo máximo para que responda HTTP. */
  bootTimeoutMs: number;
  /** Ruta que se consulta para saber si ya responde (cualquier status sirve). */
  readinessPath?: string;
  pollIntervalMs?: number;
}

const STOP_GRACE_MS = 10_000;
const LOG_TAIL_LINES = 40;

/** Últimas líneas del log (para el mensaje de error del setup). */
export function readLogTail(logFile: string, lines = LOG_TAIL_LINES): string {
  if (!existsSync(logFile)) {
    return '(sin log)';
  }
  const content = readFileSync(logFile, 'utf8').trimEnd();
  return content.split(/\r?\n/).slice(-lines).join('\n') || '(log vacío)';
}

function openLog(logFile: string): number {
  return openSync(logFile, 'a');
}

/** ¿El servidor responde HTTP en `port`? Cualquier status cuenta como "arriba". */
function probeHttp(port: number, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        agent: false,
        timeout: 2_000,
      },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  if (!(await waitForExit(child, STOP_GRACE_MS))) {
    child.kill('SIGKILL');
    await waitForExit(child, STOP_GRACE_MS);
  }
}

export async function startBackend(
  options: StartBackendOptions,
): Promise<BackendProcess> {
  if (!existsSync(options.entry)) {
    throw new Error(
      `No existe ${options.entry}: compila el backend con \`npm run build\` (o usa \`npm run test:e2e\`, que compila antes de correr)`,
    );
  }
  const logFd = openLog(options.logFile);
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [options.entry], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
  } finally {
    // El hijo tiene su propia copia del descriptor.
    closeSync(logFd);
  }

  // En un objeto: el callback lo escribe más tarde (TS no estrecha propiedades).
  const launch: { error: Error | null } = { error: null };
  child.once('error', (error) => {
    launch.error = error;
  });

  const backend: BackendProcess = {
    pid: child.pid,
    baseUrl: `http://127.0.0.1:${options.port}`,
    logFile: options.logFile,
    isRunning: () => child.exitCode === null && child.signalCode === null,
    stop: () => terminate(child),
    killNow: () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    },
  };

  const deadline = Date.now() + options.bootTimeoutMs;
  const readinessPath = options.readinessPath ?? '/api/v1';
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  while (Date.now() < deadline) {
    if (launch.error !== null || !backend.isRunning()) {
      const reason =
        launch.error !== null
          ? `no se pudo lanzar (${launch.error.message})`
          : `terminó con código ${String(child.exitCode)}${child.signalCode ? ` (${child.signalCode})` : ''}`;
      throw new Error(
        `El backend de prueba ${reason} antes de responder. Log (${options.logFile}):\n${readLogTail(options.logFile)}`,
      );
    }
    if (await probeHttp(options.port, readinessPath)) {
      return backend;
    }
    await delay(pollIntervalMs);
  }

  await terminate(child);
  throw new Error(
    `El backend de prueba no respondió en ${options.bootTimeoutMs} ms (puerto ${options.port}). Log (${options.logFile}):\n${readLogTail(options.logFile)}`,
  );
}

export interface RunNodeScriptOptions {
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  logFile: string;
  timeoutMs: number;
  /** Nombre para los mensajes (`migraciones`, `seed del super-admin`). */
  label: string;
}

/**
 * Corre `node <script> ...args` hasta que termine. La salida va al log de la
 * corrida (nunca a la consola: el seed y las migraciones imprimen emails).
 * Falla con el final del log si sale con código != 0 o pasa el timeout.
 */
export async function runNodeScript(
  script: string,
  options: RunNodeScriptOptions,
): Promise<void> {
  const logFd = openLog(options.logFile);
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [script, ...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
  } finally {
    closeSync(logFd);
  }

  const outcome = await new Promise<
    | { kind: 'exit'; code: number | null }
    | { kind: 'error'; error: Error }
    | { kind: 'timeout' }
  >((resolve) => {
    const timer = setTimeout(
      () => resolve({ kind: 'timeout' }),
      options.timeoutMs,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ kind: 'error', error });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ kind: 'exit', code });
    });
  });

  if (outcome.kind === 'exit' && outcome.code === 0) {
    return;
  }
  if (outcome.kind === 'timeout') {
    await terminate(child);
  }
  const reason =
    outcome.kind === 'timeout'
      ? `no terminó en ${options.timeoutMs} ms`
      : outcome.kind === 'error'
        ? `no se pudo lanzar (${outcome.error.message})`
        : `terminó con código ${String(outcome.code)}`;
  throw new Error(
    `Falló ${options.label}: ${reason}. Log (${options.logFile}):\n${readLogTail(options.logFile)}`,
  );
}
