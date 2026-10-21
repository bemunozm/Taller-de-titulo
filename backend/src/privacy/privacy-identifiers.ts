/**
 * Fase 4 · P7.R (Ley 21.719, docs/modulos/privacidad-ley-21719.md §3/§4):
 * valores de anonimización y normalización de los identificadores con los
 * que la administración pide una supresión (RUT o patente).
 *
 * La normalización de TypeScript y la de SQL (`identifierKeySql`) DEBEN dar
 * lo mismo: el RUT o la patente que llega por la API se compara contra lo que
 * está guardado con otro formato ("12.345.678-5" vs "12345678-5").
 */

/** Marcador de una columna NOT NULL anonimizada (`visits.visitorName`). */
export const ANONYMIZED_MARKER = '[anonimizado]';

/** Patente enmascarada (`plate_detections.plate`, NOT NULL). */
export const MASKED_PLATE = '******';

/** Nombre de una cuenta deshabilitada y anonimizada. */
export const DELETED_USER_NAME = 'Usuario eliminado';

/**
 * Email de una cuenta anonimizada: único (lleva el id) y no entregable (el
 * TLD `.invalid` está reservado por el RFC 2606 y nunca resuelve).
 */
export function deletedUserEmail(userId: string): string {
  return `deleted+${userId.toLowerCase()}@vigilia.invalid`;
}

/** Largos aceptados de un identificador ya normalizado. */
export const RUT_KEY_LENGTH = { min: 5, max: 20 } as const;
export const PLATE_KEY_LENGTH = { min: 4, max: 10 } as const;

/** Mayúsculas y solo letras y dígitos (sin puntos, guiones ni espacios). */
function alphanumericUpper(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * Clave de comparación de un RUT (o pasaporte, que el conserje acepta en el
 * mismo campo): alfanumérico en mayúsculas y sin ceros a la izquierda
 * ("08.123.456-k" -> "8123456K").
 */
export function rutKey(raw: string): string {
  return alphanumericUpper(raw).replace(/^0+/, '');
}

/** Clave de comparación de una patente ("bb-cd 12" -> "BBCD12"). */
export function plateKey(raw: string): string {
  return alphanumericUpper(raw);
}

/**
 * Misma normalización que `rutKey`/`plateKey`, en SQL, sobre una columna o
 * expresión de texto. `column` es SIEMPRE un literal del código (nunca
 * entrada del usuario): se interpola en la consulta.
 */
export function rutKeySql(column: string): string {
  return `ltrim(regexp_replace(upper(coalesce(${column}, '')), '[^0-9A-Z]', '', 'g'), '0')`;
}

export function plateKeySql(column: string): string {
  return `regexp_replace(upper(coalesce(${column}, '')), '[^0-9A-Z]', '', 'g')`;
}
