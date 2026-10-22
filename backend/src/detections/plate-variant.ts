import type { PassageDirection } from './vehicle-passage-direction';

/**
 * ¿`a` y `b` tienen el mismo largo y difieren en EXACTAMENTE un carácter
 * (una sustitución, distancia de Hamming 1)? Sin inserciones ni borrados: un
 * largo distinto suele ser otra patente, no una variante de OCR.
 */
export function differsByOneSubstitution(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let differences = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      differences += 1;
      if (differences > 1) {
        return false;
      }
    }
  }
  return differences === 1;
}

/** Direcciones compatibles para una variante: iguales, o alguna `unknown`. */
export function directionsCompatibleForVariant(
  a: PassageDirection,
  b: PassageDirection,
): boolean {
  return a === b || a === 'unknown' || b === 'unknown';
}
