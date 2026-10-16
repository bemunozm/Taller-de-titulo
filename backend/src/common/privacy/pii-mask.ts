/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3, "Minimización desde
 * la captura"): enmascarado de datos personales para logs, auditoría y
 * registros técnicos. Funciona aunque la retención falle: lo que no se
 * escribe no hay que borrarlo después.
 *
 * Reglas (las mismas en todo el backend):
 *  - teléfono: solo los últimos 4 dígitos (`***5678`);
 *  - patente: los 2 primeros y los 2 últimos caracteres (`AB**12`);
 *  - RUT: solo el dígito verificador (`***-K`); un pasaporte, `***`;
 *  - email: la primera letra y el dominio (`a***@dominio.cl`);
 *  - nombres y texto libre: no se escriben (`[REDACTED]`).
 *
 * Corrección P7 (cyber A1, ReDoS): todo texto se recorta a
 * `MAX_SCRUB_TEXT_LENGTH` antes de aplicar una regex, y todas las regex usan
 * cuantificadores acotados, sin alternativas que se solapen: el costo es
 * lineal y pequeño aunque el texto sea de megabytes. Antes, la regex de email
 * (`[...]+@`) era cuadrática sobre un texto largo sin `@`: 200 KB bloqueaban
 * el event loop ~25 s.
 */

/** Marca de un dato omitido: nombres, texto libre, imágenes y secretos. */
export const REDACTED_VALUE = '[REDACTED]';

/** Largo máximo de un texto que se enmascara o se guarda (~2 KB). */
export const MAX_SCRUB_TEXT_LENGTH = 2048;

/** Marca al final de un texto recortado. */
export const TRUNCATED_SUFFIX = '…[truncado]';

/** Largo máximo de un valor que se enmascara campo por campo. */
const MAX_MASKED_VALUE_LENGTH = 256;

const MASK = '***';

/** `text` recortado a `max` caracteres, con la marca de recorte si sobraba. */
export function truncateText(
  text: string,
  max: number = MAX_SCRUB_TEXT_LENGTH,
): string {
  return text.length > max ? `${text.slice(0, max)}${TRUNCATED_SUFFIX}` : text;
}

function boundedValue(value: string | null | undefined): string {
  return (value ?? '').slice(0, MAX_MASKED_VALUE_LENGTH);
}

/** Teléfono → `***` + sus últimos 4 dígitos. Con 4 dígitos o menos, `***`. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = boundedValue(phone).replace(/\D/g, '');
  return digits.length > 4 ? `${MASK}${digits.slice(-4)}` : MASK;
}

/**
 * Patente → 2 primeros + `*` + 2 últimos caracteres (`ABCD12` → `AB**12`),
 * normalizada (mayúsculas, sin separadores: `bb-cd-12` → `BB**12`). Con menos
 * de 5 caracteres no se puede enmascarar sin revelarla casi entera: `***`.
 */
export function maskPlate(plate: string | null | undefined): string {
  const normalized = boundedValue(plate)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 5) {
    return MASK;
  }
  const hidden = '*'.repeat(normalized.length - 4);
  return `${normalized.slice(0, 2)}${hidden}${normalized.slice(-2)}`;
}

/**
 * RUT → `***-<DV>` (`12.345.678-5`, `12345678-5` o `123456785` → `***-5`).
 * Un valor que no tiene forma de RUT (pasaporte, texto) → `***`.
 */
export function maskRut(rut: string | null | undefined): string {
  const cleaned = boundedValue(rut)
    .replace(/[.\s-]/g, '')
    .toUpperCase();
  return /^\d{6,9}[\dK]$/.test(cleaned) ? `${MASK}-${cleaned.slice(-1)}` : MASK;
}

/** Email → primera letra + `***` + `@dominio`. Sin forma de email → `***`. */
export function maskEmail(email: string | null | undefined): string {
  const value = boundedValue(email).trim();
  const at = value.lastIndexOf('@');
  if (at < 1 || at === value.length - 1) {
    return MASK;
  }
  return `${value.charAt(0)}${MASK}@${value.slice(at + 1)}`;
}

/** Email (RFC: local ≤ 64, etiquetas ≤ 63, hasta 8 niveles de dominio). */
const EMAIL_IN_TEXT =
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;
/** RUT con guion: `12.345.678-5` o `12345678-K`. */
const RUT_DASHED_IN_TEXT = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
/**
 * RUT sin guion: `123456785`, `12.345.6785` o `12345678K`. Va DESPUÉS del
 * celular: un `9XXXXXXXX` se enmascara como teléfono.
 */
const RUT_UNDASHED_IN_TEXT = /\b\d{1,2}\.?\d{3}\.?\d{3}[\dkK]\b/g;
/** Celular chileno: `+56 9 1234 5678`, `+56912345678` o `912345678`. */
const PHONE_IN_TEXT =
  /(?<![\d+])(?:\+?56[\s-]?)?9[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;
/**
 * Patente chilena, en mayúsculas o minúsculas y con o sin separadores
 * (`-`, `·`, `.`): `ABCD12`, `bbcd12`, `BB-CD-12`, `AB1234`, `AB-12-34`. Sin
 * espacios como separador: "casa 15" no es una patente.
 */
const PLATE_IN_TEXT =
  /\b(?:[A-Za-z]{2}[-·.]?[A-Za-z]{2}[-·.]?\d{2}|[A-Za-z]{2}[-·.]?\d{2}[-·.]?\d{2})\b/g;

/**
 * Enmascara, dentro de un texto libre (mensaje de error, descripción, URL),
 * los emails, RUT, celulares y patentes que reconoce, después de recortarlo
 * a `MAX_SCRUB_TEXT_LENGTH`. Es una defensa adicional (best-effort): los
 * nombres no se pueden detectar, así que un texto libre con nombres igual hay
 * que omitirlo en origen.
 */
export function scrubPiiInText(text: string): string {
  let result = truncateText(text);
  if (result.includes('@')) {
    result = result.replace(EMAIL_IN_TEXT, (match) => maskEmail(match));
  }
  return result
    .replace(RUT_DASHED_IN_TEXT, (match) => maskRut(match))
    .replace(PHONE_IN_TEXT, (match) => maskPhone(match))
    .replace(RUT_UNDASHED_IN_TEXT, (match) => maskRut(match))
    .replace(PLATE_IN_TEXT, (match) => maskPlate(match));
}

/**
 * Texto entre comillas (rectas o tipográficas), acotado a 512 caracteres;
 * también una comilla que quedó abierta al final por el recorte.
 */
const QUOTED_TEXT = /"[^"\r\n]{0,512}(?:"|$)|“[^”\r\n]{0,512}(?:”|$)/g;

/**
 * Corrección P7 (cyber B4): reemplaza lo que va entre comillas en un mensaje
 * de error por `"[REDACTED]"` (p. ej. el nombre de una familia: "la familia
 * activa "Familia Pérez""), además de `scrubPiiInText`. Para mensajes de
 * entidades con datos personales; en las de catálogo (rol, permiso) lo
 * citado es el nombre del rol y se conserva.
 */
export function redactQuotedText(text: string): string {
  return scrubPiiInText(text).replace(QUOTED_TEXT, `"${REDACTED_VALUE}"`);
}
