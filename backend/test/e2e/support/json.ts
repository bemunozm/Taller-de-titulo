import type { E2eResponse } from './http-client';

/**
 * Lectura tipada de respuestas JSON en los e2e (Fase 4 · P8): sin `any`, y
 * con errores que dicen QUÉ faltaba (los e2e se corren por primera vez en el
 * gate; un mensaje claro ahorra la depuración).
 */
export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asObject(value: unknown, what: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${what}: se esperaba un objeto JSON`);
  }
  return value;
}

export function stringAt(value: unknown, key: string, what: string): string {
  const field = asObject(value, what)[key];
  if (typeof field !== 'string' || field === '') {
    throw new Error(`${what}: falta el texto "${key}"`);
  }
  return field;
}

export function arrayAt(value: unknown, key: string, what: string): unknown[] {
  const field = asObject(value, what)[key];
  if (!Array.isArray(field)) {
    throw new Error(`${what}: falta el arreglo "${key}"`);
  }
  return field;
}

export function objectAt(
  value: unknown,
  key: string,
  what: string,
): JsonObject {
  return asObject(asObject(value, what)[key], `${what}.${key}`);
}

const MAX_BODY_IN_ERROR = 600;

/** Resumen de una respuesta para un mensaje de error (cuerpo recortado). */
export function describeResponse(response: E2eResponse): string {
  const body =
    response.text.length > MAX_BODY_IN_ERROR
      ? `${response.text.slice(0, MAX_BODY_IN_ERROR)}…`
      : response.text;
  return `HTTP ${response.status}: ${body || '(sin cuerpo)'}`;
}

/**
 * Exige uno de los status esperados en un paso de PREPARACIÓN (crear datos).
 * Las aserciones de los casos usan `expect`; esto es para que una
 * precondición rota falle con el cuerpo de la respuesta.
 */
export function ensureStatus(
  response: E2eResponse,
  expected: readonly number[],
  step: string,
): E2eResponse {
  if (!expected.includes(response.status)) {
    throw new Error(
      `${step}: se esperaba ${expected.join(' o ')} y llegó ${describeResponse(response)}`,
    );
  }
  return response;
}
