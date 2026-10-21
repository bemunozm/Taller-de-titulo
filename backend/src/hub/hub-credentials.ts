import type { Repository } from 'typeorm';
import { checkPassword } from '../auth/utils/auth.util';
import type { Hub } from './entities/hub.entity';

/**
 * Mensaje único para cualquier credencial de dispositivo rechazada (Fase 4 ·
 * P4): "hub desconocido o inactivo", "sin secret" y "secret inválido"
 * responden lo mismo, así no se pueden enumerar `hubId`. El detalle va solo al
 * `Logger`.
 */
export const HUB_UNAUTHORIZED_MESSAGE = 'Credencial de dispositivo inválida';

/**
 * Hash bcrypt (costo 10, el mismo de `hashPassword`) de un valor aleatorio
 * descartado al generarlo. NO es una credencial: nunca autentica nada (sin hub
 * el resultado es fallo aunque coincidiera). Solo sirve para que un `hubId`
 * inexistente o sin secret pague el mismo bcrypt que uno real y el tiempo de
 * respuesta no revele si existe.
 */
const TIMING_EQUALIZER_HASH =
  '$2b$10$fHArNX8vjRwP7DLK9bEJiey5cs94FGjIkrW/W8UZfEf.PwikK7Vke';

/**
 * Formato de `hubId` (Fase 4 · P4.B, cyber B7): el mismo que exige el alta
 * (`CreateHubDto`). Se valida ANTES de consultar la BD o correr bcrypt, y un
 * `hubId` válido es seguro de escribir en logs.
 */
export const HUB_ID_MAX_LENGTH = 64;
const HUB_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidHubId(value: string): boolean {
  return value.length <= HUB_ID_MAX_LENGTH && HUB_ID_PATTERN.test(value);
}

/** Motivo interno de un rechazo (solo para logs). */
export type HubCredentialFailure =
  | 'unknown_or_inactive'
  | 'no_secret'
  | 'invalid_secret';

export type HubCredentialResult =
  | { ok: true; hub: Hub }
  | { ok: false; reason: HubCredentialFailure };

/**
 * Verifica `hubId` + secret contra el `secretHash` PROPIO del hub activo
 * (Fase 1, Bloque A1.1, H1). Lo comparten `HubAuthGuard` (HTTP) y el
 * middleware del namespace `/hub` (WebSocket). Siempre ejecuta un bcrypt.
 */
export async function verifyHubCredentials(
  repository: Repository<Hub>,
  hubId: string,
  secret: string,
): Promise<HubCredentialResult> {
  const hub = await repository.findOne({ where: { hubId, active: true } });
  const secretMatches = await checkPassword(
    secret,
    hub?.secretHash ?? TIMING_EQUALIZER_HASH,
  );

  if (!hub) {
    return { ok: false, reason: 'unknown_or_inactive' };
  }
  if (!hub.secretHash) {
    return { ok: false, reason: 'no_secret' };
  }
  if (!secretMatches) {
    return { ok: false, reason: 'invalid_secret' };
  }
  return { ok: true, hub };
}
