import type { ConfigService } from '@nestjs/config';
import {
  clientIpKey,
  HUB_AUTH_FAILURE_WINDOW_MS,
  HUB_AUTH_MAX_FAILURES,
  HUB_AUTH_MAX_IN_FLIGHT_GLOBAL,
  HUB_AUTH_MAX_IN_FLIGHT_PER_IP,
  HUB_AUTH_MAX_TRACKED_KEYS,
  HubAuthFailureLimiter,
  type HubAuthAttempt,
  type HubAuthReservation,
  resolveForwardedClientIp,
} from './hub-auth-failure-limiter';

/**
 * Fase 4 · P4.B (D9, cyber M1/M2/N1): reserva del intento antes del bcrypt,
 * tope de verificaciones en curso (por IP y global), IPv6 por /64 y memoria
 * acotada. Sin excepciones por `hubId`: la credencial ya verificada se
 * resuelve antes, en `HubCredentialCache`.
 */
describe('HubAuthFailureLimiter', () => {
  const IP = '203.0.113.30';
  const T0 = 1_000_000;
  let limiter: HubAuthFailureLimiter;

  function attemptOf(reservation: HubAuthReservation): HubAuthAttempt {
    if (!reservation.ok) {
      throw new Error(`reserva rechazada: ${reservation.reason}`);
    }
    return reservation.attempt;
  }

  /** `times` intentos fallidos (secuenciales) desde `ip`. */
  function fail(times: number, ip: string = IP, at: number = T0): void {
    for (let i = 0; i < times; i++) {
      attemptOf(limiter.tryBegin(ip, at)).fail();
    }
  }

  beforeEach(() => {
    limiter = new HubAuthFailureLimiter();
  });

  afterEach(() => {
    limiter.onModuleDestroy();
  });

  describe('límite de fallos por IP', () => {
    it('bloquea al llegar al límite dentro de la ventana, no antes', () => {
      fail(HUB_AUTH_MAX_FAILURES - 1);
      expect(limiter.tryBegin(IP, T0).ok).toBe(true);
    });

    it('con el límite alcanzado, rechaza sin reservar (ip_blocked)', () => {
      fail(HUB_AUTH_MAX_FAILURES);

      expect(limiter.tryBegin(IP, T0)).toEqual({
        ok: false,
        reason: 'ip_blocked',
      });
      expect(limiter.stats().inFlight).toBe(0);
    });

    it('ventana deslizante: al vencer el fallo más antiguo vuelve a permitir', () => {
      fail(1, IP, T0);
      fail(HUB_AUTH_MAX_FAILURES - 1, IP, T0 + 60_000);
      expect(limiter.tryBegin(IP, T0 + 60_000).ok).toBe(false);

      expect(limiter.tryBegin(IP, T0 + HUB_AUTH_FAILURE_WINDOW_MS + 1).ok).toBe(
        true,
      );
    });

    it('el éxito perdona el fallo reservado: los éxitos no cuentan', () => {
      for (let i = 0; i < HUB_AUTH_MAX_FAILURES * 2; i++) {
        attemptOf(limiter.tryBegin(IP, T0)).succeed();
      }
      fail(HUB_AUTH_MAX_FAILURES - 1);

      expect(limiter.tryBegin(IP, T0).ok).toBe(true);
    });

    it('el intento cuenta al reservarse: con el último cupo en curso, el resto se rechaza; si tuvo éxito, se perdona', () => {
      fail(HUB_AUTH_MAX_FAILURES - 1);
      const last = attemptOf(limiter.tryBegin(IP, T0));

      expect(limiter.tryBegin(IP, T0)).toEqual({
        ok: false,
        reason: 'ip_blocked',
      });

      last.succeed();
      expect(limiter.tryBegin(IP, T0).ok).toBe(true);
    });

    it('abort (error de BD o revocación) tampoco cuenta como fallo', () => {
      for (let i = 0; i < HUB_AUTH_MAX_FAILURES; i++) {
        attemptOf(limiter.tryBegin(IP, T0)).abort();
      }

      expect(limiter.tryBegin(IP, T0).ok).toBe(true);
    });

    it('cerrar dos veces el mismo intento no altera los contadores', () => {
      const attempt = attemptOf(limiter.tryBegin(IP, T0));
      attempt.fail();
      attempt.succeed();
      attempt.abort();

      expect(limiter.stats().inFlight).toBe(0);
      fail(HUB_AUTH_MAX_FAILURES - 1);
      expect(limiter.tryBegin(IP, T0).ok).toBe(false);
    });

    it('el contador es por IP', () => {
      fail(HUB_AUTH_MAX_FAILURES);

      expect(limiter.tryBegin('198.51.100.1', T0).ok).toBe(true);
    });
  });

  describe('reserva antes del bcrypt (verificaciones en curso)', () => {
    it('ráfaga concurrente de 100 desde una IP: solo 3 reservas (≤3 bcrypt)', () => {
      const reservations = Array.from({ length: 100 }, () =>
        limiter.tryBegin(IP, T0),
      );

      expect(reservations.filter((r) => r.ok)).toHaveLength(
        HUB_AUTH_MAX_IN_FLIGHT_PER_IP,
      );
      expect(
        reservations.filter((r) => !r.ok && r.reason === 'ip_busy'),
      ).toHaveLength(100 - HUB_AUTH_MAX_IN_FLIGHT_PER_IP);
    });

    it('al cerrar un intento se libera su lugar', () => {
      const first = attemptOf(limiter.tryBegin(IP, T0));
      attemptOf(limiter.tryBegin(IP, T0));
      attemptOf(limiter.tryBegin(IP, T0));
      expect(limiter.tryBegin(IP, T0).ok).toBe(false);

      first.fail();

      expect(limiter.tryBegin(IP, T0).ok).toBe(true);
    });

    it('semáforo global: con 8 verificaciones en curso (de IPs distintas) rechaza la siguiente (server_busy)', () => {
      for (let i = 0; i < HUB_AUTH_MAX_IN_FLIGHT_GLOBAL; i++) {
        attemptOf(limiter.tryBegin(`198.51.100.${i + 1}`, T0));
      }

      expect(limiter.tryBegin('192.0.2.200', T0)).toEqual({
        ok: false,
        reason: 'server_busy',
      });
      expect(limiter.stats().inFlight).toBe(HUB_AUTH_MAX_IN_FLIGHT_GLOBAL);
    });
  });

  describe('IPv6 por /64', () => {
    it('dos direcciones del mismo /64 comparten el contador', () => {
      fail(HUB_AUTH_MAX_FAILURES, '2001:db8:1:2::1');

      expect(limiter.tryBegin('2001:db8:1:2:ffff::9', T0).ok).toBe(false);
    });

    it('otro /64 tiene su propio contador', () => {
      fail(HUB_AUTH_MAX_FAILURES, '2001:db8:1:2::1');

      expect(limiter.tryBegin('2001:db8:1:3::1', T0).ok).toBe(true);
    });

    it.each([
      ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
      ['2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
      ['fe80::1%eth0', 'fe80:0:0:0::/64'],
      ['::1', '0:0:0:0::/64'],
      ['::ffff:203.0.113.5', '203.0.113.5'],
      ['64:ff9b::192.0.2.1', '64:ff9b:0:0::/64'],
      ['203.0.113.5', '203.0.113.5'],
      [undefined, 'unknown'],
      ['', 'unknown'],
    ])('clientIpKey(%p) -> %p', (ip, expected) => {
      expect(clientIpKey(ip)).toBe(expected);
    });
  });

  describe('memoria acotada', () => {
    it('purgeExpired borra los contadores vencidos', () => {
      fail(3, '192.0.2.2', T0);
      expect(limiter.stats().trackedIps).toBe(1);

      limiter.purgeExpired(T0 + HUB_AUTH_FAILURE_WINDOW_MS + 1);

      expect(limiter.stats()).toEqual({ trackedIps: 0, inFlight: 0 });
    });

    it('sobre el tope de IPs descarta la más antigua', () => {
      for (let i = 0; i <= HUB_AUTH_MAX_TRACKED_KEYS; i++) {
        attemptOf(limiter.tryBegin(`ip-${i}`, T0 + i)).fail();
      }

      expect(limiter.stats().trackedIps).toBe(HUB_AUTH_MAX_TRACKED_KEYS);
    });
  });

  describe('IP de un handshake de socket.io', () => {
    it('sin TRUST_PROXY usa la dirección del socket e ignora X-Forwarded-For', () => {
      expect(
        limiter.clientIpFromHandshake({
          address: '10.0.0.5',
          headers: { 'x-forwarded-for': '6.6.6.6' },
        }),
      ).toBe('10.0.0.5');
    });

    it('con TRUST_PROXY=1 toma la IP que agregó el proxy (último salto)', () => {
      const behindProxy = new HubAuthFailureLimiter({
        get: () => '1',
      } as unknown as ConfigService);

      expect(
        behindProxy.clientIpFromHandshake({
          address: '10.0.0.5',
          headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.99' },
        }),
      ).toBe('203.0.113.99');
      behindProxy.onModuleDestroy();
    });
  });
});

describe('resolveForwardedClientIp (mismo criterio que req.ip de Express)', () => {
  it.each([
    ['sin proxies de confianza', '10.0.0.1', '1.1.1.1, 2.2.2.2', 0, '10.0.0.1'],
    [
      '1 proxy: el último de X-Forwarded-For',
      '10.0.0.1',
      '1.1.1.1, 2.2.2.2',
      1,
      '2.2.2.2',
    ],
    ['2 proxies: el penúltimo', '10.0.0.1', '1.1.1.1, 2.2.2.2', 2, '1.1.1.1'],
    [
      'más saltos que entradas: el primero',
      '10.0.0.1',
      '1.1.1.1',
      5,
      '1.1.1.1',
    ],
    [
      'sin header: la dirección del socket',
      '10.0.0.1',
      undefined,
      1,
      '10.0.0.1',
    ],
  ] as Array<[string, string, string | undefined, number, string]>)(
    '%s',
    (_case, remote, forwarded, hops, expected) => {
      expect(resolveForwardedClientIp(remote, forwarded, hops)).toBe(expected);
    },
  );

  it('acepta el header repetido (array)', () => {
    expect(
      resolveForwardedClientIp('10.0.0.1', ['1.1.1.1', '2.2.2.2'], 1),
    ).toBe('2.2.2.2');
  });

  it('sin dirección de socket devuelve undefined', () => {
    expect(resolveForwardedClientIp(undefined, '1.1.1.1', 1)).toBeUndefined();
  });
});
