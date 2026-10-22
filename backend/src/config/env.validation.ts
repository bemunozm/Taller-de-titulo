import { Logger } from '@nestjs/common';
import { isIP } from 'net';
import { z } from 'zod';

/**
 * Validación de configuración al arranque (P2, docs/modulos/hardening-pre-piloto.md §2).
 *
 * Se engancha en `ConfigModule.forRoot({ validate })`. Falla rápido, con un
 * mensaje que nombra la variable y el motivo pero NUNCA imprime su valor
 * (los secretos no deben terminar en logs de arranque / CI).
 */

/**
 * Valores exactos de `backend/.env.example` que representan "aún no
 * configurado". Se mantienen en código (el `.env.example` no se despliega) y
 * un test verifica que cada secreto del ejemplo es rechazado.
 */
export const KNOWN_PLACEHOLDER_VALUES: readonly string[] = [
  'your_database_password',
  'your_better_auth_secret_min_32_chars',
  'change-me-generate-with-openssl-rand-base64-32',
  'change-me-generate-with-openssl-rand-base64-32-bytes',
];

/** Patrones evidentes de valor de relleno (se evalúan sobre el valor en minúsculas). */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /change[-_ ]?me/,
  /^your[-_]/,
  /^<.*>$/,
  /example/,
  /placeholder/,
  /^(?:changeme|todo|xxx+)$/,
];

export function isPlaceholderValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (
    KNOWN_PLACEHOLDER_VALUES.some((known) => known.toLowerCase() === normalized)
  ) {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function isBase64Of32Bytes(value: string): boolean {
  return (
    BASE64_PATTERN.test(value) && Buffer.from(value, 'base64').length === 32
  );
}

/** Mensaje único para "falta" y "vacía" (las reglas siguientes no se evalúan). */
const REQUIRED = { message: 'es obligatoria', abort: true } as const;

/** String no vacío (se recorta) y que no sea un placeholder conocido. */
const realSecret = z
  .string({ error: REQUIRED.message })
  .trim()
  .min(1, REQUIRED)
  .refine((value) => !isPlaceholderValue(value), {
    message: 'tiene un valor de ejemplo/placeholder; configura un valor real',
  });

/** Secreto real de al menos 32 caracteres (placeholders rechazados). */
const strongSecret = realSecret.refine((value) => value.length >= 32, {
  message:
    'debe tener al menos 32 caracteres (genera uno con `openssl rand -base64 32`)',
});

/** Variable opcional: un valor vacío o solo espacios cuenta como ausente. */
function optionalNonBlank<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    schema.optional(),
  );
}

const requiredString = z
  .string({ error: REQUIRED.message })
  .trim()
  .min(1, REQUIRED);

const booleanString = z.enum(['true', 'false'], {
  error: 'debe ser "true" o "false"',
});

/**
 * TRUST_PROXY = cantidad de reverse proxies delante del backend. `true` se
 * rechaza: Express confiaría en todo `X-Forwarded-For`, también en las
 * entradas que agrega el cliente, y `req.ip` (rate limit, auditoría,
 * `x-client-ip` de better-auth) pasaría a ser la IP que el cliente elija.
 */
const TRUST_PROXY_TRUE_MESSAGE =
  '"true" no está permitido: haría confiar en cualquier X-Forwarded-For, incluido el que envía el cliente (IP falsificable). Usa el número de proxies delante del backend (p. ej. 1) o "false"';
const TRUST_PROXY_FORMAT_MESSAGE =
  'debe ser un entero >= 0 (proxies delante del backend) o "false"';

/** Motivo por el que `value` (ya recortado y no vacío) no es un TRUST_PROXY válido. */
function trustProxyIssue(value: string): string | null {
  if (value.toLowerCase() === 'true') {
    return TRUST_PROXY_TRUE_MESSAGE;
  }
  if (value !== 'false' && !/^\d+$/.test(value)) {
    return TRUST_PROXY_FORMAT_MESSAGE;
  }
  return null;
}

const trustProxy = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const issue = trustProxyIssue(value);
    if (issue) {
      ctx.addIssue({ code: 'custom', message: issue });
    }
  });

/**
 * VISIT_APPROVAL_TTL_MINUTES (Fase 4 · P3): minutos que una solicitud del
 * conserje digital (`AWAITING_APPROVAL`) espera la respuesta del residente
 * antes de que el cron la pase a `EXPIRED`. Opcional; default 30. Tope de
 * 24 h, el máximo de VISIT_CONCIERGE_VALIDITY_HOURS: pasada la validez de la
 * visita, la expira igual el barrido por `validUntil`.
 */
export const DEFAULT_VISIT_APPROVAL_TTL_MINUTES = 30;
export const MAX_VISIT_APPROVAL_TTL_MINUTES = 24 * 60;

/**
 * VISIT_CONCIERGE_VALIDITY_HOURS (Fase 4 · P3, QA N1): horas de validez de la
 * visita que crea el conserje digital (`validUntil` = creación + estas horas).
 * La visita aprobada queda en curso con el check-in de la apertura; si el LPR
 * no ve la salida, una ventana corta acota cuánto tiempo un regreso del mismo
 * auto se lee como "salida" y abre. Opcional; default 4, entre 1 y 24.
 */
export const DEFAULT_VISIT_CONCIERGE_VALIDITY_HOURS = 4;
export const MAX_VISIT_CONCIERGE_VALIDITY_HOURS = 24;

/**
 * VISIT_ACTIVE_GRACE_HOURS (Fase 4 · P7, corrección QA A1): horas después del
 * fin de la validez (`validUntil`) en que una visita `ACTIVE` (adentro, sin
 * salida registrada: el LPR no la vio salir) se cierra como `EXPIRED`. Sin
 * este cierre quedaba ACTIVE para siempre y la retención nunca la
 * anonimizaba. Opcional; default 24, entre 1 y 168 (una semana).
 */
export const DEFAULT_VISIT_ACTIVE_GRACE_HOURS = 24;
export const MAX_VISIT_ACTIVE_GRACE_HOURS = 168;

/**
 * VISIT_EXIT_COOLDOWN_MINUTES (Fase 4 · P3, decisión de Benjamin): minutos
 * después del ingreso de una visita durante los que el LPR NO registra su
 * salida. Las cámaras no saben si miran la entrada o la salida, así que una
 * lectura del mismo auto que todavía está pasando se confundiría con una
 * salida. La misma espera aplica después de la salida: el auto que sigue
 * saliendo no se lee como reingreso. Opcional; default 5, entre 1 y 120.
 */
export const DEFAULT_VISIT_EXIT_COOLDOWN_MINUTES = 5;
export const MAX_VISIT_EXIT_COOLDOWN_MINUTES = 120;

/**
 * LPR_PASSAGE_WINDOW_SECONDS (dirección + pasadas multicámara): segundos
 * durante los que las lecturas de una misma patente (de cualquier cámara del
 * condominio) se agrupan en UNA pasada: un solo intento de acceso y una sola
 * apertura. La ventana es deslizante (cada lectura la renueva). Opcional;
 * default 60, entre 1 y 600.
 */
export const DEFAULT_LPR_PASSAGE_WINDOW_SECONDS = 60;
export const MAX_LPR_PASSAGE_WINDOW_SECONDS = 600;

/**
 * LPR_PASSAGE_REVERSE_MIN_SECONDS: segundos mínimos desde el inicio de una
 * pasada para que una lectura con la dirección contraria (ambas medidas por
 * cruce de línea) abra una pasada NUEVA (el auto que entra y sale enseguida).
 * Antes de eso es evidencia: un cruce espurio no abre el portón dos veces.
 * Opcional; default 15, entre 1 y 600.
 */
export const DEFAULT_LPR_PASSAGE_REVERSE_MIN_SECONDS = 15;
export const MAX_LPR_PASSAGE_REVERSE_MIN_SECONDS = 600;

/**
 * LPR_PASSAGE_ORPHAN_SECONDS: segundos tras los que una pasada SIN intento
 * (el líder murió o se colgó antes de decidir) deja de absorber lecturas: la
 * siguiente toma el liderazgo. Opcional; default 30, entre 1 y 600.
 */
export const DEFAULT_LPR_PASSAGE_ORPHAN_SECONDS = 30;
export const MAX_LPR_PASSAGE_ORPHAN_SECONDS = 600;

/**
 * LPR_PASSAGE_FUZZY_SECONDS: segundos (medidos contra la última lectura de la
 * pasada) durante los que una lectura SIN pasada exacta puede agruparse en la
 * pasada abierta de otra patente de igual largo que difiere en un solo
 * carácter (variante de OCR entre cámaras). `0` la desactiva. Opcional;
 * default 30, entre 0 y 600 (en la práctica se acota por la ventana de pasada).
 */
export const DEFAULT_LPR_PASSAGE_FUZZY_SECONDS = 30;
export const MAX_LPR_PASSAGE_FUZZY_SECONDS = 600;

/** Unidad de una variable de duración entera (aparece en el mensaje de error). */
type DurationUnit = 'segundos' | 'minutos' | 'horas' | 'días';

/**
 * Motivo por el que `value` (ya recortado y no vacío) no es un entero de
 * `unit` entre `min` (1 salvo que la variable admita 0) y `max`.
 */
function integerDurationIssue(
  value: string,
  max: number,
  unit: DurationUnit,
  min = 1,
): string | null {
  const message = `debe ser un entero de ${unit} entre ${min} y ${max}`;
  if (!/^\d+$/.test(value)) {
    return message;
  }
  const amount = Number.parseInt(value, 10);
  if (amount < min || amount > max) {
    return message;
  }
  return null;
}

/** Esquema de una variable de duración entera (entre 1 y `max`). */
function integerDuration(max: number, unit: DurationUnit, min = 1) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const issue = integerDurationIssue(value, max, unit, min);
      if (issue) {
        ctx.addIssue({ code: 'custom', message: issue });
      }
    });
}

/**
 * Interpreta una variable de duración entera. Ausente o vacía -> `fallback`.
 * Un valor inválido lanza (fail-closed), aunque `validateEnv` ya lo haya
 * rechazado al arrancar.
 */
function parseIntegerDuration(
  name: string,
  raw: string | undefined,
  fallback: number,
  max: number,
  unit: DurationUnit,
  min = 1,
): number {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return fallback;
  }
  const issue = integerDurationIssue(value, max, unit, min);
  if (issue) {
    throw new Error(`${name}: ${issue}`);
  }
  return Number.parseInt(value, 10);
}

/**
 * Plazos de retención (Fase 4 · P7.R, docs/modulos/privacidad-ley-21719.md
 * §3): días que se conserva cada categoría antes de borrarla o anonimizarla.
 * La ley no fija plazos: son criterio propio por proporcionalidad (30 días
 * para imágenes sigue al CPLT, Oficio 2309/2017). Todos son opcionales; el
 * máximo evita un plazo "infinito" por error de tipeo y sigue el mismo
 * criterio (imágenes y logs técnicos hasta 1 año; registros de acceso,
 * visitas y cuentas hasta 5 años; auditoría hasta 10).
 */
export const RETENTION_PERIODS = {
  RETENTION_IMAGES_DAYS: { defaultDays: 30, maxDays: 365 },
  RETENTION_VISITS_DAYS: { defaultDays: 90, maxDays: 1825 },
  RETENTION_ACCESS_LOG_DAYS: { defaultDays: 90, maxDays: 1825 },
  RETENTION_ANOMALIES_DAYS: { defaultDays: 90, maxDays: 1825 },
  RETENTION_NOTIFICATIONS_DAYS: { defaultDays: 90, maxDays: 1825 },
  RETENTION_PENDING_ACTIONS_DAYS: { defaultDays: 90, maxDays: 1825 },
  RETENTION_AUDIT_DAYS: { defaultDays: 365, maxDays: 3650 },
  RETENTION_SYSTEM_LOGS_DAYS: { defaultDays: 30, maxDays: 365 },
  RETENTION_DISABLED_USERS_DAYS: { defaultDays: 30, maxDays: 1825 },
} as const satisfies Record<string, { defaultDays: number; maxDays: number }>;

export type RetentionPeriodName = keyof typeof RETENTION_PERIODS;

/**
 * Interpreta un plazo de retención (`RETENTION_*_DAYS`). Ausente o vacío ->
 * su default. Un valor inválido lanza (fail-closed), aunque `validateEnv` ya
 * lo haya rechazado al arrancar.
 */
export function parseRetentionDays(
  name: RetentionPeriodName,
  raw: string | undefined,
): number {
  const { defaultDays, maxDays } = RETENTION_PERIODS[name];
  return parseIntegerDuration(name, raw, defaultDays, maxDays, 'días');
}

/**
 * Interpreta una variable booleana ("true"/"false", sin distinguir
 * mayúsculas ni espacios). Ausente o vacía -> `fallback`; otro valor lanza.
 */
export function parseBooleanFlag(
  name: string,
  raw: string | undefined,
  fallback: boolean,
): boolean {
  const value = raw?.trim().toLowerCase() ?? '';
  if (value === '') {
    return fallback;
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  throw new Error(`${name}: debe ser "true" o "false"`);
}

/**
 * LOG_LEVEL (Fase 4 · P7, docs/modulos/privacidad-ley-21719.md §3): umbral
 * del logger de Nest (`error|warn|log|debug|verbose`; cada nivel incluye a
 * los más graves). Acá solo se valida el VALOR al arrancar: un valor inválido
 * detiene el arranque en vez de caer en silencio en el default. Los niveles y
 * el default (`log` en producción o sin NODE_ENV, `verbose` en desarrollo y
 * test) los resuelve `resolveLogLevels` (common/logging/log-levels.ts, P7.L)
 * antes de crear la app. La lista debe coincidir con `LOG_LEVEL_THRESHOLDS`
 * (lo fija un test).
 */
export const LOG_LEVEL_VALUES = [
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
] as const;

export type AppLogLevel = (typeof LOG_LEVEL_VALUES)[number];

const LOG_LEVEL_MESSAGE = `debe ser uno de: ${LOG_LEVEL_VALUES.join(', ')}`;

function isAppLogLevel(value: string): value is AppLogLevel {
  return (LOG_LEVEL_VALUES as readonly string[]).includes(value);
}

/**
 * MEDIAMTX_AUTH_ALLOWED_IPS (Fase 4 · P6.M, corrección cyber): IPs desde las
 * que se acepta `POST /internal/mediamtx/auth` (la IP del socket, no
 * `X-Forwarded-For`). Default: MediaMTX en el mismo host.
 */
export const DEFAULT_MEDIAMTX_AUTH_ALLOWED_IPS: readonly string[] = [
  '127.0.0.1',
  '::1',
];

const IP_LIST_MESSAGE =
  'debe ser una lista de IPs (v4 o v6) separadas por coma, sin máscaras ni nombres de host';

/**
 * Forma canónica de una IP para compararla: una IPv4 mapeada en IPv6
 * (`::ffff:127.0.0.1`, lo que reporta un socket dual-stack) queda como IPv4 y
 * una IPv6 se comprime (`0:0:0:0:0:0:0:1` -> `::1`). `null` si no es una IP.
 */
export function normalizeIp(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped && isIP(mapped[1]) === 4) {
    return mapped[1];
  }
  const family = isIP(value);
  if (family === 4) {
    return value;
  }
  if (family === 6) {
    // El parser de URL comprime la IPv6 a su forma canónica.
    return new URL(`http://[${value}]`).hostname.slice(1, -1);
  }
  return null;
}

/**
 * HOST (Fase 4 · P9): interfaz en la que escucha el servidor HTTP. Default
 * `0.0.0.0` (todas): el hub de la Raspberry y el LPR llegan por la LAN. Con
 * `TRUST_PROXY` activo conviene `127.0.0.1` (solo el proxy del mismo host) o
 * un firewall: ver `trustProxyExposureWarning` (config/server-exposure.ts).
 */
export const DEFAULT_LISTEN_HOST = '0.0.0.0';

const LISTEN_HOST_MESSAGE =
  'debe ser una IP (v4 o v6, sin corchetes) o un nombre de host válido (p. ej. 0.0.0.0, 127.0.0.1, ::1 o localhost)';

/** Nombre de host RFC 1123: etiquetas de 1-63 caracteres, 253 en total. */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** Motivo por el que `value` (ya recortado y no vacío) no es un HOST válido. */
function listenHostIssue(value: string): string | null {
  return isIP(value) !== 0 || HOSTNAME_PATTERN.test(value)
    ? null
    : LISTEN_HOST_MESSAGE;
}

const listenHost = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const issue = listenHostIssue(value);
    if (issue) {
      ctx.addIssue({ code: 'custom', message: issue });
    }
  });

/**
 * Interpreta HOST. Ausente o vacío -> `0.0.0.0`. Un valor inválido lanza
 * (fail-closed), aunque `validateEnv` ya lo haya rechazado al arrancar.
 */
export function parseListenHost(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return DEFAULT_LISTEN_HOST;
  }
  const issue = listenHostIssue(value);
  if (issue) {
    throw new Error(`HOST: ${issue}`);
  }
  return value;
}

/**
 * ¿`host` es loopback? `localhost`, `127.0.0.0/8` y `::1` (también la IPv4
 * mapeada `::ffff:127.x.y.z` y la IPv6 entre corchetes de una URL). Sin
 * resolver DNS: cualquier otro nombre cuenta como NO loopback.
 */
export function isLoopbackHost(host: string): boolean {
  const value = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  if (value === 'localhost') {
    return true;
  }
  const ip = normalizeIp(value);
  if (ip === null) {
    return false;
  }
  return ip === '::1' || (isIP(ip) === 4 && ip.startsWith('127.'));
}

/** Entradas de una lista separada por comas (recortadas, sin vacías). */
function listEntries(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

const ipList = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const entries = listEntries(value);
    if (entries.length === 0 || entries.some((e) => normalizeIp(e) === null)) {
      ctx.addIssue({ code: 'custom', message: IP_LIST_MESSAGE });
    }
  });

/**
 * Interpreta MEDIAMTX_AUTH_ALLOWED_IPS. Ausente o vacía -> loopback
 * (`127.0.0.1`, `::1`). Un valor inválido lanza (fail-closed), aunque
 * `validateEnv` ya lo haya rechazado al arrancar.
 */
export function parseMediamtxAuthAllowedIps(
  raw: string | undefined,
): ReadonlySet<string> {
  const value = raw?.trim() ?? '';
  const entries =
    value === '' ? [...DEFAULT_MEDIAMTX_AUTH_ALLOWED_IPS] : listEntries(value);
  const normalized = entries.map((entry) => normalizeIp(entry));
  if (normalized.length === 0 || normalized.some((ip) => ip === null)) {
    throw new Error(`MEDIAMTX_AUTH_ALLOWED_IPS: ${IP_LIST_MESSAGE}`);
  }
  return new Set(normalized as string[]);
}

/**
 * OPENAI_API_BASE_URL (Fase 4 · P8): origen de la API de OpenAI para las
 * llamadas HTTP directas del backend (hoy, el token efímero de voz Realtime de
 * `RealtimeVoiceTokenService`). Default: la API oficial. Los e2e la apuntan a
 * un servidor falso local. Cada request lleva `OPENAI_API_KEY`, así que en
 * producción debe ser https. Sin usuario, contraseña, query ni fragmento: se le
 * concatenan rutas como `/v1/realtime/client_secrets`. Los clientes del SDK
 * (agente y visión) usan la variable estándar `OPENAI_BASE_URL`.
 */
export const DEFAULT_OPENAI_API_BASE_URL = 'https://api.openai.com';

const OPENAI_API_BASE_URL_MESSAGE =
  'debe ser una URL http(s) sin usuario, contraseña, query ni fragmento (p. ej. https://api.openai.com)';

/** Motivo por el que `value` (ya recortado y no vacío) no es una base válida. */
function openAiApiBaseUrlIssue(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return OPENAI_API_BASE_URL_MESSAGE;
  }
  const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
  const hasExtras =
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '';
  return isHttp && !hasExtras ? null : OPENAI_API_BASE_URL_MESSAGE;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const openAiApiBaseUrl = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const issue = openAiApiBaseUrlIssue(value);
    if (issue) {
      ctx.addIssue({ code: 'custom', message: issue });
    }
  });

/**
 * Interpreta OPENAI_API_BASE_URL. Ausente o vacía -> la API oficial. Devuelve
 * el origen más la ruta, sin `/` final (`https://proxy.interno/openai/` ->
 * `https://proxy.interno/openai`). Un valor inválido lanza (fail-closed),
 * aunque `validateEnv` ya lo haya rechazado al arrancar.
 */
export function parseOpenAiApiBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (value === '') {
    return DEFAULT_OPENAI_API_BASE_URL;
  }
  const issue = openAiApiBaseUrlIssue(value);
  if (issue) {
    throw new Error(`OPENAI_API_BASE_URL: ${issue}`);
  }
  const url = new URL(value);
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

const httpUrl = (name: string) =>
  z
    .string({ error: REQUIRED.message })
    .trim()
    .min(1, REQUIRED)
    .refine(
      (value) => {
        try {
          const url = new URL(value);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: `${name} debe ser una URL http(s) válida` },
    );

const envFieldsSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),

  DB_HOST: requiredString,
  DB_PORT: z
    .string({ error: REQUIRED.message })
    .trim()
    .regex(/^\d+$/, { message: 'debe ser un número de puerto', abort: true })
    .refine(
      (v) => Number(v) >= 1 && Number(v) <= 65535,
      'debe estar entre 1 y 65535',
    ),
  DB_USER: requiredString,
  DB_PASSWORD: realSecret,
  DB_NAME: requiredString,
  DB_SYNCHRONIZE: booleanString.optional(),

  BETTER_AUTH_SECRET: strongSecret,
  BETTER_AUTH_URL: httpUrl('BETTER_AUTH_URL').optional(),

  CAMERAS_ENCRYPTION_KEY: realSecret.refine(isBase64Of32Bytes, {
    message:
      'debe ser base64 de exactamente 32 bytes (genera una con `openssl rand -base64 32`)',
  }),

  FRONTEND_URL: httpUrl('FRONTEND_URL'),

  // Proxies de confianza delante del backend: entero >= 0, "false" o vacío
  // (sin proxy). "true" se rechaza (ver TRUST_PROXY_TRUE_MESSAGE).
  TRUST_PROXY: optionalNonBlank(trustProxy),

  // Interfaz de escucha (Fase 4 · P9). Default 0.0.0.0 (ver DEFAULT_LISTEN_HOST).
  HOST: optionalNonBlank(listenHost),

  // Swagger UI en /api (Fase 4 · P9): en producción solo con "true"; fuera
  // de producción, activo salvo "false" (ver config/server-exposure.ts).
  SWAGGER_ENABLED: optionalNonBlank(booleanString),

  // Manager LPR: el backend le notifica altas y bajas de cámaras con este
  // secreto compartido. Con URL definida el secreto es obligatorio; si se
  // define, debe ser un secreto real de al menos 32 caracteres.
  WORKER_MANAGER_URL: optionalNonBlank(z.string().trim()),
  WORKER_MANAGER_SECRET: optionalNonBlank(strongSecret),

  // Minutos que una solicitud del conserje digital espera aprobación.
  VISIT_APPROVAL_TTL_MINUTES: optionalNonBlank(
    integerDuration(MAX_VISIT_APPROVAL_TTL_MINUTES, 'minutos'),
  ),

  // Minutos tras el ingreso de una visita en los que el LPR no registra su salida.
  VISIT_EXIT_COOLDOWN_MINUTES: optionalNonBlank(
    integerDuration(MAX_VISIT_EXIT_COOLDOWN_MINUTES, 'minutos'),
  ),

  // Segundos que las lecturas de una misma patente se agrupan en una pasada.
  LPR_PASSAGE_WINDOW_SECONDS: optionalNonBlank(
    integerDuration(MAX_LPR_PASSAGE_WINDOW_SECONDS, 'segundos'),
  ),

  // Segundos mínimos desde el inicio de una pasada para que una dirección
  // contraria (por línea) abra otra pasada.
  LPR_PASSAGE_REVERSE_MIN_SECONDS: optionalNonBlank(
    integerDuration(MAX_LPR_PASSAGE_REVERSE_MIN_SECONDS, 'segundos'),
  ),

  // Segundos tras los que una pasada sin intento cede el liderazgo.
  LPR_PASSAGE_ORPHAN_SECONDS: optionalNonBlank(
    integerDuration(MAX_LPR_PASSAGE_ORPHAN_SECONDS, 'segundos'),
  ),

  // Segundos en que una lectura puede agruparse con la pasada de una patente
  // que difiere en un carácter (0 = desactivado).
  LPR_PASSAGE_FUZZY_SECONDS: optionalNonBlank(
    integerDuration(MAX_LPR_PASSAGE_FUZZY_SECONDS, 'segundos', 0),
  ),

  // Horas de validez de la visita que crea el conserje digital.
  VISIT_CONCIERGE_VALIDITY_HOURS: optionalNonBlank(
    integerDuration(MAX_VISIT_CONCIERGE_VALIDITY_HOURS, 'horas'),
  ),

  // Horas tras el fin de la validez en que una visita ACTIVE sin salida se
  // cierra como EXPIRED (Fase 4 · P7).
  VISIT_ACTIVE_GRACE_HOURS: optionalNonBlank(
    integerDuration(MAX_VISIT_ACTIVE_GRACE_HOURS, 'horas'),
  ),

  // MediaMTX (Fase 4 · P6.M, D14). MEDIAMTX_URL: listener WHEP (loopback o
  // red interna). CAMERAS_REGISTER_IN_MEDIAMTX: el backend registra las
  // cámaras en MediaMTX (se compara sin mayúsculas, como CamerasService).
  // MEDIAMTX_AUTH_SECRET: secreto compartido con el que el forward WHEP se
  // autentica ante MediaMTX (`authMethod: http`); solo vive en este env.
  MEDIAMTX_URL: optionalNonBlank(httpUrl('MEDIAMTX_URL')),
  CAMERAS_REGISTER_IN_MEDIAMTX: optionalNonBlank(z.string().trim()),
  MEDIAMTX_AUTH_SECRET: optionalNonBlank(strongSecret),
  // IPs desde las que MediaMTX llama al endpoint interno de auth (default
  // loopback). Lista separada por comas.
  MEDIAMTX_AUTH_ALLOWED_IPS: optionalNonBlank(ipList),

  // Umbral del logger (Fase 4 · P7). El default por entorno lo resuelve
  // common/logging/log-levels.ts (P7.L).
  LOG_LEVEL: optionalNonBlank(
    z
      .string()
      .trim()
      .toLowerCase()
      .refine(isAppLogLevel, { message: LOG_LEVEL_MESSAGE }),
  ),

  // Origen de la API de OpenAI para las llamadas HTTP directas (Fase 4 · P8):
  // los e2e la apuntan a un servidor falso. En producción, https (ver abajo).
  OPENAI_API_BASE_URL: optionalNonBlank(openAiApiBaseUrl),

  // "SMS" con el QR de la visita aprobada (corrección P7, cyber B6): hoy es
  // un email a un sandbox de Mailtrap con el teléfono y el QR (una credencial
  // de acceso). Apagado por defecto; ver common/services/sms.service.ts.
  VISITOR_QR_SMS_ENABLED: optionalNonBlank(booleanString),

  // Retención (Fase 4 · P7.R): barrido diario de RetentionService.
  RETENTION_ENABLED: optionalNonBlank(booleanString),
  RETENTION_DRY_RUN: optionalNonBlank(booleanString),
  ...retentionPeriodFields(),
});

/** Un campo opcional `RETENTION_*_DAYS` por cada plazo de `RETENTION_PERIODS`. */
function retentionPeriodFields(): Record<
  RetentionPeriodName,
  ReturnType<typeof optionalRetentionDays>
> {
  const entries = (Object.keys(RETENTION_PERIODS) as RetentionPeriodName[]).map(
    (name) => [name, optionalRetentionDays(name)] as const,
  );
  return Object.fromEntries(entries) as Record<
    RetentionPeriodName,
    ReturnType<typeof optionalRetentionDays>
  >;
}

function optionalRetentionDays(name: RetentionPeriodName) {
  return optionalNonBlank(
    integerDuration(RETENTION_PERIODS[name].maxDays, 'días'),
  );
}

/**
 * ¿El backend usa MediaMTX? Con `MEDIAMTX_URL` definida o el registro de
 * cámaras activado, sin `MEDIAMTX_AUTH_SECRET` ninguna cámara se podría ver
 * (MediaMTX niega toda lectura): el arranque falla en vez de fallar en
 * silencio al abrir un stream.
 */
function usesMediamtx(env: {
  MEDIAMTX_URL?: string;
  CAMERAS_REGISTER_IN_MEDIAMTX?: string;
}): boolean {
  return (
    env.MEDIAMTX_URL !== undefined ||
    env.CAMERAS_REGISTER_IN_MEDIAMTX?.toLowerCase() === 'true'
  );
}

/** Esquema completo: campos + reglas que cruzan variables. */
export const envSchema = envFieldsSchema.superRefine((env, ctx) => {
  if (env.WORKER_MANAGER_URL && !env.WORKER_MANAGER_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['WORKER_MANAGER_SECRET'],
      message:
        'es obligatoria cuando WORKER_MANAGER_URL está definida (genera una con `openssl rand -base64 32`)',
    });
  }
  if (usesMediamtx(env) && !env.MEDIAMTX_AUTH_SECRET) {
    ctx.addIssue({
      code: 'custom',
      path: ['MEDIAMTX_AUTH_SECRET'],
      message:
        'es obligatoria cuando MEDIAMTX_URL está definida o CAMERAS_REGISTER_IN_MEDIAMTX=true (genera una con `openssl rand -base64 32`)',
    });
  }
  // Fase 4 · P8: la request lleva OPENAI_API_KEY; en producción, nunca en claro.
  if (
    env.NODE_ENV === 'production' &&
    env.OPENAI_API_BASE_URL !== undefined &&
    !isHttpsUrl(env.OPENAI_API_BASE_URL)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['OPENAI_API_BASE_URL'],
      message:
        'debe ser https:// en producción (cada request lleva OPENAI_API_KEY)',
    });
  }
});

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Advertencias de una config VÁLIDA (no detienen el arranque). Fase 4 · P9:
 * `NODE_ENV` distinto de `production` con `BETTER_AUTH_URL` o `FRONTEND_URL`
 * en https sugiere un servidor real sin `NODE_ENV=production` (Swagger
 * activo, logs de desarrollo). Las cookies de sesión salen igual con
 * `Secure`: `useSecureCookies` también sigue la URL https de better-auth
 * (auth/secure-cookies.policy.ts). Nunca incluye valores, solo nombres.
 */
export function envWarnings(env: ValidatedEnv): string[] {
  if (env.NODE_ENV === 'production') {
    return [];
  }
  const httpsNames = (['BETTER_AUTH_URL', 'FRONTEND_URL'] as const).filter(
    (name) => {
      const value = env[name];
      return value !== undefined && isHttpsUrl(value);
    },
  );
  if (httpsNames.length === 0) {
    return [];
  }
  return [
    `NODE_ENV no es "production" pero ${httpsNames.join(' y ')} usa https://: si este es un servidor real (piloto), define NODE_ENV=production. Las cookies de sesión salen igual con Secure.`,
  ];
}

const envLogger = new Logger('EnvValidation');

/**
 * Valida el objeto de configuración que entrega `@nestjs/config`. Devuelve la
 * config ORIGINAL (no la parseada) para no alterar el resto de variables que
 * el proyecto lee de `process.env` / `ConfigService`. Las advertencias
 * (`envWarnings`) se loguean y no detienen el arranque.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(config)';
      return `  - ${name}: ${issue.message}`;
    });
    throw new Error(
      `Configuración de entorno inválida. Corrige tu .env (ver backend/.env.example):\n${lines.join('\n')}`,
    );
  }
  for (const warning of envWarnings(result.data)) {
    envLogger.warn(warning);
  }
  return config;
}

/**
 * Interpreta TRUST_PROXY para `app.set('trust proxy', ...)` de Express.
 * Ausente, vacío o "false" -> `false` (no confiar en X-Forwarded-*); un entero
 * -> cantidad de proxies de confianza. Nunca devuelve `true`: ante "true" u
 * otro valor inválido lanza (fail-closed), aunque `validateEnv` ya lo haya
 * rechazado al arrancar.
 */
export function parseTrustProxy(raw: string | undefined): false | number {
  const value = raw?.trim() ?? '';
  if (value === '' || value === 'false') {
    return false;
  }
  const issue = trustProxyIssue(value);
  if (issue) {
    throw new Error(`TRUST_PROXY: ${issue}`);
  }
  return Number.parseInt(value, 10);
}

/**
 * Interpreta VISIT_APPROVAL_TTL_MINUTES. Ausente o vacío -> default (30).
 * Un valor inválido lanza (fail-closed), aunque `validateEnv` ya lo haya
 * rechazado al arrancar.
 */
export function parseVisitApprovalTtlMinutes(raw: string | undefined): number {
  return parseIntegerDuration(
    'VISIT_APPROVAL_TTL_MINUTES',
    raw,
    DEFAULT_VISIT_APPROVAL_TTL_MINUTES,
    MAX_VISIT_APPROVAL_TTL_MINUTES,
    'minutos',
  );
}

/**
 * Interpreta VISIT_EXIT_COOLDOWN_MINUTES. Ausente o vacío -> default (5).
 * Un valor inválido lanza (fail-closed), aunque `validateEnv` ya lo haya
 * rechazado al arrancar.
 */
export function parseVisitExitCooldownMinutes(raw: string | undefined): number {
  return parseIntegerDuration(
    'VISIT_EXIT_COOLDOWN_MINUTES',
    raw,
    DEFAULT_VISIT_EXIT_COOLDOWN_MINUTES,
    MAX_VISIT_EXIT_COOLDOWN_MINUTES,
    'minutos',
  );
}

/**
 * Interpreta LPR_PASSAGE_WINDOW_SECONDS. Ausente o vacío -> default (60).
 * Un valor inválido lanza (fail-closed), aunque `validateEnv` ya lo haya
 * rechazado al arrancar.
 */
export function parseLprPassageWindowSeconds(raw: string | undefined): number {
  return parseIntegerDuration(
    'LPR_PASSAGE_WINDOW_SECONDS',
    raw,
    DEFAULT_LPR_PASSAGE_WINDOW_SECONDS,
    MAX_LPR_PASSAGE_WINDOW_SECONDS,
    'segundos',
  );
}

/** Interpreta LPR_PASSAGE_REVERSE_MIN_SECONDS (default 15). Inválido lanza. */
export function parseLprPassageReverseMinSeconds(
  raw: string | undefined,
): number {
  return parseIntegerDuration(
    'LPR_PASSAGE_REVERSE_MIN_SECONDS',
    raw,
    DEFAULT_LPR_PASSAGE_REVERSE_MIN_SECONDS,
    MAX_LPR_PASSAGE_REVERSE_MIN_SECONDS,
    'segundos',
  );
}

/** Interpreta LPR_PASSAGE_ORPHAN_SECONDS (default 30). Inválido lanza. */
export function parseLprPassageOrphanSeconds(raw: string | undefined): number {
  return parseIntegerDuration(
    'LPR_PASSAGE_ORPHAN_SECONDS',
    raw,
    DEFAULT_LPR_PASSAGE_ORPHAN_SECONDS,
    MAX_LPR_PASSAGE_ORPHAN_SECONDS,
    'segundos',
  );
}

/** Interpreta LPR_PASSAGE_FUZZY_SECONDS (default 30; 0 = desactivado). Inválido lanza. */
export function parseLprPassageFuzzySeconds(raw: string | undefined): number {
  return parseIntegerDuration(
    'LPR_PASSAGE_FUZZY_SECONDS',
    raw,
    DEFAULT_LPR_PASSAGE_FUZZY_SECONDS,
    MAX_LPR_PASSAGE_FUZZY_SECONDS,
    'segundos',
    0,
  );
}

/**
 * Interpreta VISIT_CONCIERGE_VALIDITY_HOURS. Ausente o vacío -> default (4).
 * Un valor inválido lanza (fail-closed), aunque `validateEnv` ya lo haya
 * rechazado al arrancar.
 */
export function parseVisitConciergeValidityHours(
  raw: string | undefined,
): number {
  return parseIntegerDuration(
    'VISIT_CONCIERGE_VALIDITY_HOURS',
    raw,
    DEFAULT_VISIT_CONCIERGE_VALIDITY_HOURS,
    MAX_VISIT_CONCIERGE_VALIDITY_HOURS,
    'horas',
  );
}

/**
 * Interpreta VISIT_ACTIVE_GRACE_HOURS. Ausente o vacío -> default (24).
 * Un valor inválido lanza (fail-closed), aunque `validateEnv` ya lo haya
 * rechazado al arrancar.
 */
export function parseVisitActiveGraceHours(raw: string | undefined): number {
  return parseIntegerDuration(
    'VISIT_ACTIVE_GRACE_HOURS',
    raw,
    DEFAULT_VISIT_ACTIVE_GRACE_HOURS,
    MAX_VISIT_ACTIVE_GRACE_HOURS,
    'horas',
  );
}
