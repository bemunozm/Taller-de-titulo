import { createHash, timingSafeEqual } from 'crypto';

/**
 * Fase 4 · P6.M (D14): credencial compartida backend <-> MediaMTX.
 *
 * MediaMTX corre con `authMethod: http` (mediamtx/mediamtx.yml) y le pregunta
 * al backend (`POST /api/v1/internal/mediamtx/auth`) por cada lectura. El
 * forward WHEP del backend (`StreamsService`) se identifica con HTTP Basic
 * `vigilia-backend:<MEDIAMTX_AUTH_SECRET>`; MediaMTX reenvía esos valores como
 * `user`/`password` en el JSON de autorización. El secreto vive SOLO en el
 * env del backend: el `.yml` no tiene credenciales.
 */

/** Usuario Basic que el backend manda a MediaMTX (el secreto va como contraseña). */
export const MEDIAMTX_AUTH_USER = 'vigilia-backend';

/** `MEDIAMTX_AUTH_SECRET` recortado, o `null` si falta o está en blanco. */
export function readMediamtxAuthSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env.MEDIAMTX_AUTH_SECRET?.trim() ?? '';
  return value === '' ? null : value;
}

/** Valor del header `Authorization` del forward WHEP. */
export function mediamtxBasicAuthorization(secret: string): string {
  const token = Buffer.from(`${MEDIAMTX_AUTH_USER}:${secret}`, 'utf8').toString(
    'base64',
  );
  return `Basic ${token}`;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Compara un secreto recibido con el esperado en tiempo constante. Se comparan
 * los SHA-256 (32 bytes siempre) para que `timingSafeEqual` no lance ni
 * filtre el largo del secreto esperado.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}
