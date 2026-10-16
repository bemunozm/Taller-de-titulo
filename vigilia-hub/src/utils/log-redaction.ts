/**
 * Redacción de logs del hub (Fase 4 · P6.M).
 *
 * El hub procesa la voz del visitante: transcripciones, argumentos de tools
 * (nombre, RUT, teléfono, patente), el contexto de la casa, el prompt y el
 * `sessionId` del backend. Nada de eso debe quedar en `logs/` en claro. Este
 * módulo (sin dependencia de winston, para probarlo aislado) se aplica como
 * `format` a TODOS los transportes:
 *  - las claves sensibles de los metadatos se reemplazan por `[REDACTED]`, a
 *    cualquier profundidad (eventos completos de OpenAI incluidos);
 *  - en el mensaje y en cualquier string se borran tokens con forma conocida
 *    (`Bearer ...`, `sk-...`, `ek_...`).
 * Además, los logs con contenido completo se emiten en `debug`; en `info` solo
 * van metadatos (tipo de evento, largos, nombre de la tool).
 */

export const REDACTED = '[REDACTED]';

/**
 * Claves cuyo valor nunca se loguea (comparadas sin mayúsculas). Cubre los
 * eventos de OpenAI Realtime (`transcript`, `text`, `delta`, `audio`,
 * `arguments`, `instructions`, `client_secret`), lo que arma el hub (`args`,
 * `toolArgs`, `context`, `expectedVisitors`, `sessionId`) y credenciales.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  [
    'transcript',
    'text',
    'delta',
    'arguments',
    'args',
    'toolArgs',
    'parameters',
    'instructions',
    'prompt',
    'context',
    'expectedVisitors',
    'sessionId',
    'session_id',
    'token',
    'ephemeralToken',
    'client_secret',
    'clientSecret',
    'secret',
    'hubSecret',
    'x-hub-secret',
    'authorization',
    'password',
    'apiKey',
    'api_key',
    'debugOpenAiKey',
    'nombre',
    'rut',
    'telefono',
    'patente',
    'motivo',
    'visitorName',
    'phone',
  ].map((key) => key.toLowerCase()),
);

/**
 * Sensibles solo como string; como objeto o lista son estructura y se
 * recorren:
 *  - `output`: en un `function_call_output` es el resultado de la tool (datos
 *    de residentes); `response.output` es la lista de items.
 *  - `audio`: en un item es la voz del visitante en base64; en
 *    `session.update` es la configuración de audio.
 */
const STRING_ONLY_SENSITIVE_KEYS: ReadonlySet<string> = new Set(['output', 'audio']);

/** Campos propios de winston que no son metadatos del llamador. */
const RESERVED_INFO_KEYS: ReadonlySet<string> = new Set([
  'level',
  'message',
  'timestamp',
  'service',
  'stack',
]);

const MAX_DEPTH = 8;

const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/\b(?:sk|ek|rk)[-_][A-Za-z0-9_-]{8,}/g, REDACTED],
  [
    /\b(x-hub-secret|hubsecret|password|secret|token)(["']?\s*[:=]\s*["']?)[^"'\s,;}&]+/gi,
    `$1$2${REDACTED}`,
  ],
];

/** Borra de un texto los tokens y secretos con forma conocida. */
export function scrubSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

function isSensitiveKey(key: string, value: unknown): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) {
    return true;
  }
  return STRING_ONLY_SENSITIVE_KEYS.has(normalized) && typeof value === 'string';
}

function redactNested(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return scrubSecrets(value);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: scrubSecrets(value.message) };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactNested(item, depth + 1, seen));
  }
  if (Buffer.isBuffer(value)) {
    return REDACTED;
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = isSensitiveKey(key, nested)
      ? REDACTED
      : redactNested(nested, depth + 1, seen);
  }
  return result;
}

/**
 * Copia de `value` con las claves sensibles en `[REDACTED]` (a cualquier
 * profundidad) y los tokens con forma conocida borrados de los strings.
 */
export function redactSensitive(value: unknown): unknown {
  return redactNested(value, 0, new WeakSet<object>());
}

/** Registro de winston: claves string más las simbólicas internas. */
export type LogInfo = { [key: string]: unknown; [key: symbol]: unknown };

/**
 * Redacta en el lugar un registro de winston: el mensaje, el stack y cada
 * metadato del llamador. Las claves simbólicas de winston no se tocan.
 */
export function redactLogInfo<T extends LogInfo>(info: T): T {
  const record = info as LogInfo;
  if (typeof record.message === 'string') {
    record.message = scrubSecrets(record.message);
  }
  if (typeof record.stack === 'string') {
    record.stack = scrubSecrets(record.stack);
  }
  for (const key of Object.keys(record)) {
    if (RESERVED_INFO_KEYS.has(key)) {
      continue;
    }
    const value = record[key];
    record[key] = isSensitiveKey(key, value) ? REDACTED : redactSensitive(value);
  }
  return info;
}

/** Metadatos del llamador (sin los campos propios de winston), o `null` si no hay. */
export function callerMetadata(info: LogInfo): Record<string, unknown> | null {
  const meta: Record<string, unknown> = {};
  for (const key of Object.keys(info)) {
    if (!RESERVED_INFO_KEYS.has(key)) {
      meta[key] = info[key];
    }
  }
  return Object.keys(meta).length > 0 ? meta : null;
}
