import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// `Buffer.from(x, 'base64')` ignora en silencio los caracteres inválidos, así
// que se valida el alfabeto antes (mismo criterio que config/env.validation.ts).
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Lee `CAMERAS_ENCRYPTION_KEY` (base64 de exactamente 32 bytes).
 *
 * Falla de forma explícita si falta o es inválida. Antes caía a
 * `sha256('')`, de modo que una clave ausente cifraba las URLs RTSP (con
 * credenciales de cámaras) con una clave pública y conocida.
 */
function getKeyFromEnv(): Buffer {
  const raw = process.env.CAMERAS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'CAMERAS_ENCRYPTION_KEY no está definida. Genera una con `openssl rand -base64 32` y configúrala en el entorno.',
    );
  }
  const key = BASE64_PATTERN.test(raw)
    ? Buffer.from(raw, 'base64')
    : Buffer.alloc(0);
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `CAMERAS_ENCRYPTION_KEY es inválida: debe ser base64 de exactamente ${KEY_LENGTH} bytes (genera una con \`openssl rand -base64 32\`).`,
    );
  }
  return key;
}

export function encryptString(plaintext: string): string {
  const key = getKeyFromEnv();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Store as base64: iv + tag + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptString(payload: string): string {
  const key = getKeyFromEnv();
  const data = Buffer.from(payload, 'base64');
  // Un payload más corto que IV + tag no puede ser nuestro: sin este chequeo
  // `subarray` devolvería un tag truncado.
  if (data.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Payload cifrado inválido: más corto que IV + tag');
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  // `authTagLength` fija el largo del tag: GCM aceptaría tags más cortos
  // (más fáciles de forjar) si no se declara.
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
