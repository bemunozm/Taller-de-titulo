import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DOOR_OPEN_EVENT,
  HUB_WS_UNAUTHORIZED_ERROR,
  HubGateway,
  type HubNamespace,
  type HubSocket,
} from './hub.gateway';
import { Hub, HubType } from './entities/hub.entity';
import { hashPassword } from '../auth/utils/auth.util';
import {
  HUB_AUTH_MAX_FAILURES,
  HUB_AUTH_MAX_IN_FLIGHT_GLOBAL,
  HUB_AUTH_MAX_IN_FLIGHT_PER_IP,
  HubAuthFailureLimiter,
} from './hub-auth-failure-limiter';
import { HubCredentialCache } from './hub-credential-cache';

/**
 * Fase 1, Bloque A1.1 (H1/H2) y Fase 4 · P4 (D6/D7).
 *
 * Cubre:
 *  - H1: el middleware del namespace valida el `hubSecret` contra el
 *    `secretHash` PROPIO del hub ANTES del CONNECT (rechazo con un error
 *    genérico) y deja la identidad (`hubId`, `type`, `organizationId`) en
 *    `socket.data.hub`; `handleConnection` solo registra.
 *  - D7: `sendDoorOpen` solo llega a hubs `physical-hub` (nunca a un
 *    `web-kiosk`, ni por sesión ni por condominio); `sendVisitorResponse` solo
 *    al socket dueño de la sesión, sin caer al condominio.
 *  - Handlers `hub:*` con la identidad del handshake (nunca el `hubId` del
 *    body); reconexión last-wins; desconexión al rotar o desactivar.
 */
describe('HubGateway', () => {
  let gateway: HubGateway;
  let hubRepository: jest.Mocked<Repository<Hub>>;
  let limiter: HubAuthFailureLimiter;
  let cache: HubCredentialCache;
  let middleware: (socket: HubSocket, next: (error?: Error) => void) => void;

  const ORG_A = '11111111-1111-4111-8111-111111111111';
  const ORG_B = '22222222-2222-4222-8222-222222222222';
  const SECRET = 'secret-del-hub';

  let secretHash: string;

  /** Socket de prueba: el MISMO objeto pasa por el middleware y los handlers. */
  interface FakeSocket {
    id: string;
    handshake: {
      auth: Record<string, unknown>;
      address: string;
      headers: Record<string, string>;
    };
    data: { hub?: unknown; authRevocation?: number };
    disconnected: boolean;
    emit: jest.Mock;
    disconnect: jest.Mock;
  }

  function makeSocket(
    id: string,
    auth: Record<string, unknown> = {},
    address = '203.0.113.20',
  ): FakeSocket {
    const socket: FakeSocket = {
      id,
      handshake: { auth, address, headers: {} },
      data: {},
      disconnected: false,
      emit: jest.fn(),
      disconnect: jest.fn(() => {
        socket.disconnected = true;
      }),
    };
    return socket;
  }

  function asHubSocket(socket: FakeSocket): HubSocket {
    return socket as unknown as HubSocket;
  }

  function mockHub(
    hubId: string,
    organizationId: string | null,
    type: HubType = HubType.PHYSICAL_HUB,
    hash: string | null = secretHash,
  ): Hub {
    return {
      id: `uuid-${hubId}`,
      hubId,
      organizationId,
      type,
      secretHash: hash,
      active: true,
    } as Hub;
  }

  /** `mockHub` diferido: las tablas de `it.each` se arman antes del `beforeAll`. */
  function mockHubLater(hubId: string, hash?: string | null): () => Hub {
    return () => mockHub(hubId, ORG_A, HubType.PHYSICAL_HUB, hash);
  }

  /** Corre el middleware de `/hub`: `undefined` si acepta, el error si rechaza. */
  function authenticate(socket: FakeSocket): Promise<Error | undefined> {
    return new Promise((resolve) => {
      middleware(asHubSocket(socket), (error) => resolve(error));
    });
  }

  /** Middleware (antes del CONNECT) + `handleConnection`, como socket.io. */
  async function connectHub(
    hubId: string,
    organizationId: string | null,
    type: HubType = HubType.PHYSICAL_HUB,
    socketId = `sock-${hubId}`,
  ): Promise<FakeSocket> {
    hubRepository.findOne.mockResolvedValueOnce(
      mockHub(hubId, organizationId, type),
    );
    const socket = makeSocket(socketId, { hubId, hubSecret: SECRET });
    const error = await authenticate(socket);
    if (error) {
      throw error;
    }
    gateway.handleConnection(asHubSocket(socket));
    return socket;
  }

  function emittedEvents(socket: FakeSocket): string[] {
    return (socket.emit.mock.calls as unknown[][]).map(
      (call) => call[0] as string,
    );
  }

  beforeAll(async () => {
    secretHash = await hashPassword(SECRET);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubGateway,
        HubAuthFailureLimiter,
        HubCredentialCache,
        {
          provide: getRepositoryToken(Hub),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    gateway = module.get(HubGateway);
    hubRepository = module.get(getRepositoryToken(Hub));
    limiter = module.get(HubAuthFailureLimiter);
    cache = module.get(HubCredentialCache);
    const namespace = {
      use: (fn: typeof middleware) => {
        middleware = fn;
      },
    };
    gateway.afterInit(namespace as unknown as HubNamespace);
  });

  describe('middleware de /hub (H1 — autenticación ANTES del CONNECT)', () => {
    it('acepta un hub con SU propio secret, deja su identidad en socket.data.hub y handleConnection lo registra', async () => {
      hubRepository.findOne.mockResolvedValueOnce(mockHub('hub-A', ORG_A));
      const socket = makeSocket('sock-1', {
        hubId: 'hub-A',
        hubSecret: SECRET,
      });

      await expect(authenticate(socket)).resolves.toBeUndefined();
      expect(socket.data.hub).toEqual({
        hubId: 'hub-A',
        type: HubType.PHYSICAL_HUB,
        organizationId: ORG_A,
      });

      gateway.handleConnection(asHubSocket(socket));

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        'hub:connected',
        expect.objectContaining({ hubId: 'hub-A' }),
      );
      expect(gateway.isHubConnected('hub-A')).toBe(true);
    });

    it('un kiosko web también se registra, con type web-kiosk', async () => {
      const socket = await connectHub('kiosk-A', ORG_A, HubType.WEB_KIOSK);

      expect(socket.data.hub).toEqual(
        expect.objectContaining({ type: HubType.WEB_KIOSK }),
      );
      expect(gateway.getConnectedHubs()).toEqual([
        expect.objectContaining({ hubId: 'kiosk-A', type: HubType.WEB_KIOSK }),
      ]);
    });

    it.each([
      [
        'secret de otro hub (impersonación)',
        { hubId: 'hub-A', hubSecret: 'secret-de-otro-hub' },
        mockHubLater('hub-A'),
      ],
      [
        'hubId desconocido o inactivo',
        { hubId: 'hub-fantasma', hubSecret: 'lo-que-sea' },
        null,
      ],
      [
        'hub sin secretHash provisionado',
        { hubId: 'hub-legacy', hubSecret: 'cualquier-cosa' },
        mockHubLater('hub-legacy', null),
      ],
    ])(
      'RECHAZA %s antes del CONNECT con el mismo error genérico',
      async (_case, auth, storedHub) => {
        hubRepository.findOne.mockResolvedValueOnce(
          storedHub === null ? null : storedHub(),
        );
        const socket = makeSocket('sock-x', auth);

        const error = await authenticate(socket);

        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
        expect(socket.data.hub).toBeUndefined();
        expect(socket.emit).not.toHaveBeenCalled();
        expect(gateway.isHubConnected(String(auth.hubId))).toBe(false);
      },
    );

    it('RECHAZA un handshake sin credenciales (o con tipos inesperados) sin consultar la BD', async () => {
      const socket = makeSocket('sock-5', { hubId: 123, hubSecret: ['x'] });

      const error = await authenticate(socket);

      expect(error?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
      expect(hubRepository.findOne.mock.calls).toHaveLength(0);
    });

    it('si la BD falla, rechaza con el error genérico (sin propagar el detalle)', async () => {
      hubRepository.findOne.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const socket = makeSocket('sock-6', {
        hubId: 'hub-A',
        hubSecret: SECRET,
      });

      const error = await authenticate(socket);

      expect(error?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
    });

    it('respeta las revocaciones: un hub revocado mientras se verificaba su secret se rechaza', async () => {
      let resolveLookup: (hub: Hub) => void = () => undefined;
      hubRepository.findOne.mockImplementationOnce(
        () =>
          new Promise<Hub>((resolve) => {
            resolveLookup = resolve;
          }),
      );
      const socket = makeSocket('sock-carrera', {
        hubId: 'hub-A',
        hubSecret: SECRET,
      });

      const authenticating = authenticate(socket);
      gateway.disconnectHub('hub-A', 'secret rotado');
      resolveLookup(mockHub('hub-A', ORG_A));

      await expect(authenticating).resolves.toEqual(
        new Error(HUB_WS_UNAUTHORIZED_ERROR),
      );
      expect(socket.data.hub).toBeUndefined();
    });

    it('respeta las revocaciones: un hub revocado entre el middleware y el registro no se registra', async () => {
      hubRepository.findOne.mockResolvedValueOnce(mockHub('hub-A', ORG_A));
      const socket = makeSocket('sock-1', {
        hubId: 'hub-A',
        hubSecret: SECRET,
      });
      await expect(authenticate(socket)).resolves.toBeUndefined();

      gateway.disconnectHub('hub-A', 'hub desactivado');
      gateway.handleConnection(asHubSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(gateway.isHubConnected('hub-A')).toBe(false);
      expect(emittedEvents(socket)).not.toContain('hub:connected');
    });

    it('handleConnection sin identidad del middleware (no debería pasar): desconecta', () => {
      const socket = makeSocket('sock-sin-identidad');

      gateway.handleConnection(asHubSocket(socket));

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(gateway.getConnectedHubs()).toEqual([]);
    });
  });

  /**
   * Fase 4 · P4.B (D9, cyber M1/M2/N1/B7): caché de credenciales verificadas
   * antes del limitador (el mismo que `HubAuthGuard`); el intento con bcrypt
   * se reserva antes de verificarse. Respuesta genérica.
   */
  describe('middleware de /hub: caché de credenciales y límite de intentos', () => {
    const IP = '203.0.113.20';
    const BAD_AUTH = { hubId: 'hub-A', hubSecret: 'secret-incorrecto' };
    const GOOD_AUTH = { hubId: 'hub-A', hubSecret: SECRET };

    function exhaustIp(ip: string = IP): void {
      for (let i = 0; i < HUB_AUTH_MAX_FAILURES; i++) {
        const reservation = limiter.tryBegin(ip);
        if (reservation.ok) {
          reservation.attempt.fail();
        }
      }
    }

    afterEach(() => {
      limiter.onModuleDestroy();
      cache.onModuleDestroy();
    });

    it('IP bloqueada y hub sin credencial cacheada: error genérico SIN consultar la BD (sin bcrypt)', async () => {
      exhaustIp();
      hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A));
      const socket = makeSocket('good-1', GOOD_AUTH);

      const error = await authenticate(socket);

      expect(error?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
      expect(hubRepository.findOne.mock.calls).toHaveLength(0);
      expect(socket.data.hub).toBeUndefined();
    });

    it('el hub legítimo (cacheado) reconecta con su IP bloqueada y bajo una ráfaga global, sin BD', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A));
      await expect(
        authenticate(makeSocket('primera', GOOD_AUTH)),
      ).resolves.toBeUndefined();
      exhaustIp();
      for (let i = 0; i < HUB_AUTH_MAX_IN_FLIGHT_GLOBAL; i++) {
        limiter.tryBegin(`198.51.100.${i + 1}`);
      }
      hubRepository.findOne.mockClear();

      const socket = makeSocket('reconexion', GOOD_AUTH);
      await expect(authenticate(socket)).resolves.toBeUndefined();

      expect(hubRepository.findOne.mock.calls).toHaveLength(0);
      expect(socket.data.hub).toEqual({
        hubId: 'hub-A',
        type: HubType.PHYSICAL_HUB,
        organizationId: ORG_A,
      });
    });

    it('un secret incorrecto para un hubId cacheado no autentica y cuenta como fallo', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A));
      await authenticate(makeSocket('primera', GOOD_AUTH));

      const error = await authenticate(makeSocket('mala', BAD_AUTH));

      expect(error?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
      expect(limiter.stats().trackedIps).toBe(1);
    });

    it.each([
      ['secret rotado', 'secret rotado'],
      ['hub desactivado', 'hub desactivado'],
      ['tipo cambiado', 'tipo cambiado (physical-hub -> web-kiosk)'],
      ['condominio cambiado', 'condominio cambiado'],
    ])(
      'disconnectHub (%s) invalida la credencial cacheada',
      async (_case, reason) => {
        hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A));
        await authenticate(makeSocket('primera', GOOD_AUTH));
        expect(cache.size()).toBe(1);

        gateway.disconnectHub('hub-A', reason);

        expect(cache.size()).toBe(0);
        hubRepository.findOne.mockClear();
        await authenticate(makeSocket('reconexion', GOOD_AUTH));
        expect(hubRepository.findOne.mock.calls).toHaveLength(1);
      },
    );

    it('sin oráculo de hubId: bajo bloqueo, un hubId existente sin caché y uno inexistente reciben el mismo error', async () => {
      exhaustIp();
      hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A));

      const existing = await authenticate(makeSocket('a', GOOD_AUTH));
      const unknown = await authenticate(
        makeSocket('b', { hubId: 'hub-fantasma', hubSecret: 'x' }),
      );

      expect(existing?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
      expect(unknown?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
      expect(hubRepository.findOne.mock.calls).toHaveLength(0);
    });

    it('ráfaga concurrente de 100 handshakes desde una IP: como mucho 3 bcrypt', async () => {
      hubRepository.findOne.mockImplementation(
        () =>
          new Promise<Hub>((resolve) => {
            setTimeout(() => resolve(mockHub('hub-A', ORG_A)), 20);
          }),
      );

      const errors = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          authenticate(makeSocket(`rafaga-${i}`, BAD_AUTH)),
        ),
      );

      expect(
        errors.every((e) => e?.message === HUB_WS_UNAUTHORIZED_ERROR),
      ).toBe(true);
      expect(hubRepository.findOne.mock.calls.length).toBeLessThanOrEqual(
        HUB_AUTH_MAX_IN_FLIGHT_PER_IP,
      );
    });

    it('el bloqueo es por IP: un handshake desde otra IP sigue autenticando', async () => {
      exhaustIp();
      hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A));

      await expect(
        authenticate(makeSocket('otra-ip', GOOD_AUTH, '198.51.100.9')),
      ).resolves.toBeUndefined();
    });

    it('un handshake sin credenciales no reserva intento (no hubo bcrypt)', async () => {
      const tryBegin = jest.spyOn(limiter, 'tryBegin');

      await authenticate(makeSocket('sin-credenciales', {}));

      expect(tryBegin).not.toHaveBeenCalled();
    });

    it.each([
      ['demasiado largo', 'h'.repeat(65)],
      ['con caracteres fuera del patrón', 'hub A/../x'],
    ])(
      'hubId %s: unauthorized genérico sin consultar la BD',
      async (_case, hubId) => {
        const error = await authenticate(
          makeSocket('hubid-invalido', { hubId, hubSecret: SECRET }),
        );

        expect(error?.message).toBe(HUB_WS_UNAUTHORIZED_ERROR);
        expect(hubRepository.findOne.mock.calls).toHaveLength(0);
      },
    );

    it('una revocación durante el handshake no cuenta como fallo ni deja la credencial en caché', async () => {
      let resolveLookup: (hub: Hub) => void = () => undefined;
      hubRepository.findOne.mockImplementationOnce(
        () =>
          new Promise<Hub>((resolve) => {
            resolveLookup = resolve;
          }),
      );

      const authenticating = authenticate(makeSocket('carrera', GOOD_AUTH));
      gateway.disconnectHub('hub-A', 'secret rotado');
      resolveLookup(mockHub('hub-A', ORG_A));
      await authenticating;

      expect(limiter.stats()).toEqual({ inFlight: 0, trackedIps: 0 });
      expect(cache.size()).toBe(0);
    });
  });

  describe('reconexión con el mismo hubId (last-wins)', () => {
    it('desconecta el socket anterior y deja registrado el nuevo', async () => {
      const oldSocket = await connectHub(
        'hub-A',
        ORG_A,
        HubType.PHYSICAL_HUB,
        'sock-old',
      );
      const newSocket = await connectHub(
        'hub-A',
        ORG_A,
        HubType.PHYSICAL_HUB,
        'sock-new',
      );

      expect(oldSocket.disconnect).toHaveBeenCalled();
      expect(newSocket.disconnect).not.toHaveBeenCalled();

      gateway.sendDoorOpen(
        { hubId: 'hub-A', organizationId: ORG_A },
        { type: 'pedestrian' },
      );
      expect(emittedEvents(newSocket)).toContain(DOOR_OPEN_EVENT);
      expect(emittedEvents(oldSocket)).not.toContain(DOOR_OPEN_EVENT);
    });

    it('la desconexión del socket anterior NO borra la entrada del socket nuevo', async () => {
      const oldSocket = await connectHub(
        'hub-A',
        ORG_A,
        HubType.PHYSICAL_HUB,
        'sock-old',
      );
      await connectHub('hub-A', ORG_A, HubType.PHYSICAL_HUB, 'sock-new');

      gateway.handleDisconnect(asHubSocket(oldSocket));

      expect(gateway.isHubConnected('hub-A')).toBe(true);
    });

    it('la desconexión del socket vigente sí borra la entrada', async () => {
      const socket = await connectHub('hub-A', ORG_A);

      gateway.handleDisconnect(asHubSocket(socket));

      expect(gateway.isHubConnected('hub-A')).toBe(false);
    });

    it('un socket que se desconectó entre el middleware y el registro no se registra', async () => {
      hubRepository.findOne.mockResolvedValueOnce(mockHub('hub-A', ORG_A));
      const socket = makeSocket('sock-ido', {
        hubId: 'hub-A',
        hubSecret: SECRET,
      });
      await authenticate(socket);
      socket.disconnected = true;

      gateway.handleConnection(asHubSocket(socket));

      expect(gateway.isHubConnected('hub-A')).toBe(false);
    });
  });

  describe('sendDoorOpen (D7 — solo hubs físicos)', () => {
    it('va al hub FÍSICO de la sesión cuando está conectado (y a ningún otro)', async () => {
      const own = await connectHub('hub-A1', ORG_A);
      const other = await connectHub('hub-A2', ORG_A);

      const delivered = gateway.sendDoorOpen(
        { hubId: 'hub-A1', organizationId: ORG_A },
        { type: 'vehicular', visitId: 'visit-1' },
      );

      expect(delivered).toBe(1);
      expect(own.emit).toHaveBeenCalledWith(DOOR_OPEN_EVENT, {
        type: 'vehicular',
        visitId: 'visit-1',
      });
      expect(emittedEvents(other)).not.toContain(DOOR_OPEN_EVENT);
    });

    it('sesión de un KIOSKO: nunca al kiosko; va a los hubs físicos del condominio', async () => {
      const kiosk = await connectHub('kiosk-A', ORG_A, HubType.WEB_KIOSK);
      const physical1 = await connectHub('hub-A1', ORG_A);
      const physical2 = await connectHub('hub-A2', ORG_A);
      const otherOrg = await connectHub('hub-B', ORG_B);

      const delivered = gateway.sendDoorOpen(
        { hubId: 'kiosk-A', organizationId: ORG_A },
        { type: 'pedestrian' },
      );

      expect(delivered).toBe(2);
      expect(emittedEvents(kiosk)).not.toContain(DOOR_OPEN_EVENT);
      expect(emittedEvents(physical1)).toContain(DOOR_OPEN_EVENT);
      expect(emittedEvents(physical2)).toContain(DOOR_OPEN_EVENT);
      expect(emittedEvents(otherOrg)).not.toContain(DOOR_OPEN_EVENT);
    });

    it('por condominio (sin hub de sesión, p. ej. LPR): solo a los físicos, nunca a un kiosko', async () => {
      const kiosk = await connectHub('kiosk-A', ORG_A, HubType.WEB_KIOSK);
      const physical = await connectHub('hub-A', ORG_A);

      const delivered = gateway.sendDoorOpen(
        { hubId: null, organizationId: ORG_A },
        { type: 'vehicular', plate: 'BBCD12' },
      );

      expect(delivered).toBe(1);
      expect(physical.emit).toHaveBeenCalledWith(DOOR_OPEN_EVENT, {
        type: 'vehicular',
        plate: 'BBCD12',
      });
      expect(emittedEvents(kiosk)).not.toContain(DOOR_OPEN_EVENT);
    });

    it('hub de la sesión desconectado: cae a los físicos del condominio', async () => {
      const fallback = await connectHub('hub-A2', ORG_A);

      const delivered = gateway.sendDoorOpen(
        { hubId: 'hub-desconectado', organizationId: ORG_A },
        { type: 'vehicular' },
      );

      expect(delivered).toBe(1);
      expect(emittedEvents(fallback)).toContain(DOOR_OPEN_EVENT);
    });

    it('hub de la sesión de OTRO condominio: no lo usa (va a los físicos del condominio de la sesión)', async () => {
      const foreign = await connectHub('hub-B', ORG_B);
      const own = await connectHub('hub-A', ORG_A);

      gateway.sendDoorOpen(
        { hubId: 'hub-B', organizationId: ORG_A },
        { type: 'pedestrian' },
      );

      expect(emittedEvents(foreign)).not.toContain(DOOR_OPEN_EVENT);
      expect(emittedEvents(own)).toContain(DOOR_OPEN_EVENT);
    });

    it('solo kioskos conectados en el condominio: no-op (0), no entrega a nadie', async () => {
      const kiosk = await connectHub('kiosk-A', ORG_A, HubType.WEB_KIOSK);

      const delivered = gateway.sendDoorOpen(
        { hubId: null, organizationId: ORG_A },
        { type: 'pedestrian' },
      );

      expect(delivered).toBe(0);
      expect(emittedEvents(kiosk)).not.toContain(DOOR_OPEN_EVENT);
    });

    it('condominio nulo: no-op (0), aunque haya hubs físicos sin condominio conectados', async () => {
      const orphan = await connectHub('hub-null', null);

      const delivered = gateway.sendDoorOpen(
        { hubId: 'hub-null', organizationId: null },
        { type: 'vehicular' },
      );

      expect(delivered).toBe(0);
      expect(emittedEvents(orphan)).not.toContain(DOOR_OPEN_EVENT);
    });
  });

  describe('sendVisitorResponse (D7 — solo al dueño de la sesión)', () => {
    const PAYLOAD = {
      approved: true,
      entryRegistered: true,
      timestamp: new Date('2026-10-08T12:00:00Z'),
    };

    it('entrega visitor:response:<sessionId> SOLO al socket dueño (también a un kiosko)', async () => {
      const kiosk = await connectHub('kiosk-A', ORG_A, HubType.WEB_KIOSK);
      const otherKiosk = await connectHub('kiosk-A2', ORG_A, HubType.WEB_KIOSK);
      const physical = await connectHub('hub-A', ORG_A);

      const delivered = gateway.sendVisitorResponse(
        { sessionId: 'sess-1', hubId: 'kiosk-A', organizationId: ORG_A },
        PAYLOAD,
      );

      expect(delivered).toBe(true);
      expect(kiosk.emit).toHaveBeenCalledWith('visitor:response:sess-1', {
        ...PAYLOAD,
        sessionId: 'sess-1',
      });
      expect(emittedEvents(otherKiosk)).not.toContain(
        'visitor:response:sess-1',
      );
      expect(emittedEvents(physical)).not.toContain('visitor:response:sess-1');
    });

    it('dueño no conectado: no cae al condominio (no-op)', async () => {
      const sameOrg = await connectHub('hub-A', ORG_A);

      const delivered = gateway.sendVisitorResponse(
        {
          sessionId: 'sess-1',
          hubId: 'kiosk-desconectado',
          organizationId: ORG_A,
        },
        PAYLOAD,
      );

      expect(delivered).toBe(false);
      expect(emittedEvents(sameOrg)).not.toContain('visitor:response:sess-1');
    });

    it('sesión sin hub dueño (web): no-op, sin broadcast por condominio', async () => {
      const sameOrg = await connectHub('hub-A', ORG_A);

      const delivered = gateway.sendVisitorResponse(
        { sessionId: 'sess-1', hubId: null, organizationId: ORG_A },
        PAYLOAD,
      );

      expect(delivered).toBe(false);
      expect(emittedEvents(sameOrg)).not.toContain('visitor:response:sess-1');
    });

    it('el hub dueño ya no es del condominio de la sesión: no-op', async () => {
      const moved = await connectHub('hub-A', ORG_B);

      const delivered = gateway.sendVisitorResponse(
        { sessionId: 'sess-1', hubId: 'hub-A', organizationId: ORG_A },
        PAYLOAD,
      );

      expect(delivered).toBe(false);
      expect(emittedEvents(moved)).not.toContain('visitor:response:sess-1');
    });
  });

  describe('handlers hub:* (identidad del handshake, nunca la del body)', () => {
    it('hub:heartbeat actualiza el lastSeen del hub del SOCKET aunque el body diga otro hubId', async () => {
      const socketA = await connectHub('hub-A', ORG_A);
      await connectHub('hub-B', ORG_B);
      const lastSeenOf = (hubId: string): Date | undefined =>
        gateway.getConnectedHubs().find((hub) => hub.hubId === hubId)?.lastSeen;
      const lastSeenB = lastSeenOf('hub-B');
      jest.useFakeTimers().setSystemTime(Date.now() + 60_000);

      try {
        const result = gateway.handleHeartbeat(asHubSocket(socketA), {
          hubId: 'hub-B',
          uptime: 1000,
        });

        expect(result.success).toBe(true);
        expect(lastSeenOf('hub-B')).toEqual(lastSeenB);
        expect(lastSeenOf('hub-A')?.getTime()).toBeGreaterThan(
          lastSeenB?.getTime() ?? 0,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('P6.R: hub:heartbeat de un socket registrado renueva SU credencial en el caché (touch)', async () => {
      await connectHub('hub-B', ORG_B);
      const socketA = await connectHub('hub-A', ORG_A);
      const touch = jest.spyOn(cache, 'touch');

      gateway.handleHeartbeat(asHubSocket(socketA), { hubId: 'hub-B' });

      expect(touch).toHaveBeenCalledTimes(1);
      expect(touch).toHaveBeenCalledWith('hub-A');
    });

    it('P6.R: el heartbeat mantiene la credencial más allá de los 10 min sin requests', async () => {
      jest.useFakeTimers({ now: Date.now() });
      try {
        const socket = await connectHub('hub-A', ORG_A);
        // Verificada en el handshake (bcrypt): queda cacheada.
        expect(cache.lookup('hub-A', SECRET)).not.toBeNull();

        for (let i = 0; i < 40; i++) {
          jest.advanceTimersByTime(30_000); // 20 min en total
          gateway.handleHeartbeat(asHubSocket(socket), {});
        }

        expect(cache.lookup('hub-A', SECRET)).not.toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('P6.R: el heartbeat de un socket NO registrado no toca el caché', () => {
      const touch = jest.spyOn(cache, 'touch');

      gateway.handleHeartbeat(asHubSocket(makeSocket('sock-intruso')), {
        hubId: 'hub-A',
      });

      expect(touch).not.toHaveBeenCalled();
    });

    it.each([
      ['hub:keypad', 'handleKeypadInput'],
      ['hub:stateChanged', 'handleStateChange'],
      ['hub:error', 'handleError'],
      ['hub:heartbeat', 'handleHeartbeat'],
    ] as const)(
      '%s desde un socket no registrado se ignora (success: false)',
      (_event, handler) => {
        const intruder = makeSocket('sock-intruso');

        const result = gateway[handler](asHubSocket(intruder), {
          hubId: 'hub-A',
        });

        expect(result.success).toBe(false);
      },
    );

    it('un socket reemplazado por una reconexión ya no es aceptado por los handlers', async () => {
      const oldSocket = await connectHub(
        'hub-A',
        ORG_A,
        HubType.PHYSICAL_HUB,
        'sock-old',
      );
      await connectHub('hub-A', ORG_A, HubType.PHYSICAL_HUB, 'sock-new');

      const result = gateway.handleKeypadInput(asHubSocket(oldSocket), {
        houseNumber: '504',
      });

      expect(result.success).toBe(false);
    });

    it('hub:keypad desde el socket registrado se acepta', async () => {
      const socket = await connectHub('hub-A', ORG_A);

      const result = gateway.handleKeypadInput(asHubSocket(socket), {
        hubId: 'hub-B',
        houseNumber: '504',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('disconnectHub (rotar secret / desactivar)', () => {
    it('corta el socket conectado y lo saca del mapa', async () => {
      const socket = await connectHub('hub-A', ORG_A);

      expect(gateway.disconnectHub('hub-A', 'secret rotado')).toBe(true);

      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(gateway.isHubConnected('hub-A')).toBe(false);
      expect(
        gateway.sendDoorOpen(
          { hubId: 'hub-A', organizationId: ORG_A },
          { type: 'vehicular' },
        ),
      ).toBe(0);
    });

    it('sin socket conectado: no hace nada (false)', () => {
      expect(gateway.disconnectHub('hub-A', 'hub desactivado')).toBe(false);
    });

    it('tras revocar, el hub puede volver a autenticarse (la revocación no lo bloquea para siempre)', async () => {
      await connectHub('hub-A', ORG_A, HubType.PHYSICAL_HUB, 'sock-viejo');
      gateway.disconnectHub('hub-A', 'secret rotado');

      const socket = await connectHub(
        'hub-A',
        ORG_A,
        HubType.PHYSICAL_HUB,
        'sock-nuevo',
      );

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(gateway.isHubConnected('hub-A')).toBe(true);
    });
  });
});
