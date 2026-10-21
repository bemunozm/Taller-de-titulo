/**
 * Lectura tipada de las filas que devuelve `DataSource.query` (`unknown`).
 * Las consultas de privacy/ devuelven siempre un SELECT (los UPDATE/DELETE van
 * dentro de un CTE con `SELECT count(*)`), así que el resultado es un array de
 * filas y no la tupla `[filas, afectadas]` que TypeORM devuelve para un
 * UPDATE/DELETE suelto.
 */

export type SqlRow = Record<string, unknown>;

/** Sentencia parametrizada (`$1`, `$2`...). */
export interface SqlStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function isRow(value: unknown): value is SqlRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Filas del resultado; cualquier otra forma lanza (no se adivina). */
export function rowsOf(result: unknown): SqlRow[] {
  if (!Array.isArray(result) || !result.every(isRow)) {
    throw new Error('Resultado SQL inesperado: se esperaba una lista de filas');
  }
  return result;
}

/** Número de la columna `column` de la primera fila (p. ej. un `count(*)::int`). */
export function firstNumber(result: unknown, column: string): number {
  const [row] = rowsOf(result);
  const value = row?.[column];
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  // `count(*)` sin `::int` llega como texto (bigint): también se acepta.
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  throw new Error(`Resultado SQL inesperado: falta el número "${column}"`);
}

/** `value` como texto, o `null` si no lo es. */
export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** `value` como texto; si no lo es, lanza (columnas NOT NULL como `id`). */
export function requiredString(value: unknown, column: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Resultado SQL inesperado: "${column}" no es texto`);
  }
  return value;
}
