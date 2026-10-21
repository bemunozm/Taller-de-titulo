import { join, resolve } from 'node:path';

/**
 * Rutas del harness e2e (Fase 4 · P8). Todo es absoluto: los procesos hijos
 * (backend, migraciones, seed) corren con un `cwd` vacío para que ni
 * `dotenv/config` ni `ConfigModule` lean el `backend/.env` de desarrollo.
 */
export const BACKEND_ROOT = resolve(__dirname, '..', '..', '..');

/** Entrada de la app compilada (`npm run build`). */
export const DIST_MAIN = join(BACKEND_ROOT, 'dist', 'main.js');

/** DataSource compilado que usa `migration:run:prod`. */
export const DIST_DATA_SOURCE = join(
  BACKEND_ROOT,
  'dist',
  'database',
  'data-source.js',
);

/** CLI de TypeORM (lo mismo que el bin `typeorm` de `migration:run:prod`). */
export const TYPEORM_CLI = join(
  BACKEND_ROOT,
  'node_modules',
  'typeorm',
  'cli.js',
);

/** Seed del primer Super Administrador (lee `DB_*` del entorno). */
export const SEED_ADMIN_SCRIPT = join(BACKEND_ROOT, 'scripts', 'seed-admin.js');

/** `.env` de desarrollo: solo se lee para conectarse al servidor Postgres local. */
export const BACKEND_DOTENV = join(BACKEND_ROOT, '.env');
