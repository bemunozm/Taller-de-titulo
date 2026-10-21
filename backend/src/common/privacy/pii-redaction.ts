import {
  REDACTED_VALUE,
  maskEmail,
  maskPhone,
  maskPlate,
  maskRut,
  scrubPiiInText,
  truncateText,
} from './pii-mask';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): redacción POR
 * CAMPO de lo que se persiste como registro técnico: `audit_logs`
 * (`oldValue`/`newValue`), la auditoría de tools del agente (`system_logs`) y
 * `pending_actions`. Recorre todos los niveles (objetos anidados y arrays);
 * las fechas se conservan y las referencias circulares se cortan.
 *
 * Qué hace con cada campo (la clave se compara en minúsculas y sin `_`/`-`,
 * así `plate_raw`, `plateRaw` y `PLATE-RAW` son la misma):
 *  - secretos (contraseñas, tokens, API keys, `qrCode`, URL de cámaras):
 *    `[REDACTED]`;
 *  - RUT, teléfono, email y patente: enmascarados (`pii-mask.ts`);
 *  - nombres de personas (`visitorName`, `nombre`, `familia`, `propietario`,
 *    `residentes_notificados`...): `[REDACTED]`;
 *  - imágenes (base64, `full_frame_path`, foto de perfil) y texto libre
 *    (`transcript`, `functionCalls`, motivo de la visita, `reason`):
 *    `[REDACTED]`;
 *  - mensajes (`mensaje`, `message`, `lastError`): se enmascaran los emails,
 *    RUT, celulares y patentes que contengan;
 *  - cualquier otro texto se guarda recortado a ~2 KB (corrección P7, cyber
 *    A1: sin regex sobre textos largos; ver `pii-mask.ts`).
 *
 * `description` sigue la misma regla que `name` (corrección P7, cyber B4): la
 * de una familia puede nombrar a sus integrantes.
 *
 * `name` a secas es ambiguo: en un usuario, una familia o el anfitrión de una
 * visita es el nombre de una persona; en un rol, un permiso o una cámara es
 * el nombre de un elemento del catálogo (útil para leer la auditoría:
 * "se asignó el rol Conserje"). Decisión: fail-closed. `name` se redacta
 * SIEMPRE, salvo en el objeto raíz de una entidad de catálogo
 * (`catalogRoot`) y en los objetos que cuelgan de una clave de catálogo
 * (`roles`, `permissions`, `cameras`, `organization`...). La excepción vale
 * solo para ese objeto: sus hijos se evalúan de nuevo (los `users` de un rol
 * sí se redactan).
 */
export interface PersonalDataRedactionOptions {
  /** La raíz es una entidad de catálogo (rol, permiso, cámara...). */
  readonly catalogRoot?: boolean;
}

type FieldRule =
  | 'secret'
  | 'rut'
  | 'phone'
  | 'email'
  | 'plate'
  | 'person'
  | 'omit'
  | 'scrub';

/**
 * Claves de secretos (normalizadas). Corrección P5 (cyber B1): incluye
 * `qrCode` (una credencial de acceso) y la URL de origen de las cámaras
 * (lleva usuario y contraseña RTSP).
 */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'oldpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'ephemeraltoken',
  'secret',
  'clientsecret',
  'hubsecret',
  'secrethash',
  'apikey',
  'key',
  'qrcode',
  'sourceurl',
  'encryptedsourceurl',
]);

/** Fragmentos que delatan un secreto en cualquier clave (`userPassword`, `x-api-key`...). */
const SECRET_KEY_PATTERN = /password|secret|token|api[-_]?key/i;

const FIELD_RULES: ReadonlyMap<string, FieldRule> = new Map<string, FieldRule>([
  ...['rut', 'visitorrut', 'residentrut', 'userrut'].map(
    (key): [string, FieldRule] => [key, 'rut'],
  ),
  ...[
    'phone',
    'visitorphone',
    'phonenumber',
    'normalizedphone',
    'telefono',
    'celular',
    'mobile',
  ].map((key): [string, FieldRule] => [key, 'phone']),
  ...['email', 'visitoremail', 'useremail', 'attemptedemail'].map(
    (key): [string, FieldRule] => [key, 'email'],
  ),
  ...[
    'plate',
    'plateraw',
    'requestedplate',
    'vehicleplate',
    'licenseplate',
    'patente',
    'placa',
  ].map((key): [string, FieldRule] => [key, 'plate']),
  // Nombres y atributos de personas (en las tools, en español).
  ...[
    'visitorname',
    'residentname',
    'hostname',
    'ownername',
    'respondername',
    'username',
    'firstname',
    'lastname',
    'fullname',
    'familyname',
    'nombre',
    'visitante',
    'residente',
    'propietario',
    'familia',
    'residentesnotificados',
    'age',
    'edad',
  ].map((key): [string, FieldRule] => [key, 'person']),
  // Imágenes y texto libre: se omiten enteros.
  ...[
    'image',
    'imageurl',
    'photo',
    'avatar',
    'profilepicture',
    'snapshot',
    'snapshotjpegb64',
    'fullframepath',
    'qrdataurl',
    'transcript',
    'functioncalls',
    'motivo',
    'reason',
    'visitreason',
  ].map((key): [string, FieldRule] => [key, 'omit']),
  ...['mensaje', 'message', 'lasterror', 'errormessage'].map(
    (key): [string, FieldRule] => [key, 'scrub'],
  ),
]);

/** Claves cuyos objetos son del catálogo: su `name` no es de una persona. */
const CATALOG_CONTAINER_KEYS: ReadonlySet<string> = new Set([
  'role',
  'roles',
  'permission',
  'permissions',
  'camera',
  'cameras',
  'organization',
  'organizations',
]);

/**
 * Claves que dependen del contexto (corrección P7, cyber B4): en un objeto de
 * catálogo son el nombre y la descripción del rol, permiso o cámara; en
 * cualquier otro (familia, usuario, visita) pueden traer nombres de personas
 * (`family.description`: "Familia de Juan Pérez") y se omiten.
 */
const CONTEXTUAL_KEYS: ReadonlySet<string> = new Set(['name', 'description']);

/** Largo mínimo de un bloque base64 que se trata como imagen. */
const MIN_BASE64_IMAGE_LENGTH = 512;

/** Largo máximo de la clave que se clasifica (las de la app son cortas). */
const MAX_KEY_LENGTH = 128;

function normalizeKey(key: string): string {
  return key
    .slice(0, MAX_KEY_LENGTH)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** ¿La clave es de un secreto? (misma regla que la auditoría desde P5). */
export function isSecretKey(key: string): boolean {
  return (
    SECRET_KEYS.has(normalizeKey(key)) ||
    SECRET_KEY_PATTERN.test(key.slice(0, MAX_KEY_LENGTH))
  );
}

function ruleFor(key: string, insideCatalogObject: boolean): FieldRule | null {
  if (isSecretKey(key)) {
    return 'secret';
  }
  const normalized = normalizeKey(key);
  if (CONTEXTUAL_KEYS.has(normalized)) {
    return insideCatalogObject ? null : 'person';
  }
  return FIELD_RULES.get(normalized) ?? null;
}

/** ¿`code` es un carácter base64 (`A-Z a-z 0-9 + / =`) o un salto de línea? */
function isBase64CharCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47 ||
    code === 61 ||
    code === 10 ||
    code === 13
  );
}

/**
 * Imagen embebida: data URL (`data:<tipo>;base64,`) o un bloque base64 de
 * `MIN_BASE64_IMAGE_LENGTH` o más. Sin regex (corrección P7, cyber A1): un
 * recorrido lineal que corta en el primer carácter que no es base64.
 */
function looksLikeEncodedImage(value: string): boolean {
  if (
    value.slice(0, 5).toLowerCase() === 'data:' &&
    value.slice(0, 128).includes(';base64,')
  ) {
    return true;
  }
  if (value.length < MIN_BASE64_IMAGE_LENGTH) {
    return false;
  }
  for (let index = 0; index < value.length; index++) {
    if (!isBase64CharCode(value.charCodeAt(index))) {
      return false;
    }
  }
  return true;
}

/** Texto que se guarda: sin imágenes embebidas y recortado a ~2 KB. */
function storedText(value: string): string {
  return looksLikeEncodedImage(value) ? REDACTED_VALUE : truncateText(value);
}

/**
 * Copia de `data` con los campos personales y los secretos redactados. Ver el
 * docstring del módulo para las reglas y la decisión sobre `name`.
 */
export function redactPersonalData(
  data: unknown,
  options: PersonalDataRedactionOptions = {},
): unknown {
  return redactValue(data, options.catalogRoot === true, new WeakSet());
}

function redactValue(
  value: unknown,
  catalogObject: boolean,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return storedText(value);
  }
  if (typeof value !== 'object' || value === null || value instanceof Date) {
    return value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactValue(item, catalogObject, seen));
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = redactField(key, child, catalogObject, seen);
  }
  return result;
}

function redactField(
  key: string,
  value: unknown,
  insideCatalogObject: boolean,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const childIsCatalog = CATALOG_CONTAINER_KEYS.has(normalizeKey(key));
  switch (ruleFor(key, insideCatalogObject)) {
    case 'secret':
    case 'omit':
      return REDACTED_VALUE;
    case 'person':
      return mapPrimitives(value, () => REDACTED_VALUE, seen);
    case 'rut':
      return mapPrimitives(value, maskRut, seen);
    case 'phone':
      return mapPrimitives(value, maskPhone, seen);
    case 'email':
      return mapPrimitives(value, maskEmail, seen);
    case 'plate':
      return mapPrimitives(value, maskPlate, seen);
    case 'scrub':
      return typeof value === 'string'
        ? scrubPiiInText(value)
        : redactValue(value, childIsCatalog, seen);
    default:
      return redactValue(value, childIsCatalog, seen);
  }
}

/**
 * Aplica `mask` a los valores primitivos (también dentro de un array). Un
 * objeto (p. ej. `residente` como relación a un usuario) se recorre con las
 * reglas generales, así su `id` se conserva y su `name` no.
 */
function mapPrimitives(
  value: unknown,
  mask: (raw: string) => string,
  seen: WeakSet<object>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => mapPrimitives(item, mask, seen));
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    return redactValue(value, false, seen);
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return mask(String(value));
  }
  // Booleano, fecha u otro primitivo en un campo personal: se omite.
  return REDACTED_VALUE;
}

/** Forma de un input sin sus valores: tipo y largo de cada clave. */
export interface InputShape {
  readonly type: string;
  /** Primer nivel: clave → `string(<largo>)`, `number`, `array(<largo>)`... */
  readonly keys?: Readonly<Record<string, string>>;
  /** Claves que no se describen (pasado `MAX_SHAPE_KEYS`). */
  readonly omittedKeys?: number;
}

/** Claves de primer nivel que se describen como máximo. */
export const MAX_SHAPE_KEYS = 20;

/** Largo máximo del nombre de una clave en la forma descrita. */
const MAX_SHAPE_KEY_LENGTH = 64;

function describeType(value: unknown): string {
  if (typeof value === 'string') {
    return `string(${value.length})`;
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

/**
 * Corrección P7 (cyber A1): lo que se audita de un input RECHAZADO (canal o
 * permiso denegado, o inválido según Zod): solo las claves de primer nivel
 * (recortadas y enmascaradas) con su tipo y largo, nunca los valores. Un input
 * que no pasó la validación puede ser cualquier cosa (megabytes, datos
 * personales sin esquema) y no se recorre.
 */
export function describeInputShape(value: unknown): InputShape {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { type: describeType(value) };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const described: Record<string, string> = {};
  for (const key of keys.slice(0, MAX_SHAPE_KEYS)) {
    const safeKey = scrubPiiInText(truncateText(key, MAX_SHAPE_KEY_LENGTH));
    described[safeKey] = describeType(record[key]);
  }
  return keys.length > MAX_SHAPE_KEYS
    ? {
        type: 'object',
        keys: described,
        omittedKeys: keys.length - MAX_SHAPE_KEYS,
      }
    : { type: 'object', keys: described };
}
