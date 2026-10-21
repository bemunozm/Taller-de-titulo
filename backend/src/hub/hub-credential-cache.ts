import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { HubType } from './entities/hub.entity';

/** Vigencia de una credencial verificada desde su último uso (10 min). */
export const HUB_CREDENTIAL_CACHE_TTL_MS = 10 * 60_000;

/**
 * Vida máxima de una entrada aunque se siga usando (24 h). Fase 4 · P6.R:
 * subió desde 1 h; la revocación no depende de este tope (`disconnectHub`
 * invalida la entrada al rotar el secret, desactivar el hub o cambiar su tipo
 * o condominio). Acota lo que tarda en caer un cambio hecho directo en la BD.
 */
export const HUB_CREDENTIAL_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

/** Tope de entradas (una por hub verificado). */
export const HUB_CREDENTIAL_CACHE_MAX_ENTRIES = 10_000;

/** Cada cuánto se purgan las entradas vencidas. */
const CLEANUP_INTERVAL_MS = 60_000;

/** Identidad de un dispositivo ya verificado (lo que guardan guard y gateway). */
export interface CachedHubIdentity {
  hubId: string;
  type: HubType;
  organizationId: string | null;
}

interface CacheEntry {
  /** HMAC-SHA256 del secret con la clave del proceso. Nunca el secret. */
  mac: Buffer;
  identity: CachedHubIdentity;
  createdAt: number;
  lastUsedAt: number;
}

/**
 * Caché de credenciales de dispositivo ya verificadas (Fase 4 · P4.B, cyber
 * N1 + residual de M2). Se consulta ANTES del limitador y del bcrypt, en
 * `HubAuthGuard` y en el middleware de `/hub`: un acierto autentica sin
 * bcrypt y sin tocar el limitador, así un hub o kiosko legítimo sigue
 * entrando aunque su IP esté bloqueada o el backend esté bajo una ráfaga.
 *
 *  - Guarda `hubId` -> HMAC-SHA256(secret) con una clave aleatoria por
 *    proceso (nunca el secret en claro; un volcado de memoria no sirve en
 *    otro proceso) y lo compara con `timingSafeEqual`.
 *  - Guarda la identidad (`type`, `organizationId`) verificada contra la BD.
 *  - Vence a los 10 min sin uso y, aunque se use, a las 24 h. El heartbeat
 *    de un socket `/hub` registrado la mantiene en uso (`touch`, Fase 4 ·
 *    P6.R): un hub conectado no paga bcrypt + limitador en su próxima
 *    llamada HTTP solo porque estuvo 10 min sin hacer requests.
 *  - Se invalida en `HubGateway.disconnectHub` (rotar secret, desactivar,
 *    cambiar tipo o condominio). Una verificación que empezó antes de la
 *    invalidación no repuebla el caché (`generation`).
 *  - Un secret incorrecto para un `hubId` cacheado es un fallo normal: sigue
 *    al limitador y al bcrypt.
 */
@Injectable()
export class HubCredentialCache implements OnModuleDestroy {
  private readonly key = randomBytes(32);
  private readonly entries = new Map<string, CacheEntry>();
  /** `hubId` -> secuencia de su última invalidación. */
  private readonly invalidations = new Map<string, number>();
  private sequence = 0;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.purgeExpired();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /**
   * Identidad cacheada si `secret` es el verificado para `hubId` y la entrada
   * sigue vigente; si no, `null` (el caller sigue con limitador + bcrypt).
   */
  lookup(
    hubId: string,
    secret: string,
    now: number = Date.now(),
  ): CachedHubIdentity | null {
    const entry = this.entries.get(hubId);
    if (!entry) {
      return null;
    }
    if (this.isExpired(entry, now)) {
      this.entries.delete(hubId);
      return null;
    }
    if (!timingSafeEqual(entry.mac, this.macOf(secret))) {
      return null;
    }
    entry.lastUsedAt = now;
    return { ...entry.identity };
  }

  /**
   * Renueva el último uso de la credencial cacheada de `hubId` (Fase 4 ·
   * P6.R): lo llama el heartbeat de un socket `/hub` ya autenticado y
   * registrado. No crea entradas ni revive una vencida, y no mueve
   * `createdAt`: la edad máxima sigue contando desde la verificación.
   *
   * @returns `true` si había una entrada vigente.
   */
  touch(hubId: string, now: number = Date.now()): boolean {
    const entry = this.entries.get(hubId);
    if (!entry) {
      return false;
    }
    if (this.isExpired(entry, now)) {
      this.entries.delete(hubId);
      return false;
    }
    entry.lastUsedAt = now;
    return true;
  }

  /** Marca de invalidación vigente para `hubId` (leer ANTES del bcrypt). */
  generation(hubId: string): number {
    return this.invalidations.get(hubId) ?? 0;
  }

  /**
   * Guarda una credencial recién verificada. Si `hubId` se invalidó después
   * de `generationAtStart` (p. ej. se rotó el secret durante el bcrypt), no
   * guarda nada.
   */
  store(
    identity: CachedHubIdentity,
    secret: string,
    generationAtStart: number,
    now: number = Date.now(),
  ): void {
    if (this.generation(identity.hubId) !== generationAtStart) {
      return;
    }
    this.entries.delete(identity.hubId);
    this.entries.set(identity.hubId, {
      mac: this.macOf(secret),
      identity: { ...identity },
      createdAt: now,
      lastUsedAt: now,
    });
    evictOldest(this.entries, HUB_CREDENTIAL_CACHE_MAX_ENTRIES);
  }

  /** Olvida la credencial de `hubId` y corta las verificaciones en curso. */
  invalidate(hubId: string): void {
    this.entries.delete(hubId);
    this.sequence += 1;
    this.invalidations.delete(hubId);
    this.invalidations.set(hubId, this.sequence);
    evictOldest(this.invalidations, HUB_CREDENTIAL_CACHE_MAX_ENTRIES);
  }

  /** Purga las entradas vencidas. */
  purgeExpired(now: number = Date.now()): void {
    for (const [hubId, entry] of [...this.entries]) {
      if (this.isExpired(entry, now)) {
        this.entries.delete(hubId);
      }
    }
  }

  /** Cantidad de credenciales cacheadas (diagnóstico y tests). */
  size(): number {
    return this.entries.size;
  }

  private isExpired(entry: CacheEntry, now: number): boolean {
    return (
      now - entry.lastUsedAt > HUB_CREDENTIAL_CACHE_TTL_MS ||
      now - entry.createdAt > HUB_CREDENTIAL_CACHE_MAX_AGE_MS
    );
  }

  private macOf(secret: string): Buffer {
    return createHmac('sha256', this.key).update(secret, 'utf8').digest();
  }
}

/** Descarta las claves más antiguas (orden de inserción) sobre el tope. */
function evictOldest<V>(map: Map<string, V>, maxKeys: number): void {
  while (map.size > maxKeys) {
    const oldest = map.keys().next();
    if (oldest.done) {
      return;
    }
    map.delete(oldest.value);
  }
}
