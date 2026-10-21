import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubAuthGuard, type AuthenticatedHub } from './hub-auth.guard';
import type { TenantContext } from '../../common/tenant/tenant-context.types';
import { Hub, HubType } from '../entities/hub.entity';
import { hashPassword } from '../../auth/utils/auth.util';
import { HUB_UNAUTHORIZED_MESSAGE } from '../hub-credentials';
import {
  HUB_AUTH_MAX_FAILURES,
  HUB_AUTH_MAX_IN_FLIGHT_GLOBAL,
  HUB_AUTH_MAX_IN_FLIGHT_PER_IP,
  HubAuthFailureLimiter,
} from '../hub-auth-failure-limiter';
import { HubCredentialCache } from '../hub-credential-cache';

/**
 * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgo H1):
 * antes `HubAuthGuard` validaba contra un `HUB_SECRET` global compartido —
 * cualquier hub con el secret correcto podía anunciar el `X-Hub-Id` de OTRO
 * condominio y suplantarlo. Ahora valida el secret contra el `secretHash`
 * PROPIO del hub identificado por `hubId`.
 */
describe('HubAuthGuard', () => {
  let guard: HubAuthGuard;
  let hubRepository: jest.Mocked<Repository<Hub>>;
  let limiter: HubAuthFailureLimiter;
  let cache: HubCredentialCache;
  let secretHashA: string;

  /** Request HTTP tal como la lee y la deja `HubAuthGuard`. */
  interface GuardRequest {
    headers: Record<string, string>;
    ip?: string;
    hub?: AuthenticatedHub;
    tenantContext?: TenantContext;
  }

  function makeRequestContext(
    headers: Record<string, string>,
    ip = '203.0.113.10',
  ): {
    ctx: ExecutionContext;
    request: GuardRequest;
  } {
    const request: GuardRequest = { headers, ip };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  function makeContext(
    headers: Record<string, string>,
    ip?: string,
  ): ExecutionContext {
    return makeRequestContext(headers, ip).ctx;
  }

  beforeAll(async () => {
    secretHashA = await hashPassword('secret-hub-A');
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubAuthGuard,
        HubAuthFailureLimiter,
        HubCredentialCache,
        {
          provide: getRepositoryToken(Hub),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get(HubAuthGuard);
    hubRepository = module.get(getRepositoryToken(Hub));
    limiter = module.get(HubAuthFailureLimiter);
    cache = module.get(HubCredentialCache);
  });

  afterEach(() => {
    limiter.onModuleDestroy();
    cache.onModuleDestroy();
  });

  const mockHub = (overrides: Partial<Hub> = {}): Hub =>
    ({
      id: 'irrelevant',
      hubId: 'hub-A',
      type: HubType.PHYSICAL_HUB,
      organizationId: '11111111-1111-4111-8111-111111111111',
      secretHash: secretHashA,
      active: true,
      ...overrides,
    }) as Hub;

  it('permite el acceso con el secret propio correcto', async () => {
    hubRepository.findOne.mockResolvedValue(mockHub());

    const ctx = makeContext({
      'x-hub-id': 'hub-A',
      'x-hub-secret': 'secret-hub-A',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('autentica un hub type="web-kiosk" igual que un physical-hub y expone su type en request.hub (Fase 4 · P4)', async () => {
    hubRepository.findOne.mockResolvedValue(
      mockHub({ hubId: 'kiosk-A', type: HubType.WEB_KIOSK }),
    );

    const { ctx, request } = makeRequestContext({
      'x-hub-id': 'kiosk-A',
      'x-hub-secret': 'secret-hub-A',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(request.hub).toEqual({
      hubId: 'kiosk-A',
      type: HubType.WEB_KIOSK,
      organizationId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('rechaza cuando el hubId anunciado no coincide con el dueño del secret (impersonación)', async () => {
    // hub-A existe, pero el secret pertenece a otro hub (hash distinto) —
    // simula el ataque central de H1: reclamar X-Hub-Id ajeno.
    hubRepository.findOne.mockResolvedValue(mockHub({ hubId: 'hub-A' }));

    const ctx = makeContext({
      'x-hub-id': 'hub-A',
      'x-hub-secret': 'secret-de-otro-hub',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza un hubId desconocido', async () => {
    hubRepository.findOne.mockResolvedValue(null);

    const ctx = makeContext({
      'x-hub-id': 'hub-fantasma',
      'x-hub-secret': 'lo-que-sea',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza si falta el header X-Hub-Secret', async () => {
    const ctx = makeContext({ 'x-hub-id': 'hub-A' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Falta el header X-Hub-Secret',
    );
  });

  it('rechaza si falta el header X-Hub-Id', async () => {
    const ctx = makeContext({ 'x-hub-secret': 'secret-hub-A' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      'Falta el header X-Hub-Id',
    );
  });

  it('rechaza un hub sin secretHash provisionado', async () => {
    hubRepository.findOne.mockResolvedValue(mockHub({ secretHash: null }));

    const ctx = makeContext({
      'x-hub-id': 'hub-A',
      'x-hub-secret': 'secret-hub-A',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  /**
   * Fase 4 · P4: el 401 no permite enumerar `hubId` — mismo mensaje para hub
   * desconocido/inactivo, sin secret o con secret inválido.
   */
  it('responde el MISMO 401 para hub desconocido, sin secret y con secret inválido', async () => {
    const messageOf = async (hub: Hub | null): Promise<string> => {
      hubRepository.findOne.mockResolvedValueOnce(hub);
      const ctx = makeContext({
        'x-hub-id': 'hub-A',
        'x-hub-secret': 'secret-incorrecto',
      });
      const error: unknown = await guard
        .canActivate(ctx)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      return (error as UnauthorizedException).message;
    };

    const unknownHub = await messageOf(null);
    const withoutSecret = await messageOf(mockHub({ secretHash: null }));
    const invalidSecret = await messageOf(mockHub());

    expect(unknownHub).toBe(HUB_UNAUTHORIZED_MESSAGE);
    expect(withoutSecret).toBe(HUB_UNAUTHORIZED_MESSAGE);
    expect(invalidSecret).toBe(HUB_UNAUTHORIZED_MESSAGE);
  });

  it('puebla request.hub y request.tenantContext con el organizationId del hub autenticado', async () => {
    hubRepository.findOne.mockResolvedValue(mockHub());
    const { ctx, request } = makeRequestContext({
      'x-hub-id': 'hub-A',
      'x-hub-secret': 'secret-hub-A',
    });

    await guard.canActivate(ctx);

    expect(request.hub).toEqual({
      hubId: 'hub-A',
      type: HubType.PHYSICAL_HUB,
      organizationId: '11111111-1111-4111-8111-111111111111',
    });
    expect(request.tenantContext).toEqual({
      organizationId: '11111111-1111-4111-8111-111111111111',
      isSuperAdmin: false,
    });
  });

  /**
   * Fase 4 · P4.B (D9, cyber M1/M2/N1/B7): caché de credenciales verificadas
   * ANTES del limitador; el intento con bcrypt se reserva antes de
   * verificarse; el `hubId` se valida antes de la BD.
   */
  describe('caché de credenciales y límite de intentos', () => {
    const IP = '203.0.113.10';
    const BAD = { 'x-hub-id': 'hub-A', 'x-hub-secret': 'secret-incorrecto' };
    const GOOD = { 'x-hub-id': 'hub-A', 'x-hub-secret': 'secret-hub-A' };

    /** Agota el límite de la IP con intentos fallidos. */
    function exhaustIp(ip: string = IP): void {
      for (let i = 0; i < HUB_AUTH_MAX_FAILURES; i++) {
        const reservation = limiter.tryBegin(ip);
        if (reservation.ok) {
          reservation.attempt.fail();
        }
      }
    }

    /** Ocupa el semáforo global con verificaciones "en curso". */
    function saturateServer(): void {
      for (let i = 0; i < HUB_AUTH_MAX_IN_FLIGHT_GLOBAL; i++) {
        limiter.tryBegin(`198.51.100.${i + 1}`);
      }
    }

    async function statusOf(promise: Promise<boolean>): Promise<number> {
      const error: unknown = await promise.catch((e: unknown) => e);
      return error instanceof HttpException ? error.getStatus() : 200;
    }

    it('la primera autenticación verifica con bcrypt; la siguiente sale del caché (sin BD ni limitador)', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub());
      await expect(guard.canActivate(makeContext(GOOD))).resolves.toBe(true);
      const tryBegin = jest.spyOn(limiter, 'tryBegin');
      hubRepository.findOne.mockClear();

      const { ctx, request } = makeRequestContext(GOOD);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);

      expect(hubRepository.findOne.mock.calls).toHaveLength(0);
      expect(tryBegin).not.toHaveBeenCalled();
      expect(request.hub).toEqual({
        hubId: 'hub-A',
        type: HubType.PHYSICAL_HUB,
        organizationId: '11111111-1111-4111-8111-111111111111',
      });
      expect(request.tenantContext).toEqual({
        organizationId: '11111111-1111-4111-8111-111111111111',
        isSuperAdmin: false,
      });
    });

    it('el dispositivo legítimo (cacheado) entra con su IP bloqueada y bajo una ráfaga global', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub());
      await guard.canActivate(makeContext(GOOD));
      exhaustIp();
      saturateServer();

      await expect(guard.canActivate(makeContext(GOOD))).resolves.toBe(true);
    });

    it('un secret incorrecto para un hubId cacheado no autentica y cuenta como fallo', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub());
      await guard.canActivate(makeContext(GOOD));
      const tryBegin = jest.spyOn(limiter, 'tryBegin');

      await expect(guard.canActivate(makeContext(BAD))).rejects.toThrow(
        UnauthorizedException,
      );

      expect(tryBegin).toHaveBeenCalledWith(IP);
      expect(limiter.stats().trackedIps).toBe(1);
    });

    it('invalidar el caché (rotar secret, desactivar...) obliga a verificar de nuevo contra la BD', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub());
      await guard.canActivate(makeContext(GOOD));
      cache.invalidate('hub-A');
      hubRepository.findOne.mockResolvedValue(null); // desactivado

      await expect(guard.canActivate(makeContext(GOOD))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(hubRepository.findOne.mock.calls.length).toBeGreaterThan(1);
    });

    it('sin oráculo de hubId: bajo bloqueo, un hubId existente sin caché y uno inexistente responden igual (429)', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub());
      exhaustIp();

      const existing = await statusOf(guard.canActivate(makeContext(GOOD)));
      const unknown = await statusOf(
        guard.canActivate(
          makeContext({ 'x-hub-id': 'hub-fantasma', 'x-hub-secret': 'x' }),
        ),
      );
      const wrongSecret = await statusOf(guard.canActivate(makeContext(BAD)));

      expect([existing, unknown, wrongSecret]).toEqual([
        HttpStatus.TOO_MANY_REQUESTS,
        HttpStatus.TOO_MANY_REQUESTS,
        HttpStatus.TOO_MANY_REQUESTS,
      ]);
      expect(hubRepository.findOne.mock.calls).toHaveLength(0);
    });

    it('cierra el intento: fail al rechazar, succeed al aceptar (sin intentos colgados)', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub());

      await expect(guard.canActivate(makeContext(BAD))).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(makeContext(GOOD))).resolves.toBe(true);

      expect(limiter.stats()).toEqual({ trackedIps: 1, inFlight: 0 });
    });

    it('ráfaga concurrente de 100 desde una IP: como mucho 3 verificaciones (bcrypt), el resto 429', async () => {
      hubRepository.findOne.mockImplementation(
        () =>
          new Promise<Hub>((resolve) => {
            setTimeout(() => resolve(mockHub()), 20);
          }),
      );

      const results = await Promise.all(
        Array.from({ length: 100 }, () =>
          statusOf(guard.canActivate(makeContext(BAD))),
        ),
      );

      expect(hubRepository.findOne.mock.calls.length).toBeLessThanOrEqual(
        HUB_AUTH_MAX_IN_FLIGHT_PER_IP,
      );
      expect(
        results.filter((code) => code === Number(HttpStatus.TOO_MANY_REQUESTS)),
      ).toHaveLength(100 - hubRepository.findOne.mock.calls.length);
    });

    it('el bloqueo es por IP: otra IP sigue autenticando', async () => {
      exhaustIp();
      hubRepository.findOne.mockResolvedValue(mockHub());

      await expect(
        guard.canActivate(makeContext(GOOD, '198.51.100.7')),
      ).resolves.toBe(true);
    });

    it('si la BD falla, el intento no cuenta como fallo (abort) y el error se propaga', async () => {
      hubRepository.findOne.mockRejectedValue(new Error('ECONNREFUSED'));

      for (let i = 0; i < HUB_AUTH_MAX_FAILURES + 1; i++) {
        await expect(guard.canActivate(makeContext(GOOD))).rejects.toThrow(
          'ECONNREFUSED',
        );
      }

      expect(limiter.stats()).toEqual({ trackedIps: 0, inFlight: 0 });
    });

    it('faltan headers: 401 sin reservar intento (no hubo bcrypt)', async () => {
      const tryBegin = jest.spyOn(limiter, 'tryBegin');

      await expect(
        guard.canActivate(makeContext({ 'x-hub-id': 'hub-A' })),
      ).rejects.toThrow(UnauthorizedException);

      expect(tryBegin).not.toHaveBeenCalled();
    });

    it.each([
      ['demasiado largo', 'h'.repeat(65)],
      ['con caracteres fuera del patrón', 'hub-A; DROP TABLE hubs'],
      ['con salto de línea (log injection)', 'hub-A\nFALSO LOG'],
    ])(
      'hubId %s: 401 genérico sin consultar la BD ni reservar intento',
      async (_case, hubId) => {
        const tryBegin = jest.spyOn(limiter, 'tryBegin');

        const error: unknown = await guard
          .canActivate(makeContext({ 'x-hub-id': hubId, 'x-hub-secret': 'x' }))
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toBe(
          HUB_UNAUTHORIZED_MESSAGE,
        );
        expect(hubRepository.findOne.mock.calls).toHaveLength(0);
        expect(tryBegin).not.toHaveBeenCalled();
      },
    );
  });
});
