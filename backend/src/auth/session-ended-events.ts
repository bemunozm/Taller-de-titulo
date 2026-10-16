import { Logger } from '@nestjs/common';

/**
 * Fin de sesiones de better-auth hacia el tiempo real (Fase 4 · P6.R, D13).
 *
 * better-auth se construye FUERA del contenedor de Nest (better-auth.ts), así
 * que su `databaseHooks.session.delete.after` no puede inyectar el gateway.
 * Mismo puente que la auditoría de login (auth-audit.ts): better-auth.ts llama
 * a `notifySessionDeleted` y el gateway registra su listener al iniciar.
 *
 * `delete.after` corre por CADA fila de `session` que better-auth borra con
 * su adaptador interno (verificado en better-auth 1.6.23,
 * `db/with-hooks.mjs`): `sign-out`, `revokeSession(s)`,
 * `revokeOtherSessions`, `changePassword({ revokeOtherSessions })`,
 * `resetPassword` (`revokeSessionsOnPasswordReset`), `internalAdapter.
 * deleteUserSessions` (cambio de email por el super-admin) y la limpieza de
 * una sesión vencida en `getSession`. NO corre si alguien borra filas con SQL
 * directo (respaldo de `UsersService.revokeUserSessions`): eso lo cubre la
 * revalidación periódica del gateway.
 *
 * Sin imports de runtime de better-auth (ESM-only): se testea con Jest y lo
 * carga la sonda de better-auth con ts-node.
 */

/** Por qué terminó la sesión, tal como lo ve el cliente del socket. */
export type SessionEndReason = 'logout' | 'expired' | 'revoked';

export interface SessionEndedEvent {
  sessionId: string;
  userId: string;
  reason: SessionEndReason;
}

export type SessionEndedListener = (event: SessionEndedEvent) => void;

/** Ruta de better-auth (relativa a su `basePath`) del cierre de sesión. */
const SIGN_OUT_PATH = '/sign-out';

/** Forma mínima de la fila de `session` borrada. */
export interface DeletedSessionRow {
  id?: unknown;
  userId?: unknown;
  expiresAt?: unknown;
}

/** Forma mínima del contexto de endpoint que better-auth pasa al hook. */
export interface SessionDeletionContext {
  path?: string;
}

const logger = new Logger('SessionEndedEvents');

const listeners = new Set<SessionEndedListener>();

/**
 * Registra un listener del fin de sesiones. Devuelve la función que lo quita
 * (el gateway la llama al destruirse el módulo).
 */
export function addSessionEndedListener(
  listener: SessionEndedListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Motivo del fin: `/sign-out` es logout; una fila ya vencida, expiración; el resto, revocación. */
export function sessionEndReasonOf(
  session: DeletedSessionRow,
  context: SessionDeletionContext | null | undefined,
  now: Date = new Date(),
): SessionEndReason {
  if (context?.path === SIGN_OUT_PATH) {
    return 'logout';
  }
  const expiresAt =
    session.expiresAt instanceof Date || typeof session.expiresAt === 'string'
      ? new Date(session.expiresAt).getTime()
      : Number.NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
    return 'expired';
  }
  return 'revoked';
}

/**
 * Adaptador de `databaseHooks.session.delete.after`. Síncrono y NUNCA lanza:
 * un listener que falla no puede romper el sign-out ni la revocación (un
 * error que no es `APIError` dentro de un hook de better-auth se propaga al
 * endpoint).
 */
export function notifySessionDeleted(
  session: DeletedSessionRow,
  context: SessionDeletionContext | null | undefined,
): void {
  const sessionId = typeof session.id === 'string' ? session.id : null;
  const userId = typeof session.userId === 'string' ? session.userId : null;
  if (!sessionId || !userId) {
    return;
  }
  const event: SessionEndedEvent = {
    sessionId,
    userId,
    reason: sessionEndReasonOf(session, context),
  };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      logger.error(
        `Un listener de fin de sesión falló (${error instanceof Error ? error.name : typeof error})`,
      );
    }
  }
}
