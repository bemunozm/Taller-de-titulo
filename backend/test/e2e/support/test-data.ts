import { randomBytes, randomInt } from 'node:crypto';

/**
 * Datos de prueba únicos por corrida (Fase 4 · P8). Cada test crea los suyos:
 * los e2e no dependen del orden ni comparten registros. Los formatos son los
 * que valida el backend (RUT con dígito verificador, teléfono +569XXXXXXXX,
 * patente chilena actual BBBB99).
 */

/** Sufijo corto y aleatorio para nombres, emails y slugs. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

/** Dígito verificador de un RUT (módulo 11). */
export function rutCheckDigit(body: number): string {
  let sum = 0;
  let factor = 2;
  for (let rest = body; rest > 0; rest = Math.floor(rest / 10)) {
    sum += (rest % 10) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const digit = 11 - (sum % 11);
  if (digit === 11) {
    return '0';
  }
  return digit === 10 ? 'K' : String(digit);
}

/** RUT válido aleatorio (`12345678-5`). */
export function randomRut(): string {
  const body = randomInt(10_000_000, 30_000_000);
  return `${body}-${rutCheckDigit(body)}`;
}

/** Teléfono chileno válido aleatorio (`+569` + 8 dígitos). */
export function randomPhone(): string {
  return `+569${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

const PLATE_LETTERS = 'BCDFGHJKLPRSTVWXYZ';

/** Patente chilena actual aleatoria (4 letras + 2 dígitos). */
export function randomPlate(): string {
  let letters = '';
  for (let i = 0; i < 4; i++) {
    letters += PLATE_LETTERS[randomInt(PLATE_LETTERS.length)];
  }
  return `${letters}${String(randomInt(0, 100)).padStart(2, '0')}`;
}

/** Email único en un dominio de pruebas (`.test`, RFC 2606). */
export function uniqueEmail(label: string): string {
  const local = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return `${local || 'usuario'}.${uniqueSuffix()}@vigilia.test`;
}

/** Contraseña aleatoria válida para better-auth (8 a 128 caracteres). */
export function randomPassword(): string {
  return `E2e-${randomBytes(12).toString('hex')}`;
}
