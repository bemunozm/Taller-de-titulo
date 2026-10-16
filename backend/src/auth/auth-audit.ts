import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { maskEmail } from '../common/privacy/pii-mask';
import { CLIENT_IP_HEADER } from './middleware/client-ip.middleware';

/**
 * Auditoría de login de better-auth (Fase 4 · P4.B).
 *
 * better-auth se construye FUERA del contenedor de Nest (better-auth.ts), así
 * que sus hooks no pueden inyectar `AuditService`. Este módulo es el puente:
 *  - better-auth.ts llama a los adaptadores de abajo desde `hooks.after` y
 *    `databaseHooks` (sin lógica propia allá);
 *  - un provider de Nest (`AuthAuditSinkRegistrar`) registra el *sink* al
 *    iniciar, conectándolo a `AuditService.log`.
 *
 * Best-effort: sin sink, o si el sink falla, el login sigue igual; el error va
 * al `Logger` sin datos sensibles. Nunca se lee ni se registra la contraseña
 * (del body solo se toma `email`).
 *
 * Sin imports de runtime de better-auth (es ESM-only): se puede testear con
 * Jest y lo puede cargar el CLI de better-auth sin arrastrar TypeORM.
 */

/** Rutas de better-auth relativas a su `basePath` (`/api/auth`). */
export const AUTH_BASE_PATH = '/api/auth';
export const SIGN_IN_EMAIL_PATH = '/sign-in/email';
export const SIGN_OUT_PATH = '/sign-out';
export const CHANGE_PASSWORD_PATH = '/change-password';

/**
 * Mismos nombres que `AuditAction` (audit-log.entity.ts). El cambio de
 * contraseña (`PASSWORD_CHANGE`) lo audita `@Auditable` en la ruta Nest
 * `update-password`: `/change-password` de better-auth está deshabilitado
 * por HTTP (lista blanca, better-auth-http-allowlist.ts).
 */
export type AuthAuditAction = 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT';

/** Código de better-auth para un email con formato inválido. */
const INVALID_EMAIL_CODE = 'INVALID_EMAIL';

export interface AuthAuditEvent {
  readonly action: AuthAuditAction;
  readonly userId?: string;
  /**
   * Solo en `LOGIN_FAILED`: email intentado, ENMASCARADO (`a***@dominio.cl`,
   * corrección P7, cyber B4). `null` si no parece un email (podría ser la
   * contraseña tipeada en el campo email).
   */
  readonly attemptedEmail?: string | null;
  /**
   * Solo en `LOGIN_FAILED`: HMAC del email intentado (normalizado) con una
   * clave del servidor (`attemptedEmailFingerprint`). Permite correlacionar
   * intentos contra la misma cuenta sin guardar el email. `null` si no hay
   * email o no hay clave.
   */
  readonly attemptedEmailHash?: string | null;
  /** Solo en `LOGIN_FAILED`: código de error de better-auth. */
  readonly reason?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  /** Ruta completa (`/api/auth/...`). */
  readonly endpoint?: string;
}

export type AuthAuditSink = (event: AuthAuditEvent) => Promise<void> | void;

const logger = new Logger('AuthAudit');

let auditSink: AuthAuditSink | null = null;

/** Registra (o quita, con `null`) el destino de los eventos de auditoría. */
export function setAuthAuditSink(sink: AuthAuditSink | null): void {
  auditSink = sink;
}

/**
 * Entrega el evento al sink. Nunca lanza: un sink ausente o que falla no
 * bloquea el flujo de autenticación.
 */
export async function emitAuthAuditEvent(event: AuthAuditEvent): Promise<void> {
  const sink = auditSink;
  if (!sink) {
    return;
  }
  try {
    await sink(event);
  } catch (error) {
    // Solo la acción y el tipo de error: el mensaje podría traer el email.
    logger.error(
      `No se pudo registrar el evento de auditoría ${event.action} (${errorName(error)})`,
    );
  }
}

/** Forma mínima de una sesión de better-auth que usan los hooks. */
export interface AuditedSession {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Forma mínima del contexto de endpoint que better-auth pasa a los hooks. */
export interface AuditedEndpointContext {
  path?: string;
  headers?: Headers | null;
  request?: { headers: Headers } | null;
}

/**
 * `databaseHooks.session.create.after`: una sesión creada es un `LOGIN`,
 * salvo la rotación de `/change-password` (la llamada server-side de
 * `update-password`, que se audita como `PASSWORD_CHANGE` con `@Auditable`).
 */
export async function auditSessionCreated(
  session: AuditedSession,
  context: AuditedEndpointContext | null,
): Promise<void> {
  if (context?.path === CHANGE_PASSWORD_PATH) {
    return;
  }
  await emitAuthAuditEvent({
    action: 'LOGIN',
    userId: session.userId,
    ip: nonEmpty(session.ipAddress) ?? clientIpOf(context),
    userAgent: truncate(nonEmpty(session.userAgent)) ?? userAgentOf(context),
    endpoint: endpointOf(context),
  });
}

/**
 * `databaseHooks.session.delete.after`: la sesión borrada por `/sign-out` es
 * un `LOGOUT`. Las revocaciones (cambio o reset de contraseña) no lo son.
 */
export async function auditSessionDeleted(
  session: AuditedSession,
  context: AuditedEndpointContext | null,
): Promise<void> {
  if (context?.path !== SIGN_OUT_PATH) {
    return;
  }
  await emitAuthAuditEvent({
    action: 'LOGOUT',
    userId: session.userId,
    ip: clientIpOf(context),
    userAgent: userAgentOf(context),
    endpoint: endpointOf(context),
  });
}

/** Resultado de un endpoint de better-auth, tal como lo ve `hooks.after`. */
export interface AuditedEndpointResult extends AuditedEndpointContext {
  body?: unknown;
  /** `ctx.context.returned`: la respuesta o el `APIError` del endpoint. */
  returned: unknown;
  /** `true` si `returned` es un `APIError` (lo decide better-auth.ts). */
  failed: boolean;
}

/**
 * `hooks.after`: `/sign-in/email` fallido -> `LOGIN_FAILED` con el email
 * intentado (solo si parece un email, ver `attemptedEmailFor`; nunca la
 * contraseña) y el código de error.
 */
export async function auditAuthEndpointResult(
  result: AuditedEndpointResult,
): Promise<void> {
  if (result.path !== SIGN_IN_EMAIL_PATH || !result.failed) {
    return;
  }
  const reason = errorCodeOf(result.returned);
  const email = attemptedEmailFor(readField(result.body, 'email'), reason);
  await emitAuthAuditEvent({
    action: 'LOGIN_FAILED',
    // Corrección P7 (cyber B4): el email nunca sale de acá en claro.
    attemptedEmail: email ? maskEmail(email) : null,
    attemptedEmailHash: email ? attemptedEmailFingerprint(email) : null,
    reason,
    ip: clientIpOf(result),
    userAgent: userAgentOf(result),
    endpoint: endpointOf(result),
  });
}

/**
 * Email intentado que se puede guardar (cyber M3): solo si tiene formato de
 * email y better-auth no lo rechazó por formato (`INVALID_EMAIL`). Si no,
 * `null`: un usuario pudo tipear la contraseña en el campo email.
 */
export function attemptedEmailFor(
  value: unknown,
  reason: string | undefined,
): string | null {
  if (reason === INVALID_EMAIL_CODE) {
    return null;
  }
  const email = normalizeEmail(value);
  return email && isEmail(email) ? email : null;
}

/** Contexto de la clave derivada (versionado: cambiarlo rompe la correlación). */
const ATTEMPTED_EMAIL_KEY_CONTEXT = 'vigilia:audit:attempted-email:v1';

/** Largo del fingerprint en hex (128 bits). */
const FINGERPRINT_HEX_LENGTH = 32;

/**
 * Corrección P7 (cyber B4): huella del email intentado para `LOGIN_FAILED`,
 * `HMAC-SHA256(k, email)` con `k = HMAC-SHA256(BETTER_AUTH_SECRET, contexto)`
 * (clave derivada: el secreto de sesiones no se usa directo). Determinística
 * mientras no cambie el secreto, así se pueden agrupar los intentos contra
 * una misma cuenta; sin el secreto no se puede revertir ni probar emails por
 * diccionario. `null` sin secreto.
 */
export function attemptedEmailFingerprint(
  email: string,
  secret: string | undefined = process.env.BETTER_AUTH_SECRET,
): string | null {
  if (!secret) {
    return null;
  }
  const key = createHmac('sha256', secret)
    .update(ATTEMPTED_EMAIL_KEY_CONTEXT)
    .digest();
  return createHmac('sha256', key)
    .update(email)
    .digest('hex')
    .slice(0, FINGERPRINT_HEX_LENGTH);
}

/** Email en minúsculas, sin espacios y acotado (`undefined` si no es texto). */
export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const email = value.trim().toLowerCase();
  return email.length > 0 ? email.slice(0, 254) : undefined;
}

function readField(source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }
  return (source as Record<string, unknown>)[key];
}

function errorCodeOf(returned: unknown): string | undefined {
  const code = readField(readField(returned, 'body'), 'code');
  return typeof code === 'string' ? code : undefined;
}

function headersOf(context: AuditedEndpointContext | null): Headers | null {
  return context?.headers ?? context?.request?.headers ?? null;
}

/**
 * IP del cliente: `x-client-ip`, la única fuente que lee better-auth (la
 * escribe `clientIpHeaderMiddleware` con `req.ip`, respetando TRUST_PROXY).
 */
function clientIpOf(
  context: AuditedEndpointContext | null,
): string | undefined {
  return nonEmpty(headersOf(context)?.get(CLIENT_IP_HEADER));
}

function userAgentOf(
  context: AuditedEndpointContext | null,
): string | undefined {
  return truncate(nonEmpty(headersOf(context)?.get('user-agent')));
}

function endpointOf(
  context: AuditedEndpointContext | null,
): string | undefined {
  return context?.path ? `${AUTH_BASE_PATH}${context.path}` : undefined;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function truncate(value: string | undefined): string | undefined {
  return value?.slice(0, 512);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
