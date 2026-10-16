import { isAxiosError } from 'axios';
import { MAX_SCRUB_TEXT_LENGTH } from '../common/privacy/pii-mask';

/**
 * Fase 4 · P6.M: los cuerpos de error de la Control API de MediaMTX citan la
 * configuración del path, incluida la URL de origen de la cámara con
 * credenciales. Verificado contra v1.15.2: `{"error":"invalid source:
 * 'rtsp//admin:secreta@x'"}` (aunque la URL ni siquiera sea válida). Nunca se
 * loguea el cuerpo crudo: solo un resumen con las URLs y credenciales
 * redactadas.
 */

/** URL con esquema (`rtsp://`, `http://`, `rtsps+ws://`, ...) dentro de un texto. */
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi;

/** Cualquier palabra con forma `usuario:clave@host` aunque no sea una URL válida. */
const USERINFO_TOKEN = /[^\s'"<>]*:[^\s'"<>]*@[^\s'"<>]*/g;

/** El valor citado después de "source" (`source: '...'`, `source "..."`). */
const QUOTED_SOURCE = /(source\b[^'"\n]{0,20}['"])[^'"]*(['"])/gi;

/** Largo máximo del resumen de un error de MediaMTX que se loguea. */
export const MAX_MEDIAMTX_ERROR_SUMMARY_LENGTH = 200;

/**
 * Largo máximo del texto que pasa por las regex de arriba (Fase 4 · P7,
 * corrección cyber: igual que `common/privacy`). `USERINFO_TOKEN` y
 * `URL_IN_TEXT` son cuadráticas sobre un texto largo sin espacios (p. ej. un
 * cuerpo de error de megabytes): se recorta ANTES del scrub.
 */
export const MAX_MEDIAMTX_REDACTION_INPUT_LENGTH = MAX_SCRUB_TEXT_LENGTH;

/** Marca de un texto recortado antes de redactar. */
const TRUNCATED_MARK = ' […]';

const WHITESPACE = /\s/;

/**
 * `text` acotado para el scrub. Si sobra, se corta y se descarta además la
 * última palabra (hasta el último espacio): el corte pudo partir una URL o un
 * `usuario:clave@host`, y su resto ya no calzaría con las regex. Sin
 * espacios no queda nada que sea seguro mostrar.
 */
function boundForScrub(text: string): string {
  if (text.length <= MAX_MEDIAMTX_REDACTION_INPUT_LENGTH) {
    return text;
  }
  // Con la marca, el resultado no supera el máximo (aplicarla dos veces no
  // vuelve a cortar).
  const cut = text.slice(
    0,
    MAX_MEDIAMTX_REDACTION_INPUT_LENGTH - TRUNCATED_MARK.length,
  );
  let lastSpace = -1;
  for (let i = cut.length - 1; i >= 0; i--) {
    if (WHITESPACE.test(cut[i])) {
      lastSpace = i;
      break;
    }
  }
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : ''}${TRUNCATED_MARK}`;
}

/**
 * Deja solo esquema, host y puerto de una URL; la ruta, la query y el
 * fragmento van como `/***` / `?***` (algunas cámaras llevan usuario y clave
 * en la ruta o en la query). Con credenciales (`@`) o si la URL no se puede
 * interpretar, se redacta entera: una clave con `/` o `@` haría que parte de
 * ella pareciera el host. Ante la duda, de más.
 */
function stripUrlSecrets(url: string): string {
  const scheme = url.slice(0, url.indexOf('://') + 3);
  if (url.includes('@')) {
    return `${scheme}[redacted]`;
  }
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : '';
    const path = parsed.pathname && parsed.pathname !== '/' ? '/***' : '';
    const query = parsed.search || parsed.hash ? '?***' : '';
    return `${parsed.protocol}//${parsed.hostname}${port}${path}${query}`;
  } catch {
    return `${scheme}[redacted]`;
  }
}

/**
 * Reemplaza las credenciales de un texto: URLs (se deja solo esquema, host y
 * puerto), palabras con forma `usuario:clave@...` y el valor citado tras
 * "source". El texto se acota antes (`MAX_MEDIAMTX_REDACTION_INPUT_LENGTH`).
 */
export function redactUrlCredentials(text: string): string {
  return boundForScrub(text)
    .replace(QUOTED_SOURCE, '$1[redacted]$2')
    .replace(URL_IN_TEXT, (url) => stripUrlSecrets(url))
    .replace(USERINFO_TOKEN, '[redacted]');
}

/**
 * Texto del campo `error` de un cuerpo de MediaMTX (objeto ya parseado o JSON
 * como texto, p. ej. la respuesta WHEP con `responseType: 'text'`), o el
 * texto tal cual. SIN redactar: solo para decidir (`isPathNotConfiguredError`)
 * o para pasarlo por `describeMediamtxErrorBody`.
 */
function rawMediamtxErrorText(data: unknown): string | undefined {
  let body: unknown = data;
  if (typeof data === 'string') {
    try {
      body = JSON.parse(data) as unknown;
    } catch {
      return data;
    }
  }
  if (typeof body === 'string') {
    return body;
  }
  if (typeof body === 'object' && body !== null) {
    const error = (body as { error?: unknown }).error;
    return typeof error === 'string' ? error : undefined;
  }
  return undefined;
}

/**
 * Resumen corto y sin credenciales del cuerpo de error de MediaMTX (el campo
 * `error`), o `undefined` si no hay nada útil. Nunca devuelve el cuerpo crudo.
 */
export function describeMediamtxErrorBody(data: unknown): string | undefined {
  const text = rawMediamtxErrorText(data);
  if (!text || text.trim() === '') {
    return undefined;
  }
  const redacted = redactUrlCredentials(
    boundForScrub(text).replace(/\s+/g, ' ').trim(),
  );
  return redacted.length > MAX_MEDIAMTX_ERROR_SUMMARY_LENGTH
    ? `${redacted.slice(0, MAX_MEDIAMTX_ERROR_SUMMARY_LENGTH)}…`
    : redacted;
}

/**
 * ¿MediaMTX respondió que el path no existe? Pasa tras reiniciarlo: los paths
 * agregados por la Control API viven en memoria. WHEP responde 400
 * `{"error":"path 'x' is not configured"}` (verificado en v1.15.2).
 */
export function isPathNotConfiguredError(err: unknown): boolean {
  if (!isAxiosError(err) || !err.response) {
    return false;
  }
  const text = rawMediamtxErrorText(err.response.data);
  return text !== undefined && /is not configured/i.test(text);
}
