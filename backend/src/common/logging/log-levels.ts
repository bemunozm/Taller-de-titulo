import type { LogLevel } from '@nestjs/common';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): niveles del logger
 * de Nest según `LOG_LEVEL`, un UMBRAL (`error|warn|log|debug|verbose`): se
 * emite ese nivel y los más graves. La validación del valor la hace
 * `config/env.validation.ts` (P7.R) al arrancar; este helper lee
 * `process.env` antes de crear la app (el logger se fija en
 * `NestFactory.create`, antes de que exista el `ConfigService`).
 *
 * Sin `LOG_LEVEL`:
 *  - `NODE_ENV=development` o `test`: `verbose` (todo);
 *  - cualquier otro valor, o sin `NODE_ENV`: `log` (fatal, error, warn y
 *    log; sin `debug` ni `verbose`). Fail-closed: un despliegue sin
 *    `NODE_ENV` se trata como producción.
 *
 * Un `LOG_LEVEL` explícito manda, también en producción (p. ej. `debug` para
 * diagnosticar un problema puntual). Un valor que no es un umbral válido cae
 * en el default del entorno.
 */
export const LOG_LEVEL_THRESHOLDS = [
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const;

export type LogLevelThreshold = (typeof LOG_LEVEL_THRESHOLDS)[number];

/** De más a menos grave; `fatal` siempre se emite. */
const ORDERED_LEVELS: readonly LogLevel[] = [
  'fatal',
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
];

function isLogLevelThreshold(value: unknown): value is LogLevelThreshold {
  return (
    typeof value === 'string' &&
    (LOG_LEVEL_THRESHOLDS as readonly string[]).includes(value)
  );
}

/** Umbral por defecto según `NODE_ENV` (ver docstring del módulo). */
export function defaultLogLevelThreshold(
  nodeEnv: string | undefined,
): LogLevelThreshold {
  return nodeEnv === 'development' || nodeEnv === 'test' ? 'verbose' : 'log';
}

/** Niveles que se pasan a `NestFactory.create(..., { logger })`. */
export function resolveLogLevels(
  env: Readonly<Record<string, string | undefined>>,
): LogLevel[] {
  const requested = env.LOG_LEVEL?.trim().toLowerCase();
  const threshold = isLogLevelThreshold(requested)
    ? requested
    : defaultLogLevelThreshold(env.NODE_ENV);
  return ORDERED_LEVELS.slice(0, ORDERED_LEVELS.indexOf(threshold) + 1);
}
