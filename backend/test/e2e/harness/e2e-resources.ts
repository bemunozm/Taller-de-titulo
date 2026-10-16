import { existsSync, rmSync } from 'node:fs';
import type { BackendProcess } from './backend-process';
import { dropDatabase, type PgServerConfig } from './database';
import type { FakeOpenAiServer } from './fake-openai-server';
import type { FakeSmtpServer } from './fake-smtp-server';

/**
 * Recursos vivos de una corrida e2e (Fase 4 · P8). El `globalSetup` los va
 * registrando a medida que los crea, así el `globalTeardown` (o el propio
 * setup, si falla a mitad) libera exactamente lo que alcanzó a existir.
 */
export interface E2eResources {
  artifactsDir: string;
  stateFile: string;
  backend: BackendProcess | null;
  fakeOpenAi: FakeOpenAiServer | null;
  fakeSmtp: FakeSmtpServer | null;
  pgServer: PgServerConfig | null;
  /** Solo se registra cuando el CREATE DATABASE terminó bien. */
  databaseName: string | null;
  /** `E2E_KEEP_DATABASE=true`: no borra la BD (para inspeccionarla). */
  keepDatabase: boolean;
  /** Handler de `exit` que mata al backend si Jest termina sin teardown. */
  exitGuard: (() => void) | null;
}

const GLOBAL_KEY = '__vigiliaE2eResources__';
type GlobalWithResources = typeof globalThis & {
  [GLOBAL_KEY]?: E2eResources;
};

/** `globalSetup` y `globalTeardown` comparten el `globalThis` del proceso de Jest. */
export function rememberResources(resources: E2eResources): void {
  (globalThis as GlobalWithResources)[GLOBAL_KEY] = resources;
}

export function takeResources(): E2eResources | undefined {
  const holder = globalThis as GlobalWithResources;
  const resources = holder[GLOBAL_KEY];
  delete holder[GLOBAL_KEY];
  return resources;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Libera todo lo registrado, en orden: backend, servidores falsos, BD y el
 * archivo de estado (tiene credenciales de prueba). Nunca corta a mitad: junta
 * los errores y los devuelve. Los logs de la corrida se conservan.
 */
export async function releaseResources(
  resources: E2eResources,
): Promise<string[]> {
  const errors: string[] = [];
  const attempt = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      errors.push(`${label}: ${describeError(error)}`);
    }
  };

  const { backend, fakeOpenAi, fakeSmtp, pgServer, databaseName } = resources;
  if (backend) {
    await attempt('detener el backend', () => backend.stop());
    resources.backend = null;
  }
  if (resources.exitGuard) {
    process.removeListener('exit', resources.exitGuard);
    resources.exitGuard = null;
  }
  if (fakeOpenAi) {
    await attempt('cerrar el servidor falso de OpenAI', () =>
      fakeOpenAi.close(),
    );
    resources.fakeOpenAi = null;
  }
  if (fakeSmtp) {
    await attempt('cerrar el sumidero SMTP', () => fakeSmtp.close());
    resources.fakeSmtp = null;
  }
  if (pgServer && databaseName && !resources.keepDatabase) {
    await attempt(`borrar la BD ${databaseName}`, () =>
      dropDatabase(pgServer, databaseName),
    );
    resources.databaseName = null;
  }
  if (existsSync(resources.stateFile)) {
    await attempt('borrar el archivo de estado', () => {
      rmSync(resources.stateFile, { force: true });
      return Promise.resolve();
    });
  }
  return errors;
}
