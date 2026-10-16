import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/** Lee `obj[key]` si `obj` es un objeto. */
function readProperty(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }
  return (obj as Record<string, unknown>)[key];
}

function readNonEmptyString(obj: unknown, key: string): string | undefined {
  const value = readProperty(obj, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Identidad que cuenta para el rate limit (Fase 4 · P4.B, D9), en orden:
 *  1. `hub:<hubId>` si la request trae un dispositivo autenticado (`req.hub`).
 *  2. `user:<id>` si trae una sesión humana (`req.user`).
 *  3. `ip:<req.ip>` en cualquier otro caso (rutas públicas). `req.ip` respeta
 *     `TRUST_PROXY` (main.ts).
 */
export function rateLimitTracker(req: unknown): string {
  const hubId = readNonEmptyString(readProperty(req, 'hub'), 'hubId');
  if (hubId) {
    return `hub:${hubId}`;
  }
  const userId = readNonEmptyString(readProperty(req, 'user'), 'id');
  if (userId) {
    return `user:${userId}`;
  }
  return `ip:${readNonEmptyString(req, 'ip') ?? 'unknown'}`;
}

/**
 * `ThrottlerGuard` con contador por hub, usuario o IP (Fase 4 · P4.B, D9).
 * Se aplica por método con `@RateLimit`, así corre DESPUÉS de los guards de
 * autenticación de la clase y ya conoce `req.hub`/`req.user`. La clave final
 * también incluye la clase y el método (`generateKey` de la librería): cada
 * ruta tiene su propio contador.
 */
@Injectable()
export class VigiliaThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(rateLimitTracker(req));
  }
}
