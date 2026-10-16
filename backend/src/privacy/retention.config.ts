import {
  parseBooleanFlag,
  parseRetentionDays,
  RETENTION_PERIODS,
  type RetentionPeriodName,
} from '../config/env.validation';

/** Configuración del barrido de retención (Fase 4 · P7.R). */
export interface RetentionConfig {
  /** RETENTION_ENABLED (default true). */
  enabled: boolean;
  /** RETENTION_DRY_RUN (default false): solo cuenta, no escribe. */
  dryRun: boolean;
  /** Plazos en días (RETENTION_*_DAYS). */
  periods: Readonly<Record<RetentionPeriodName, number>>;
}

/** Subconjunto de `ConfigService`/`process.env` que se lee. */
export interface RetentionConfigReader {
  get(name: string): string | undefined;
}

/**
 * Lee la configuración. Valores inválidos lanzan (fail-closed), aunque
 * `validateEnv` ya los haya rechazado al arrancar.
 */
export function loadRetentionConfig(
  reader: RetentionConfigReader,
): RetentionConfig {
  const names = Object.keys(RETENTION_PERIODS) as RetentionPeriodName[];
  const periods = Object.fromEntries(
    names.map((name) => [name, parseRetentionDays(name, reader.get(name))]),
  ) as Record<RetentionPeriodName, number>;
  return {
    enabled: parseBooleanFlag(
      'RETENTION_ENABLED',
      reader.get('RETENTION_ENABLED'),
      true,
    ),
    dryRun: parseBooleanFlag(
      'RETENTION_DRY_RUN',
      reader.get('RETENTION_DRY_RUN'),
      false,
    ),
    periods: Object.freeze(periods),
  };
}
