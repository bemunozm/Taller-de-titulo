import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM

function getKeyFromEnv(): Buffer {
  const raw = process.env.CAMERAS_ENCRYPTION_KEY || '';
  // If user provided base64 key, try to decode; otherwise derive by hashing
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch (e) {
    // ignore
  }
  // fallback: use sha256 of string to generate 32 bytes
  const { createHash } = require('crypto');
  return createHash('sha256').update(raw).digest();
}

export function encryptString(plaintext: string): string {
  const key = getKeyFromEnv();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as base64: iv + tag + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptString(payload: string): string {
  const key = getKeyFromEnv();
  const data = Buffer.from(payload, 'base64');
  const iv = data.slice(0, IV_LENGTH);
  const tag = data.slice(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = data.slice(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
