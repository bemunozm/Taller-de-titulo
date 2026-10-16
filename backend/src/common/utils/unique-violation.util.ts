import { QueryFailedError } from 'typeorm';

/** Código SQLSTATE de Postgres para `unique_violation`. */
const PG_UNIQUE_VIOLATION = '23505';

/** Código SQLSTATE de Postgres para `foreign_key_violation`. */
const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * Código SQLSTATE de un error de Postgres, o `null` si no es uno.
 *
 * Acepta el `QueryFailedError` de TypeORM (lee `driverError.code`) y el error
 * del driver `pg` sin envolver (o cualquier error con un `code` string, como
 * los que copian sus propiedades). Fase 4 · P5.C: única definición; antes
 * `UsersService`, `RolesService` y `PermissionsService` tenían su propio
 * helper local.
 */
export function postgresErrorCode(error: unknown): string | null {
  const source: unknown =
    error instanceof QueryFailedError ? error.driverError : error;
  if (
    typeof source === 'object' &&
    source !== null &&
    'code' in source &&
    typeof source.code === 'string'
  ) {
    return source.code;
  }
  return null;
}

/**
 * `true` si `error` es la violación de un índice o constraint UNIQUE de
 * Postgres (SQLSTATE 23505). Sirve para responder 409 en vez de 500 cuando
 * dos escrituras concurrentes pasan el chequeo previo de duplicados y la BD
 * rechaza la segunda (Fase 4 · P5.B: unicidad por condominio de patentes e
 * identificadores de unidad).
 */
export function isUniqueViolation(error: unknown): boolean {
  return postgresErrorCode(error) === PG_UNIQUE_VIOLATION;
}

/** Propiedad string del error del driver (`detail`, `constraint`), o `null`. */
function driverErrorField(error: unknown, field: string): string | null {
  const source: unknown =
    error instanceof QueryFailedError ? error.driverError : error;
  if (typeof source !== 'object' || source === null || !(field in source)) {
    return null;
  }
  const value: unknown = (source as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Columnas del índice o constraint UNIQUE violado, leídas del detalle de
 * Postgres (`Key (email)=(x@y.cl) already exists.`); `[]` si no es una
 * violación de unicidad o el detalle no viene.
 */
export function uniqueViolationColumns(error: unknown): string[] {
  if (!isUniqueViolation(error)) {
    return [];
  }
  const match = /^Key \(([^)]+)\)=/.exec(
    driverErrorField(error, 'detail') ?? '',
  );
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((column) => column.trim().replace(/^"|"$/g, ''));
}

/** Nombre del constraint UNIQUE violado (`constraint` del driver), o `null`. */
export function uniqueViolationConstraint(error: unknown): string | null {
  return isUniqueViolation(error)
    ? driverErrorField(error, 'constraint')
    : null;
}

/**
 * `true` si `error` es la violación de una FK (SQLSTATE 23503): p. ej. borrar
 * una fila que otras todavía referencian. Sirve para responder 409 en vez de
 * 500.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return postgresErrorCode(error) === PG_FOREIGN_KEY_VIOLATION;
}
