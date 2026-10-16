import { join } from 'path';

/**
 * Fuente ÚNICA de opciones de TypeORM (P2, D1): la usan el runtime de Nest
 * (`AppModule`, vía `forRootAsync`) y el CLI de migraciones (`data-source.ts`).
 *
 * - `synchronize` solo si `DB_SYNCHRONIZE === 'true'` (prototipos). Nunca en
 *   producción: el arranque falla con un error explícito.
 * - `migrationsRun: false`: el despliegue corre `npm run migration:run`
 *   explícitamente, no como efecto lateral de arrancar la app.
 * - Entidades por glob (`**\/*.entity.{ts,js}`): runtime y CLI ven EXACTAMENTE
 *   el mismo set, así `migration:check` detecta drift de cualquier entidad,
 *   esté o no registrada con `forFeature`. `autoLoadEntities` se mantiene
 *   (inocuo: TypeORM deduplica por clase).
 * - Las migraciones se toman por glob de un solo nivel: `migrations/legacy/`
 *   queda excluido a propósito (esquema histórico que ya no se ejecuta).
 * - `uuidExtension: 'pgcrypto'` -> `gen_random_uuid()`, sin depender de
 *   `uuid-ossp`.
 */

const SRC_ROOT = join(__dirname, '..');

/** Subconjunto de `ConfigService` / process.env que necesita el builder. */
export interface ConfigReader {
  get(key: string): string | undefined;
}

export function readerFromEnv(env: NodeJS.ProcessEnv): ConfigReader {
  return { get: (key: string) => env[key] };
}

export interface BuiltTypeOrmOptions {
  type: 'postgres';
  host: string | undefined;
  port: number;
  username: string | undefined;
  password: string | undefined;
  database: string | undefined;
  uuidExtension: 'pgcrypto';
  autoLoadEntities: true;
  entities: string[];
  synchronize: boolean;
  migrationsRun: false;
  migrations: string[];
}

export function buildTypeOrmOptions(config: ConfigReader): BuiltTypeOrmOptions {
  const synchronize = config.get('DB_SYNCHRONIZE') === 'true';

  if (synchronize && config.get('NODE_ENV') === 'production') {
    throw new Error(
      'DB_SYNCHRONIZE=true no está permitido con NODE_ENV=production: synchronize puede alterar o ' +
        'borrar datos de forma destructiva. Ejecuta `npm run migration:run` y quita DB_SYNCHRONIZE.',
    );
  }

  const rawPort = config.get('DB_PORT');
  const port = rawPort ? Number.parseInt(rawPort, 10) : 5432;

  return {
    type: 'postgres',
    host: config.get('DB_HOST'),
    port,
    username: config.get('DB_USER'),
    password: config.get('DB_PASSWORD'),
    database: config.get('DB_NAME'),
    uuidExtension: 'pgcrypto',
    autoLoadEntities: true,
    entities: [join(SRC_ROOT, '**', '*.entity.{ts,js}')],
    synchronize,
    migrationsRun: false,
    // Un solo nivel: NO recursa a `migrations/legacy/`.
    migrations: [join(SRC_ROOT, 'migrations', '*.{ts,js}')],
  };
}
