import { Logger } from '@nestjs/common';
import { releaseResources, takeResources } from './harness/e2e-resources';
import { E2E_STATE_FILE_ENV } from './harness/run-state';

const logger = new Logger('E2E');

/**
 * `globalTeardown` de los e2e (Fase 4 · P8): mata el backend de prueba, cierra
 * los servidores falsos, borra la BD de la corrida (salvo
 * `E2E_KEEP_DATABASE=true`) y el archivo de estado. Los logs quedan en el
 * directorio de artefactos. Si algo no se pudo liberar, la corrida falla (una
 * BD sin borrar o un proceso vivo no deben pasar desapercibidos).
 */
export async function globalTeardown(): Promise<void> {
  const resources = takeResources();
  delete process.env[E2E_STATE_FILE_ENV];
  if (!resources) {
    return;
  }
  const errors = await releaseResources(resources);
  logger.log(`Logs de la corrida e2e: ${resources.artifactsDir}`);
  if (resources.keepDatabase) {
    logger.warn('E2E_KEEP_DATABASE=true: la BD de la corrida no se borró');
  }
  if (errors.length > 0) {
    throw new Error(
      `No se pudo limpiar la corrida e2e:\n  - ${errors.join('\n  - ')}`,
    );
  }
}

// Jest exige que el módulo de `globalTeardown` exporte la función por defecto.
export default globalTeardown;
