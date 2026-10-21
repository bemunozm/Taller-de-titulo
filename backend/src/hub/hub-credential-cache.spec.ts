import { HubType } from './entities/hub.entity';
import {
  type CachedHubIdentity,
  HUB_CREDENTIAL_CACHE_MAX_AGE_MS,
  HUB_CREDENTIAL_CACHE_MAX_ENTRIES,
  HUB_CREDENTIAL_CACHE_TTL_MS,
  HubCredentialCache,
} from './hub-credential-cache';

/**
 * Fase 4 · P4.B (cyber N1): caché de credenciales de dispositivo ya
 * verificadas (HMAC del secret con clave por proceso, TTL, invalidación y
 * memoria acotada).
 */
describe('HubCredentialCache', () => {
  const T0 = 1_000_000;
  const SECRET = 'secret-del-kiosko';
  const IDENTITY: CachedHubIdentity = {
    hubId: 'kiosk-1',
    type: HubType.WEB_KIOSK,
    organizationId: 'org-1',
  };
  let cache: HubCredentialCache;

  beforeEach(() => {
    cache = new HubCredentialCache();
  });

  afterEach(() => {
    cache.onModuleDestroy();
  });

  function storeNow(at: number = T0): void {
    cache.store(IDENTITY, SECRET, cache.generation(IDENTITY.hubId), at);
  }

  it('acierto: el mismo secret devuelve la identidad verificada', () => {
    storeNow();

    expect(cache.lookup('kiosk-1', SECRET, T0)).toEqual(IDENTITY);
  });

  it('un secret distinto para un hubId cacheado no autentica', () => {
    storeNow();

    expect(cache.lookup('kiosk-1', 'otro-secret', T0)).toBeNull();
    expect(cache.lookup('kiosk-1', `${SECRET}x`, T0)).toBeNull();
    expect(cache.lookup('kiosk-1', '', T0)).toBeNull();
  });

  it('un hubId sin entrada no autentica', () => {
    expect(cache.lookup('kiosk-1', SECRET, T0)).toBeNull();
  });

  it('nunca guarda el secret en claro (solo su HMAC)', () => {
    storeNow();
    const internals = cache as unknown as {
      entries: Map<string, { mac: Buffer }>;
    };

    const [entry] = [...internals.entries.values()];
    expect(entry.mac).toHaveLength(32);
    expect(entry.mac.toString('utf8')).not.toContain(SECRET);
    expect(JSON.stringify([...internals.entries])).not.toContain(SECRET);
  });

  it('dos procesos (instancias) no comparten la clave del HMAC', () => {
    const other = new HubCredentialCache();
    storeNow();
    other.store(IDENTITY, SECRET, other.generation('kiosk-1'), T0);
    const macOf = (instance: HubCredentialCache): Buffer =>
      [
        ...(
          instance as unknown as { entries: Map<string, { mac: Buffer }> }
        ).entries.values(),
      ][0].mac;

    expect(macOf(cache).equals(macOf(other))).toBe(false);
    other.onModuleDestroy();
  });

  it('vence a los 10 min sin uso; cada uso renueva el plazo', () => {
    storeNow(T0);
    const used = T0 + HUB_CREDENTIAL_CACHE_TTL_MS - 1;
    expect(cache.lookup('kiosk-1', SECRET, used)).not.toBeNull();

    expect(
      cache.lookup('kiosk-1', SECRET, used + HUB_CREDENTIAL_CACHE_TTL_MS - 1),
    ).not.toBeNull();
    expect(
      cache.lookup(
        'kiosk-1',
        SECRET,
        used + 2 * HUB_CREDENTIAL_CACHE_TTL_MS + 1,
      ),
    ).toBeNull();
  });

  it('aunque se siga usando, vence a las 24 h (P6.R; antes 1 h)', () => {
    expect(HUB_CREDENTIAL_CACHE_MAX_AGE_MS).toBe(24 * 60 * 60_000);
  });

  it('aunque se siga usando, vence a la edad máxima', () => {
    storeNow(T0);
    let now = T0;
    while (
      now + HUB_CREDENTIAL_CACHE_TTL_MS / 2 <=
      T0 + HUB_CREDENTIAL_CACHE_MAX_AGE_MS
    ) {
      now += HUB_CREDENTIAL_CACHE_TTL_MS / 2;
      cache.lookup('kiosk-1', SECRET, now);
    }

    expect(
      cache.lookup('kiosk-1', SECRET, T0 + HUB_CREDENTIAL_CACHE_MAX_AGE_MS + 1),
    ).toBeNull();
  });

  describe('touch (heartbeat del socket /hub, Fase 4 · P6.R)', () => {
    it('renueva el último uso: sin requests HTTP, la credencial sigue viva mientras haya heartbeats', () => {
      storeNow(T0);
      let now = T0;
      // Heartbeats cada 30 s durante 3 h, sin ningún lookup.
      while (now < T0 + 3 * 60 * 60_000) {
        now += 30_000;
        expect(cache.touch('kiosk-1', now)).toBe(true);
      }

      expect(cache.lookup('kiosk-1', SECRET, now + 1)).toEqual(IDENTITY);
    });

    it('sin touch vence a los 10 min (el heartbeat es lo que la mantiene)', () => {
      storeNow(T0);
      expect(
        cache.lookup('kiosk-1', SECRET, T0 + HUB_CREDENTIAL_CACHE_TTL_MS + 1),
      ).toBeNull();
    });

    it('no mueve la edad máxima: con heartbeats igual vence a las 24 h', () => {
      storeNow(T0);
      for (
        let now = T0;
        now <= T0 + HUB_CREDENTIAL_CACHE_MAX_AGE_MS;
        now += HUB_CREDENTIAL_CACHE_TTL_MS / 2
      ) {
        cache.touch('kiosk-1', now);
      }

      const afterMaxAge = T0 + HUB_CREDENTIAL_CACHE_MAX_AGE_MS + 1;
      expect(cache.touch('kiosk-1', afterMaxAge)).toBe(false);
      expect(cache.lookup('kiosk-1', SECRET, afterMaxAge)).toBeNull();
      expect(cache.size()).toBe(0);
    });

    it('no crea entradas ni revive una vencida', () => {
      expect(cache.touch('kiosk-1', T0)).toBe(false);
      expect(cache.size()).toBe(0);

      storeNow(T0);
      const expired = T0 + HUB_CREDENTIAL_CACHE_TTL_MS + 1;
      expect(cache.touch('kiosk-1', expired)).toBe(false);
      expect(cache.lookup('kiosk-1', SECRET, expired)).toBeNull();
    });

    it('tras invalidate (rotar secret, desactivar) no la revive', () => {
      storeNow(T0);
      cache.invalidate('kiosk-1');

      expect(cache.touch('kiosk-1', T0 + 1)).toBe(false);
      expect(cache.lookup('kiosk-1', SECRET, T0 + 1)).toBeNull();
    });
  });

  it('invalidate borra la credencial (rotar secret, desactivar, cambiar tipo u org)', () => {
    storeNow();

    cache.invalidate('kiosk-1');

    expect(cache.lookup('kiosk-1', SECRET, T0)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('una verificación que empezó antes de invalidar no repuebla el caché', () => {
    const generationAtStart = cache.generation('kiosk-1');
    cache.invalidate('kiosk-1');

    cache.store(IDENTITY, SECRET, generationAtStart, T0);

    expect(cache.lookup('kiosk-1', SECRET, T0)).toBeNull();
    // Una verificación nueva (después de invalidar) sí guarda.
    storeNow();
    expect(cache.lookup('kiosk-1', SECRET, T0)).toEqual(IDENTITY);
  });

  it('memoria acotada: sobre el tope descarta la entrada más antigua', () => {
    for (let i = 0; i <= HUB_CREDENTIAL_CACHE_MAX_ENTRIES; i++) {
      cache.store({ ...IDENTITY, hubId: `hub-${i}` }, SECRET, 0, T0);
    }

    expect(cache.size()).toBe(HUB_CREDENTIAL_CACHE_MAX_ENTRIES);
    expect(cache.lookup('hub-0', SECRET, T0)).toBeNull();
  });

  it('purgeExpired borra las entradas vencidas', () => {
    storeNow(T0);

    cache.purgeExpired(T0 + HUB_CREDENTIAL_CACHE_TTL_MS + 1);

    expect(cache.size()).toBe(0);
  });

  it('devuelve una copia: modificarla no altera el caché', () => {
    storeNow();
    const identity = cache.lookup('kiosk-1', SECRET, T0);
    if (identity) {
      identity.organizationId = 'otra-org';
    }

    expect(cache.lookup('kiosk-1', SECRET, T0)?.organizationId).toBe('org-1');
  });
});
