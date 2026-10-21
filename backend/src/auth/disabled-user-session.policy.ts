import { Logger } from '@nestjs/common';

/**
 * Sin sesiones para usuarios deshabilitados (Fase 4 · P6.R, corrección P6).
 *
 * `UsersService.disable` es un soft-delete (`user."deletedAt"`) que
 * better-auth no conoce: con la contraseña correcta, `/sign-in/email` creaba
 * una sesión para la cuenta deshabilitada. La API y el WebSocket la
 * rechazaban, pero la fila quedaba y, al re-habilitar la cuenta, volvía a
 * servir. better-auth.ts conecta `isSessionCreationAllowed` en
 * `databaseHooks.session.create.before` y, si no, lanza el MISMO error que
 * una contraseña incorrecta (`INVALID_EMAIL_OR_PASSWORD`): el login no
 * revela que la cuenta existe y está deshabilitada, y `hooks.after` lo
 * audita como `LOGIN_FAILED`.
 *
 * Sin imports de runtime de better-auth (es ESM-only): lo testea Jest y lo
 * carga la sonda de better-auth con ts-node.
 */

/**
 * Estado del usuario dueño de la sesión: `true` deshabilitado, `false`
 * activo, `null` no existe. better-auth.ts lo resuelve con su `pg.Pool`
 * (`USER_DISABLED_LOOKUP_SQL`); la sonda, con su adaptador en memoria.
 */
export type UserDisabledLookup = (userId: string) => Promise<boolean | null>;

/** Consulta del estado del usuario (parámetro `$1` = id). */
export const USER_DISABLED_LOOKUP_SQL =
  'SELECT "deletedAt" FROM "user" WHERE id = $1';

/** Estado a partir de las filas de `USER_DISABLED_LOOKUP_SQL`. */
export function userDisabledFromRows(
  rows: ReadonlyArray<{ deletedAt?: unknown }>,
): boolean | null {
  if (rows.length === 0) {
    return null;
  }
  const deletedAt = rows[0].deletedAt;
  return deletedAt !== null && deletedAt !== undefined;
}

const logger = new Logger('DisabledUserSessionPolicy');

/**
 * ¿Se puede crear la sesión? No para un usuario deshabilitado. Fail-closed:
 * sin `userId` o ante un error de la consulta, no (sin BD tampoco se podría
 * guardar la sesión).
 *
 * Un usuario que la consulta no ve (`null`) sí pasa: la existencia la
 * garantiza la FK `session.userId -> user.id`, y la consulta va por otra
 * conexión, así que no ve un usuario creado en la MISMA transacción que la
 * sesión (alta + login de better-auth, verificado con la sonda).
 */
export async function isSessionCreationAllowed(
  session: { userId?: unknown },
  lookup: UserDisabledLookup,
): Promise<boolean> {
  const userId = typeof session.userId === 'string' ? session.userId : null;
  if (!userId) {
    return false;
  }
  let disabled: boolean | null;
  try {
    disabled = await lookup(userId);
  } catch (error) {
    logger.error(
      `No se pudo verificar si el usuario ${userId} está habilitado; no se crea la sesión (${error instanceof Error ? error.name : typeof error})`,
    );
    return false;
  }
  if (disabled === true) {
    logger.warn(`Sesión rechazada: el usuario ${userId} está deshabilitado`);
    return false;
  }
  return true;
}
