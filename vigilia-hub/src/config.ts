/**
 * Configuración central del hub (Fase 4 · P6.M).
 *
 * Antes cada servicio leía `process.env` por su cuenta, sin validar: aceptaba
 * `http://` contra el backend en producción, inventaba un `HUB_ID` aleatorio
 * si faltaba y `DEBUG_OPENAI_KEY` saltaba al backend sin importar el entorno.
 * Ahora `loadHubConfig` lee y valida el entorno UNA vez al arrancar
 * (`main.ts`) y los servicios reciben el resultado por constructor.
 *
 * Reglas:
 *  - Entorno estricto (producción) salvo `NODE_ENV=development` o `test`. Un
 *    `NODE_ENV` ausente o desconocido (p. ej. `staging`) se trata como
 *    producción: ante la duda, las reglas estrictas.
 *  - `BACKEND_URL`: solo el origen (`https://host[:puerto]`). En producción
 *    exige `https://`; en desarrollo acepta `http://` con un aviso. De ella se
 *    deriva el WebSocket (`wss://` / `ws://`). `BACKEND_API_URL` es el nombre
 *    viejo de la misma URL: se acepta como alias, pero si están las dos deben
 *    coincidir.
 *  - `HUB_ID` y `HUB_SECRET` son obligatorios en todo entorno (nunca un id
 *    aleatorio: el backend rechazaría al hub igual).
 *  - `DEBUG_OPENAI_KEY` (API key directa de OpenAI, salta al backend) está
 *    prohibida en producción; en desarrollo se acepta con un aviso.
 *
 * Los mensajes de error nombran la variable y el motivo, nunca su valor.
 */

export type HubEnvironment = 'production' | 'development' | 'test';

export interface HubConfig {
  /** Entorno efectivo: `production` aplica las reglas estrictas. */
  readonly environment: HubEnvironment;
  /** Origen HTTP(S) del backend, sin barra final (`https://host[:puerto]`). */
  readonly backendUrl: string;
  /** Mismo origen con esquema WebSocket (`wss://` / `ws://`). */
  readonly backendSocketUrl: string;
  readonly hubId: string;
  readonly hubSecret: string;
  /** Solo en desarrollo; `null` si no está definida. */
  readonly debugOpenAiKey: string | null;
}

/** La configuración del entorno no es válida: el hub no debe arrancar. */
export class HubConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      `Configuración inválida del hub (revisa vigilia-hub/.env; ver .env.example):\n${issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}`,
    );
    this.name = 'HubConfigError';
  }
}

/** Formato de `hubId` que acepta el backend (`CreateHubDto`). */
const HUB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Largo mínimo de `HUB_SECRET` (el backend genera 64 caracteres hex). */
export const MIN_HUB_SECRET_LENGTH = 32;

/** Valores de relleno evidentes (se evalúan sobre el valor en minúsculas). */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /change[-_ ]?me/,
  /^your[-_]/,
  /^<.*>$/,
  /example/,
  /placeholder/,
  /^(?:changeme|todo|xxx+)$/,
];

function isPlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Valor recortado, o `null` si falta o está en blanco. */
function nonBlank(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function resolveEnvironment(
  raw: string | undefined,
  warnings: string[],
): HubEnvironment {
  const value = nonBlank(raw)?.toLowerCase() ?? null;
  if (value === 'development' || value === 'test') {
    return value;
  }
  if (value === null) {
    warnings.push(
      'NODE_ENV no está definido: se aplican las reglas de producción (para desarrollo local define NODE_ENV=development)',
    );
  } else if (value !== 'production') {
    warnings.push(
      'NODE_ENV no es development/test/production: se aplican las reglas de producción',
    );
  }
  return 'production';
}

/** Interpreta una URL del backend; agrega el problema a `issues` si no sirve. */
function parseBackendUrl(
  name: string,
  raw: string,
  strict: boolean,
  issues: string[],
  warnings: string[],
): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    issues.push(`${name} no es una URL válida`);
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    issues.push(`${name} debe usar https:// (http:// solo en desarrollo)`);
    return null;
  }
  if (url.username !== '' || url.password !== '') {
    issues.push(`${name} no debe llevar usuario ni contraseña`);
    return null;
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    issues.push(
      `${name} debe ser solo el origen (esquema://host[:puerto]), sin ruta ni query: el hub agrega /api/v1 y /hub`,
    );
    return null;
  }
  if (url.protocol === 'http:') {
    if (strict) {
      issues.push(
        `${name} debe usar https:// en producción (http:// solo con NODE_ENV=development)`,
      );
      return null;
    }
    warnings.push(
      `${name} usa http:// (tráfico y credencial del hub sin cifrar): aceptable solo en desarrollo`,
    );
  }
  return url;
}

/**
 * `BACKEND_URL` (o su alias viejo `BACKEND_API_URL`): una sola URL de
 * backend. Si están las dos y no coinciden, es un error.
 */
function resolveBackendUrl(
  env: NodeJS.ProcessEnv,
  strict: boolean,
  issues: string[],
  warnings: string[],
): URL | null {
  const primaryRaw = nonBlank(env.BACKEND_URL);
  const legacyRaw = nonBlank(env.BACKEND_API_URL);
  if (!primaryRaw && !legacyRaw) {
    issues.push('BACKEND_URL es obligatoria');
    return null;
  }
  const primary = primaryRaw
    ? parseBackendUrl('BACKEND_URL', primaryRaw, strict, issues, warnings)
    : null;
  const legacy = legacyRaw
    ? parseBackendUrl('BACKEND_API_URL', legacyRaw, strict, issues, warnings)
    : null;

  if (primaryRaw && legacyRaw) {
    if (primary && legacy && primary.origin !== legacy.origin) {
      issues.push(
        'BACKEND_API_URL no coincide con BACKEND_URL: son la misma URL, deja solo BACKEND_URL',
      );
      return null;
    }
    if (primary && legacy) {
      warnings.push('BACKEND_API_URL es redundante (igual a BACKEND_URL): puedes quitarla');
    }
    return primary;
  }
  if (legacyRaw) {
    warnings.push('BACKEND_API_URL está obsoleta: renómbrala a BACKEND_URL');
    return legacy;
  }
  return primary;
}

function resolveHubId(env: NodeJS.ProcessEnv, issues: string[]): string | null {
  const hubId = nonBlank(env.HUB_ID);
  if (!hubId) {
    issues.push('HUB_ID es obligatorio (el hubId con el que se provisionó este hub en el backend)');
    return null;
  }
  if (isPlaceholder(hubId) || !HUB_ID_PATTERN.test(hubId)) {
    issues.push(
      'HUB_ID debe tener solo letras, números, guiones y guiones bajos (máx. 64), y no un valor de ejemplo',
    );
    return null;
  }
  return hubId;
}

function resolveHubSecret(env: NodeJS.ProcessEnv, issues: string[]): string | null {
  const hubSecret = nonBlank(env.HUB_SECRET);
  if (!hubSecret) {
    issues.push('HUB_SECRET es obligatorio (el secret que devolvió POST /hubs al provisionar)');
    return null;
  }
  if (isPlaceholder(hubSecret)) {
    issues.push('HUB_SECRET tiene un valor de ejemplo/placeholder; configura el secret real');
    return null;
  }
  if (hubSecret.length < MIN_HUB_SECRET_LENGTH || /\s/.test(hubSecret)) {
    issues.push(
      `HUB_SECRET debe tener al menos ${MIN_HUB_SECRET_LENGTH} caracteres y sin espacios (el backend genera 64)`,
    );
    return null;
  }
  return hubSecret;
}

function resolveDebugOpenAiKey(
  env: NodeJS.ProcessEnv,
  strict: boolean,
  issues: string[],
  warnings: string[],
): string | null {
  const key = nonBlank(env.DEBUG_OPENAI_KEY);
  if (!key) {
    return null;
  }
  if (strict) {
    issues.push(
      'DEBUG_OPENAI_KEY está prohibida en producción: salta la autenticación del backend y usa una API key de OpenAI completa',
    );
    return null;
  }
  warnings.push(
    'DEBUG_OPENAI_KEY definida: las llamadas usan la API key directa y no pasan por el backend (solo desarrollo)',
  );
  return key;
}

/** `https:` -> `wss:`, `http:` -> `ws:`. */
function socketOrigin(url: URL): string {
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}`;
}

/**
 * Lee y valida el entorno. Lanza `HubConfigError` con TODOS los problemas
 * (sin valores). Los avisos (`http://` en desarrollo, alias viejo, debug) se
 * entregan a `onWarning`.
 */
export function loadHubConfig(
  env: NodeJS.ProcessEnv = process.env,
  onWarning: (message: string) => void = () => undefined,
): HubConfig {
  const issues: string[] = [];
  const warnings: string[] = [];

  const environment = resolveEnvironment(env.NODE_ENV, warnings);
  const strict = environment === 'production';
  const backend = resolveBackendUrl(env, strict, issues, warnings);
  const hubId = resolveHubId(env, issues);
  const hubSecret = resolveHubSecret(env, issues);
  const debugOpenAiKey = resolveDebugOpenAiKey(env, strict, issues, warnings);

  if (issues.length > 0 || !backend || !hubId || !hubSecret) {
    throw new HubConfigError(issues);
  }
  warnings.forEach((warning) => onWarning(warning));

  return Object.freeze({
    environment,
    backendUrl: backend.origin,
    backendSocketUrl: socketOrigin(backend),
    hubId,
    hubSecret,
    debugOpenAiKey,
  });
}
