import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIPv4, isIPv6 } from 'node:net';
import { parseTrustProxy } from '../config/env.validation';

/** Fallos de credencial admitidos por IP (o /64) dentro de la ventana. */
export const HUB_AUTH_MAX_FAILURES = 20;

/** Ventana deslizante del contador de fallos (5 minutos). */
export const HUB_AUTH_FAILURE_WINDOW_MS = 5 * 60_000;

/** Verificaciones (bcrypt) en curso admitidas por IP. */
export const HUB_AUTH_MAX_IN_FLIGHT_PER_IP = 3;

/** Verificaciones (bcrypt) en curso admitidas en todo el backend. */
export const HUB_AUTH_MAX_IN_FLIGHT_GLOBAL = 8;

/**
 * Tope de IPs con fallos en memoria. Al superarlo se descarta la IP con la
 * actividad más antigua: la memoria nunca crece sin cota.
 */
export const HUB_AUTH_MAX_TRACKED_KEYS = 10_000;

/** Cada cuánto se purgan las entradas vencidas. */
const CLEANUP_INTERVAL_MS = 60_000;

/** Mensaje del 429 (sin detalle del motivo). */
export const HUB_AUTH_THROTTLED_MESSAGE =
  'Demasiados intentos de autenticación de dispositivo. Intenta más tarde.';

/** Por qué se rechazó un intento sin verificar la credencial. */
export type HubAuthRejection =
  /** La IP superó su límite de fallos. */
  | 'ip_blocked'
  /** La IP ya tiene el máximo de verificaciones en curso. */
  | 'ip_busy'
  /** El backend ya tiene el máximo de verificaciones en curso. */
  | 'server_busy';

/** Intento reservado: hay que cerrarlo exactamente una vez. */
export interface HubAuthAttempt {
  /** Credencial válida: perdona el fallo reservado. */
  succeed(): void;
  /** Credencial rechazada: el fallo reservado queda contado. */
  fail(): void;
  /**
   * No se llegó a un veredicto (error de BD, revocación en curso): perdona
   * el fallo reservado.
   */
  abort(): void;
}

export type HubAuthReservation =
  | { ok: true; attempt: HubAuthAttempt }
  | { ok: false; reason: HubAuthRejection };

/** Handshake de socket.io: lo mínimo para resolver la IP del cliente. */
export interface HandshakeAddressSource {
  address?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * IP del cliente detrás de `trustedHops` proxies, con el mismo criterio que
 * Express usa para `req.ip` con `trust proxy = <número>` (`proxy-addr`): la
 * lista es `[dirección del socket, ...X-Forwarded-For de derecha a
 * izquierda]` y se toma la posición `trustedHops` (o la última si la lista es
 * más corta). Con `trustedHops = 0` se ignora `X-Forwarded-For`: un cliente
 * no puede elegir su IP.
 */
export function resolveForwardedClientIp(
  remoteAddress: string | undefined,
  forwardedFor: string | string[] | undefined,
  trustedHops: number,
): string | undefined {
  if (!remoteAddress) {
    return undefined;
  }
  if (trustedHops <= 0 || forwardedFor === undefined) {
    return remoteAddress;
  }
  const header = Array.isArray(forwardedFor)
    ? forwardedFor.join(',')
    : forwardedFor;
  const forwarded = header
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .reverse();
  const addresses = [remoteAddress, ...forwarded];
  return addresses[Math.min(trustedHops, addresses.length - 1)];
}

/** Cantidad de grupos de 16 bits que ocupa un segmento de una IPv6. */
function groupWidth(group: string): number {
  return group.includes('.') ? 2 : 1;
}

/** Prefijo /64 de una IPv6 ya validada (`2001:db8:1:2::/64`). */
function ipv6Prefix64(address: string): string {
  const [head, tail] = address.includes('::')
    ? address.split('::')
    : [address, undefined];
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const used = [...headGroups, ...tailGroups].reduce(
    (total, group) => total + groupWidth(group),
    0,
  );
  const zeros: string[] =
    tail === undefined ? [] : new Array<string>(8 - used).fill('0');
  const groups = [...headGroups, ...zeros, ...tailGroups];
  const prefix = groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16));
  return `${prefix.join(':')}::/64`;
}

/**
 * Clave de conteo de una IP: IPv4 tal cual (también la IPv4 mapeada en IPv6,
 * `::ffff:1.2.3.4`); IPv6 agrupada por su /64 (un cliente IPv6 suele tener
 * el /64 entero y podría rotar de dirección en cada intento).
 */
export function clientIpKey(ip: string | undefined): string {
  const value = ip?.trim() ?? '';
  if (value.length === 0) {
    return 'unknown';
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped && isIPv4(mapped[1])) {
    return mapped[1];
  }
  if (isIPv4(value)) {
    return value;
  }
  const withoutZone = value.split('%')[0].toLowerCase();
  if (isIPv6(withoutZone)) {
    return ipv6Prefix64(withoutZone);
  }
  return value.slice(0, 64);
}

/** Timestamps de fallos por clave, en ventana deslizante y con tope. */
class SlidingWindowCounter {
  private readonly entries = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPerKey: number,
    private readonly maxKeys: number,
  ) {}

  count(key: string, now: number): number {
    return this.recent(key, now).length;
  }

  add(key: string, now: number): void {
    const recent = this.recent(key, now);
    recent.push(now);
    // Solo importan los últimos N para decidir el bloqueo (N incluye margen
    // para los intentos en curso, ver la construcción en el limitador).
    if (recent.length > this.maxPerKey) {
      recent.splice(0, recent.length - this.maxPerKey);
    }
    // Reinsertar mueve la clave al final: la más antigua queda primera.
    this.entries.delete(key);
    this.entries.set(key, recent);
    evictOldest(this.entries, this.maxKeys);
  }

  /** Perdona un fallo registrado en `timestamp`. */
  remove(key: string, timestamp: number): void {
    const timestamps = this.entries.get(key);
    if (!timestamps) {
      return;
    }
    const index = timestamps.lastIndexOf(timestamp);
    if (index >= 0) {
      timestamps.splice(index, 1);
    }
    if (timestamps.length === 0) {
      this.entries.delete(key);
    }
  }

  purge(now: number): void {
    for (const key of [...this.entries.keys()]) {
      this.recent(key, now);
    }
  }

  size(): number {
    return this.entries.size;
  }

  private recent(key: string, now: number): number[] {
    const timestamps = this.entries.get(key);
    if (!timestamps) {
      return [];
    }
    const windowStart = now - this.windowMs;
    const recent = timestamps.filter((timestamp) => timestamp > windowStart);
    if (recent.length === 0) {
      this.entries.delete(key);
    } else if (recent.length !== timestamps.length) {
      this.entries.set(key, recent);
    }
    return recent;
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

/**
 * Límite de intentos de credencial de dispositivo (Fase 4 · P4.B, D9 + cyber
 * M1/M2/N1). Verificar una credencial cuesta un bcrypt
 * (`verifyHubCredentials`): sin límite, cualquiera podía gastar CPU del
 * backend probando secrets.
 *
 * Solo protege el camino CON bcrypt: `HubAuthGuard` y el middleware de
 * `/hub` consultan antes `HubCredentialCache`, y una credencial ya
 * verificada entra sin pasar por acá (el dispositivo legítimo no queda fuera
 * por una IP bloqueada ni por una ráfaga). Antes del bcrypt, `tryBegin`
 * reserva el intento:
 *  - El intento cuenta como fallo AL RESERVARSE (una ráfaga concurrente no se
 *    cuela entre "consultar" y "registrar") y se perdona si la credencial es
 *    válida (`succeed`) o si no hubo veredicto (`abort`).
 *  - Como mucho `HUB_AUTH_MAX_IN_FLIGHT_PER_IP` verificaciones en curso por IP
 *    y `HUB_AUTH_MAX_IN_FLIGHT_GLOBAL` en todo el backend: el exceso se
 *    rechaza sin bcrypt.
 *  - Una IP con `HUB_AUTH_MAX_FAILURES` fallos en la ventana queda bloqueada
 *    para CUALQUIER `hubId` (cyber N1: sin excepciones por `hubId`, la
 *    respuesta bajo bloqueo no revela qué `hubId` existen).
 *  - IPv6 se cuenta por /64.
 *
 * Todo en memoria (una sola instancia del backend en el piloto), con topes y
 * purga periódica. Ver backend/src/hub/README.md (Troubleshooting).
 */
@Injectable()
export class HubAuthFailureLimiter implements OnModuleDestroy {
  private readonly logger = new Logger(HubAuthFailureLimiter.name);
  // Cada IP guarda hasta (límite + verificaciones en curso posibles)
  // timestamps: perdonar un intento reservado (`succeed`/`abort`) nunca
  // borra un fallo real que se haya descartado al recortar la lista.
  private readonly ipFailures = new SlidingWindowCounter(
    HUB_AUTH_FAILURE_WINDOW_MS,
    HUB_AUTH_MAX_FAILURES + HUB_AUTH_MAX_IN_FLIGHT_GLOBAL,
    HUB_AUTH_MAX_TRACKED_KEYS,
  );
  /** Verificaciones en curso por IP (como mucho `HUB_AUTH_MAX_IN_FLIGHT_GLOBAL` claves). */
  private readonly inFlightByIp = new Map<string, number>();
  private globalInFlight = 0;
  private readonly trustedHops: number;
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(@Optional() config?: ConfigService) {
    this.trustedHops = parseTrustProxy(config?.get<string>('TRUST_PROXY')) || 0;
    this.cleanupTimer = setInterval(() => {
      this.purgeExpired();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /** IP del cliente de un handshake de socket.io, respetando `TRUST_PROXY`. */
  clientIpFromHandshake(handshake: HandshakeAddressSource): string | undefined {
    return resolveForwardedClientIp(
      handshake.address,
      handshake.headers?.['x-forwarded-for'],
      this.trustedHops,
    );
  }

  /** Reserva un intento de verificación (bcrypt) para la IP, o lo rechaza. */
  tryBegin(
    ip: string | undefined,
    now: number = Date.now(),
  ): HubAuthReservation {
    const ipKey = clientIpKey(ip);

    const rejection = this.rejectionFor(ipKey, now);
    if (rejection) {
      // debug: un rechazo por intento inundaría el log durante un ataque. El
      // warn sale una vez, al alcanzar el límite (ver abajo).
      this.logger.debug(
        `Credencial de dispositivo rechazada sin verificar (${rejection}, ip=${ipKey})`,
      );
      return { ok: false, reason: rejection };
    }

    this.inFlightByIp.set(ipKey, (this.inFlightByIp.get(ipKey) ?? 0) + 1);
    this.globalInFlight += 1;
    this.ipFailures.add(ipKey, now);
    if (this.ipFailures.count(ipKey, now) === HUB_AUTH_MAX_FAILURES) {
      this.logger.warn(
        `Límite de fallos de credencial de dispositivo alcanzado para la IP ${ipKey}: se rechaza sin verificar durante la ventana`,
      );
    }

    let settled = false;
    const settle = (forgive: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      this.release(ipKey);
      if (forgive) {
        this.ipFailures.remove(ipKey, now);
      }
    };

    return {
      ok: true,
      attempt: {
        succeed: () => settle(true),
        fail: () => settle(false),
        abort: () => settle(true),
      },
    };
  }

  /** Purga los contadores vencidos. */
  purgeExpired(now: number = Date.now()): void {
    this.ipFailures.purge(now);
  }

  /** Tamaño de cada estructura (diagnóstico y tests). */
  stats(): { trackedIps: number; inFlight: number } {
    return {
      trackedIps: this.ipFailures.size(),
      inFlight: this.globalInFlight,
    };
  }

  private rejectionFor(ipKey: string, now: number): HubAuthRejection | null {
    if (this.ipFailures.count(ipKey, now) >= HUB_AUTH_MAX_FAILURES) {
      return 'ip_blocked';
    }
    if ((this.inFlightByIp.get(ipKey) ?? 0) >= HUB_AUTH_MAX_IN_FLIGHT_PER_IP) {
      return 'ip_busy';
    }
    if (this.globalInFlight >= HUB_AUTH_MAX_IN_FLIGHT_GLOBAL) {
      return 'server_busy';
    }
    return null;
  }

  private release(ipKey: string): void {
    const inFlight = (this.inFlightByIp.get(ipKey) ?? 1) - 1;
    if (inFlight > 0) {
      this.inFlightByIp.set(ipKey, inFlight);
    } else {
      this.inFlightByIp.delete(ipKey);
    }
    this.globalInFlight = Math.max(0, this.globalInFlight - 1);
  }
}
