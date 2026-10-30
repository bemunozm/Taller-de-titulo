import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DataSource, type Repository } from 'typeorm';
import {
  NotificationsGateway,
  REALTIME_UNAUTHORIZED_ERROR,
  SESSION_ENDED_EVENT,
  SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
  SOCKET_SESSION_REVALIDATION_RETRY_MS,
  organizationSecurityRoom,
  roomsFor,
  securityRoomFor,
  sessionRoom,
  userRoom,
  type RealtimeSocket,
  type RealtimeUserIdentity,
} from './notifications.gateway';
import {
  BetterAuthSessionResolver,
  type ResolvedBetterAuthSession,
} from '../auth/better-auth-session.resolver';
import { notifySessionDeleted } from '../auth/session-ended-events';
import { VigiliaIoAdapter } from '../common/websocket/vigilia-io.adapter';
import { PLATFORM_SUPER_ADMIN_ROLE } from '../common/tenant/tenant-context.types';
import { User } from '../users/entities/user.entity';
import {
  ANOMALY_HIGHLIGHT_EVENT,
  ANOMALY_UPDATED_EVENT,
  AnomaliesService,
} from '../anomalies/anomalies.service';
import type { AnomalyEvent } from '../anomalies/entities/anomaly-event.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { VisionAnalysisService } from '../anomalies/services/vision-analysis.service';
import {
  RawSocketIoClient,
  type NamespaceConnectResult,
} from '../test-utils/socket-io-raw-client';

const FRONTEND_ORIGIN = 'http://localhost:5173';
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COOKIE_NAME = 'vigilia_test_session';
const SNAPSHOT_B64 = 'aGVsbG8tZm90by1kZWwtcGF0aW8=';

const SECURITY_PERMISSIONS = ['detections.read', 'condominium.view-all'];

interface TestUser {
  id: string;
  roles: Array<{ name: string; permissions: Array<{ name: string }> }>;
  family: null;
}

function makeUser(
  id: string,
  permissions: string[],
  roleName = 'Rol de prueba',
): TestUser {
  return {
    id,
    roles: [
      { name: roleName, permissions: permissions.map((name) => ({ name })) },
    ],
    family: null,
  };
}

/** Conserje/Administrador de A y de B, residente de A y la plataforma. */
const USERS: Record<string, TestUser> = {
  'conserje-a': makeUser('conserje-a', SECURITY_PERMISSIONS),
  'conserje-b': makeUser('conserje-b', SECURITY_PERMISSIONS),
  'residente-a': makeUser('residente-a', ['detections.read', 'visits.read']),
  'super-admin': makeUser(
    'super-admin',
    SECURITY_PERMISSIONS,
    PLATFORM_SUPER_ADMIN_ROLE,
  ),
};

const MEMBERSHIPS: Record<string, string> = {
  'conserje-a': ORG_A,
  'residente-a': ORG_A,
  'conserje-b': ORG_B,
};

/**
 * Fase 4 · P6.R (D13): namespace `/` autenticado contra un servidor REAL
 * (socket.io + `VigiliaIoAdapter`, puerto efímero), con el
 * `BetterAuthSessionResolver` real sobre un better-auth simulado (cookie
 * `vigilia_test_session=<sessionId>`).
 */
describe('NotificationsGateway — namespace / autenticado (servidor real)', () => {
  let app: INestApplication | undefined;
  let gateway: NotificationsGateway;
  let port: number;
  let sessions: Map<string, { userId: string; expiresAt: Date }>;
  let getSession: jest.Mock;
  let sessionCounter = 0;
  const openClients: RawSocketIoClient[] = [];

  function newSession(userId: string, ttlMs = 3_600_000): string {
    sessionCounter += 1;
    const sessionId = `sess-${userId}-${sessionCounter}`;
    sessions.set(sessionId, {
      userId,
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return sessionId;
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    sessions = new Map();
    getSession = jest.fn(({ headers }: { headers: Headers }) => {
      const match = new RegExp(`${COOKIE_NAME}=([\\w-]+)`).exec(
        headers.get('cookie') ?? '',
      );
      const session = match ? sessions.get(match[1]) : undefined;
      if (!match || !session || session.expiresAt.getTime() <= Date.now()) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        user: { id: session.userId },
        session: { id: match[1], expiresAt: session.expiresAt },
      });
    });
    const userRepository = {
      findOne: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(USERS[where.id] ?? null),
      ),
    };
    const dataSource = {
      query: jest.fn((sql: string, params: string[]) => {
        if (sql.includes('FROM member')) {
          const organizationId = MEMBERSHIPS[params[0]];
          return Promise.resolve(organizationId ? [{ organizationId }] : []);
        }
        return Promise.resolve([]);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        BetterAuthSessionResolver,
        { provide: BetterAuthService, useValue: { api: { getSession } } },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new VigiliaIoAdapter(app, [FRONTEND_ORIGIN]));
    await app.listen(0, '127.0.0.1');
    const httpServer = app.getHttpServer() as HttpServer;
    port = (httpServer.address() as AddressInfo).port;
    gateway = app.get(NotificationsGateway);
  });

  afterEach(() => {
    for (const client of openClients.splice(0)) {
      client.close();
    }
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  /** Abre la conexión (Origin del frontend) y hace el CONNECT a `/`. */
  async function connect(
    sessionId?: string,
  ): Promise<{ client: RawSocketIoClient; result: NamespaceConnectResult }> {
    const opened = await RawSocketIoClient.open(port, {
      origin: FRONTEND_ORIGIN,
      cookie: sessionId ? `${COOKIE_NAME}=${sessionId}` : undefined,
    });
    if (!opened.ok) {
      throw new Error(`Upgrade rechazado (${opened.status})`);
    }
    openClients.push(opened.client);
    const result = await opened.client.connectNamespace('/');
    return { client: opened.client, result };
  }

  async function connectAs(
    userId: string,
    ttlMs?: number,
  ): Promise<{ client: RawSocketIoClient; sessionId: string; sid: string }> {
    const sessionId = newSession(userId, ttlMs);
    const { client, result } = await connect(sessionId);
    if (!result.ok) {
      throw new Error(`CONNECT rechazado: ${result.message}`);
    }
    return { client, sessionId, sid: result.sid };
  }

  async function serverSocket(sid: string) {
    const sockets = await gateway.server.fetchSockets();
    const socket = sockets.find((candidate) => candidate.id === sid);
    if (!socket) {
      throw new Error(`Socket ${sid} no encontrado en el servidor`);
    }
    return socket;
  }

  /**
   * Punto de sincronización: un evento al usuario que llega DESPUÉS de todo lo
   * emitido antes por la misma conexión (orden garantizado por socket).
   */
  async function flushTo(client: RawSocketIoClient, userId: string) {
    const marker = `test:sentinel:${Math.random()}`;
    gateway.sendToUser(userId, marker, {});
    await client.waitForEvent(marker);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  describe('handshake (middleware antes del CONNECT)', () => {
    it('sin cookie -> connect_error "unauthorized"', async () => {
      const { result } = await connect(undefined);
      expect(result).toEqual({
        ok: false,
        message: REALTIME_UNAUTHORIZED_ERROR,
      });
    });

    it('cookie de una sesión inexistente o vencida -> "unauthorized"', async () => {
      const expired = newSession('conserje-a', -1_000);
      for (const sessionId of ['sess-que-no-existe', expired]) {
        const { result } = await connect(sessionId);
        expect(result).toEqual({
          ok: false,
          message: REALTIME_UNAUTHORIZED_ERROR,
        });
      }
    });

    it('usuario deshabilitado (no lo carga el repositorio) -> "unauthorized"', async () => {
      const sessionId = newSession('usuario-deshabilitado');
      const { result } = await connect(sessionId);
      expect(result).toEqual(expect.objectContaining({ ok: false }));
    });

    it('con sesión: socket.data.user lo arma el servidor y lee la sesión SIN extenderla', async () => {
      getSession.mockClear();
      const { sid, sessionId } = await connectAs('conserje-a');

      const socket = await serverSocket(sid);
      expect(socket.data.user).toEqual({
        userId: 'conserje-a',
        organizationId: ORG_A,
        isSuperAdmin: false,
        permissionNames: SECURITY_PERMISSIONS,
        sessionId,
        sessionExpiresAt: sessions.get(sessionId)?.expiresAt,
      });
      expect(getSession).toHaveBeenCalledWith(
        expect.objectContaining({ query: { disableRefresh: true } }),
      );
    });
  });

  describe('salas asignadas por el servidor', () => {
    it('conserje: user:<id>, session:<id> y org:<A>:security', async () => {
      const { sid, sessionId } = await connectAs('conserje-a');

      const socket = await serverSocket(sid);
      expect([...socket.rooms].sort()).toEqual(
        [
          sid,
          userRoom('conserje-a'),
          sessionRoom(sessionId),
          organizationSecurityRoom(ORG_A),
        ].sort(),
      );
    });

    it('residente (detections.read sin condominium.view-all): sin sala de seguridad', async () => {
      const { sid } = await connectAs('residente-a');

      const socket = await serverSocket(sid);
      expect([...socket.rooms].some((room) => room.startsWith('org:'))).toBe(
        false,
      );
    });

    it('super-admin: ninguna sala de seguridad (ni de plataforma)', async () => {
      const { sid, sessionId } = await connectAs('super-admin');

      const socket = await serverSocket(sid);
      expect(socket.data.user?.isSuperAdmin).toBe(true);
      expect([...socket.rooms].sort()).toEqual(
        [sid, userRoom('super-admin'), sessionRoom(sessionId)].sort(),
      );
    });

    it('register / join_room / leave_room ya no existen: emitirlos no une a nada', async () => {
      const resident = await connectAs('residente-a');
      const roomsBefore = [...(await serverSocket(resident.sid)).rooms].sort();

      resident.client.emit('join_room', {
        room: organizationSecurityRoom(ORG_A),
      });
      resident.client.emit('join_room', { room: 'conserje_room' });
      resident.client.emit('register', { userId: 'conserje-a' });
      resident.client.emit('leave_room', { room: userRoom('residente-a') });
      await sleep(150);

      expect([...(await serverSocket(resident.sid)).rooms].sort()).toEqual(
        roomsBefore,
      );
      gateway.sendToOrganizationSecurity(ORG_A, 'test:security', {});
      gateway.sendToUser('conserje-a', 'test:to-conserje', {});
      await flushTo(resident.client, 'residente-a');
      expect(resident.client.eventsNamed('test:security')).toEqual([]);
      expect(resident.client.eventsNamed('test:to-conserje')).toEqual([]);
    });
  });

  it('sendToUser llega a TODOS los sockets del usuario y a nadie más', async () => {
    const first = await connectAs('conserje-a');
    const second = await connectAs('conserje-a');
    const other = await connectAs('conserje-b');

    gateway.sendToUser('conserje-a', 'notification', { title: 'Hola' });

    await expect(first.client.waitForEvent('notification')).resolves.toEqual({
      title: 'Hola',
    });
    await expect(second.client.waitForEvent('notification')).resolves.toEqual({
      title: 'Hola',
    });
    await flushTo(other.client, 'conserje-b');
    expect(other.client.eventsNamed('notification')).toEqual([]);
  });

  describe('anomalías (security:anomaly_highlight por condominio, sin imagen)', () => {
    function anomaliesService(): AnomaliesService {
      return new AnomaliesService(
        {
          create: (data: Partial<AnomalyEvent>) => data,
          save: (data: Partial<AnomalyEvent>) =>
            Promise.resolve({
              ...data,
              id: 'anomaly-1',
              timestamp: new Date('2026-10-09T12:00:00.000Z'),
            }),
          update: () => Promise.resolve({ affected: 1 }),
          findOne: () =>
            Promise.resolve({
              id: 'anomaly-1',
              suspicionLevel: 'HIGH',
              aiReasoning: 'Persona merodeando el portón',
              aiFalsePositive: false,
              aiStatus: 'done',
              status: 'open',
            }),
        } as unknown as Repository<AnomalyEvent>,
        {
          findOne: () =>
            Promise.resolve({
              id: CAM_A,
              name: 'Portón principal',
              organizationId: ORG_A,
              mountPath: 'porton',
            }),
        } as unknown as Repository<Camera>,
        {
          isAvailable: () => true,
          analyzeAnomaly: () =>
            Promise.resolve({
              suspicionLevel: 'HIGH',
              reasoning: 'Persona merodeando el portón',
              isFalsePositive: false,
            }),
        } as unknown as VisionAnalysisService,
        gateway,
      );
    }

    it('solo el feed de seguridad del condominio de la cámara; payload exacto y sin foto', async () => {
      const conserjeA = await connectAs('conserje-a');
      const residenteA = await connectAs('residente-a');
      const conserjeB = await connectAs('conserje-b');
      const superAdmin = await connectAs('super-admin');

      await anomaliesService().createAnomaly(
        {
          cameraId: 'porton_guardia',
          anomalyType: 'loitering',
          confidence: 0.92,
          meta: { snapshot_jpeg_b64: SNAPSHOT_B64, duration_seconds: 40 },
        },
        ORG_A,
      );

      const highlight = await conserjeA.client.waitForEvent(
        ANOMALY_HIGHLIGHT_EVENT,
      );
      expect(highlight).toEqual({
        anomalyId: 'anomaly-1',
        cameraId: CAM_A,
        cameraName: 'Portón principal',
        type: 'loitering',
        severity: 'MEDIUM',
        reasoning: 'Sin evaluación de IA',
        timestamp: '2026-10-09T12:00:00.000Z',
        aiStatus: 'pending',
        status: 'open',
      });
      expect(JSON.stringify(highlight)).not.toContain(SNAPSHOT_B64);

      // El resultado de la IA llega después, por el mismo feed y sin foto.
      const updated = await conserjeA.client.waitForEvent(ANOMALY_UPDATED_EVENT);
      expect(updated).toEqual({
        anomalyId: 'anomaly-1',
        aiStatus: 'done',
        severity: 'HIGH',
        reasoning: 'Persona merodeando el portón',
        aiFalsePositive: false,
        status: 'open',
      });
      expect(JSON.stringify(updated)).not.toContain(SNAPSHOT_B64);

      for (const [viewer, userId] of [
        [residenteA, 'residente-a'],
        [conserjeB, 'conserje-b'],
        [superAdmin, 'super-admin'],
      ] as const) {
        await flushTo(viewer.client, userId);
        expect(viewer.client.eventsNamed(ANOMALY_HIGHLIGHT_EVENT)).toEqual([]);
        expect(viewer.client.eventsNamed(ANOMALY_UPDATED_EVENT)).toEqual([]);
        expect(viewer.client.eventsNamed('security:anomaly_detected')).toEqual(
          [],
        );
      }
      expect(conserjeA.client.eventsNamed('security:anomaly_detected')).toEqual(
        [],
      );
    });
  });

  describe('corte de sockets al terminar la sesión', () => {
    it('logout (hook de borrado de sesión): session:ended { logout } y se corta; la otra sesión del usuario sigue', async () => {
      const laptop = await connectAs('conserje-a');
      const phone = await connectAs('conserje-a');

      notifySessionDeleted(
        {
          id: laptop.sessionId,
          userId: 'conserje-a',
          expiresAt: sessions.get(laptop.sessionId)?.expiresAt,
        },
        { path: '/sign-out' },
      );

      await expect(
        laptop.client.waitForEvent(SESSION_ENDED_EVENT),
      ).resolves.toEqual({ reason: 'logout' });
      await laptop.client.waitForClose();
      expect(laptop.client.disconnectedNamespaces).toContain('/');

      await flushTo(phone.client, 'conserje-a');
      expect(phone.client.isClosed).toBe(false);
      expect(phone.client.eventsNamed(SESSION_ENDED_EVENT)).toEqual([]);
    });

    it('revocación (cambio de contraseña, revocar sesiones): session:ended { revoked }', async () => {
      const socket = await connectAs('residente-a');

      notifySessionDeleted(
        {
          id: socket.sessionId,
          userId: 'residente-a',
          expiresAt: sessions.get(socket.sessionId)?.expiresAt,
        },
        { path: '/change-password' },
      );

      await expect(
        socket.client.waitForEvent(SESSION_ENDED_EVENT),
      ).resolves.toEqual({ reason: 'revoked' });
      await socket.client.waitForClose();
    });

    it('expiración: el timer revalida al vencer y corta con session:ended { expired }', async () => {
      const socket = await connectAs('conserje-a', 700);

      await expect(
        socket.client.waitForEvent(SESSION_ENDED_EVENT, 3_000),
      ).resolves.toEqual({ reason: 'expired' });
      await socket.client.waitForClose(3_000);
    });

    it('una sesión que terminó mientras se autenticaba el handshake no conecta', async () => {
      const sessionId = newSession('conserje-a');
      // better-auth ya la borró (hook) pero la lectura del handshake aún la
      // ve (la carrera que cierra la memoria de sesiones terminadas).
      notifySessionDeleted(
        {
          id: sessionId,
          userId: 'conserje-a',
          expiresAt: new Date(Date.now() + 60_000),
        },
        { path: '/sign-out' },
      );

      const { result } = await connect(sessionId);
      expect(result).toEqual({
        ok: false,
        message: REALTIME_UNAUTHORIZED_ERROR,
      });
    });
  });
});

/**
 * Revalidación periódica (≤5 min) con timers simulados: cubre lo que el hook
 * de better-auth no ve (borrado de sesión con SQL directo, usuario
 * deshabilitado, cambio de permisos o de condominio).
 */
describe('NotificationsGateway — revalidación periódica', () => {
  const NOW = new Date('2026-10-09T12:00:00.000Z');
  let resolveSession: jest.Mock<
    Promise<ResolvedBetterAuthSession | null>,
    unknown[]
  >;
  let loadSessionUser: jest.Mock<Promise<TestUser | null>, unknown[]>;
  let memberOrganization: string | null;
  let gateway: NotificationsGateway;

  interface FakeSocket {
    id: string;
    data: { user?: RealtimeUserIdentity };
    handshake: { headers: Record<string, string> };
    disconnected: boolean;
    rooms: Set<string>;
    join: jest.Mock;
    leave: jest.Mock;
    emit: jest.Mock;
    disconnect: jest.Mock;
  }

  function session(
    sessionId = 'sess-1',
    expiresAt = new Date(NOW.getTime() + 3_600_000),
  ): ResolvedBetterAuthSession {
    return { userId: 'conserje-a', sessionId, expiresAt };
  }

  function identity(
    overrides: Partial<RealtimeUserIdentity> = {},
  ): RealtimeUserIdentity {
    return {
      userId: 'conserje-a',
      organizationId: ORG_A,
      permissionNames: [...SECURITY_PERMISSIONS],
      isSuperAdmin: false,
      sessionId: 'sess-1',
      sessionExpiresAt: new Date(NOW.getTime() + 3_600_000),
      ...overrides,
    };
  }

  function connectedSocket(
    user: RealtimeUserIdentity = identity(),
  ): FakeSocket {
    const socket: FakeSocket = {
      id: 'socket-1',
      data: { user },
      handshake: { headers: { cookie: `${COOKIE_NAME}=sess-1` } },
      disconnected: false,
      rooms: new Set(),
      join: jest.fn((rooms: string | string[]) => {
        for (const room of ([] as string[]).concat(rooms)) {
          socket.rooms.add(room);
        }
      }),
      leave: jest.fn((room: string) => {
        socket.rooms.delete(room);
      }),
      emit: jest.fn(),
      disconnect: jest.fn(() => {
        socket.disconnected = true;
      }),
    };
    gateway.handleConnection(socket as unknown as RealtimeSocket);
    return socket;
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    resolveSession = jest
      .fn<Promise<ResolvedBetterAuthSession | null>, unknown[]>()
      .mockResolvedValue(session());
    loadSessionUser = jest
      .fn<Promise<TestUser | null>, unknown[]>()
      .mockResolvedValue(USERS['conserje-a']);
    memberOrganization = ORG_A;
    gateway = new NotificationsGateway(
      {
        resolveSession,
        loadSessionUser,
      } as unknown as BetterAuthSessionResolver,
      {
        query: jest.fn(() =>
          Promise.resolve(
            memberOrganization ? [{ organizationId: memberOrganization }] : [],
          ),
        ),
      } as unknown as DataSource,
    );
  });

  afterEach(() => {
    gateway.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('se conecta con sus salas y la primera revalidación es a los 5 min', async () => {
    const socket = connectedSocket();
    expect([...socket.rooms].sort()).toEqual(roomsFor(identity()).sort());

    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS - 1,
    );
    expect(resolveSession).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(resolveSession).toHaveBeenCalledTimes(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('sesión borrada sin hook (SQL directo): a los ≤5 min se corta con revoked', async () => {
    const socket = connectedSocket();
    resolveSession.mockResolvedValue(null);

    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
    );

    expect(socket.emit).toHaveBeenCalledWith(SESSION_ENDED_EVENT, {
      reason: 'revoked',
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('usuario deshabilitado (soft-delete) en la revalidación: se corta', async () => {
    const socket = connectedSocket();
    loadSessionUser.mockResolvedValue(null);

    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
    );

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('le quitan condominium.view-all: sale de la sala de seguridad sin cortarse', async () => {
    const socket = connectedSocket();
    loadSessionUser.mockResolvedValue(
      makeUser('conserje-a', ['detections.read']),
    );

    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
    );

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.leave).toHaveBeenCalledWith(organizationSecurityRoom(ORG_A));
    expect(socket.rooms.has(organizationSecurityRoom(ORG_A))).toBe(false);
    expect(
      securityRoomFor(socket.data.user as RealtimeUserIdentity),
    ).toBeNull();
  });

  it('cambia de condominio: deja org:A:security y entra a org:B:security', async () => {
    const socket = connectedSocket();
    memberOrganization = ORG_B;

    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
    );

    expect(socket.rooms.has(organizationSecurityRoom(ORG_A))).toBe(false);
    expect(socket.rooms.has(organizationSecurityRoom(ORG_B))).toBe(true);
    expect(socket.data.user?.organizationId).toBe(ORG_B);
  });

  it('la sesión vence antes de los 5 min: revalida AL vencer y corta con expired', async () => {
    const expiresAt = new Date(NOW.getTime() + 60_000);
    const socket = connectedSocket(identity({ sessionExpiresAt: expiresAt }));
    resolveSession.mockResolvedValue(null);

    await jest.advanceTimersByTimeAsync(59_999);
    expect(socket.disconnect).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(socket.emit).toHaveBeenCalledWith(SESSION_ENDED_EVENT, {
      reason: 'expired',
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('una request HTTP extendió la sesión: actualiza la expiración y sigue conectado', async () => {
    const expiresAt = new Date(NOW.getTime() + 60_000);
    const socket = connectedSocket(identity({ sessionExpiresAt: expiresAt }));
    const extended = new Date(NOW.getTime() + 7 * 24 * 3_600_000);
    resolveSession.mockResolvedValue(session('sess-1', extended));

    await jest.advanceTimersByTimeAsync(60_000);

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.data.user?.sessionExpiresAt).toEqual(extended);
    // La siguiente revalidación vuelve al intervalo de 5 min.
    resolveSession.mockClear();
    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
    );
    expect(resolveSession).toHaveBeenCalledTimes(1);
  });

  it('error al revalidar (BD): reintenta a los 30 s sin cortar; si la sesión ya venció, corta', async () => {
    const expiresAt = new Date(
      NOW.getTime() +
        SOCKET_SESSION_REVALIDATION_INTERVAL_MS +
        SOCKET_SESSION_REVALIDATION_RETRY_MS / 2,
    );
    const socket = connectedSocket(identity({ sessionExpiresAt: expiresAt }));
    loadSessionUser.mockRejectedValue(new Error('BD caída'));

    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS,
    );
    expect(socket.disconnect).not.toHaveBeenCalled();

    // El reintento queda acotado por la expiración (15 s después) y ahí corta.
    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_RETRY_MS / 2,
    );
    expect(socket.emit).toHaveBeenCalledWith(SESSION_ENDED_EVENT, {
      reason: 'expired',
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('al desconectarse el socket se cancela su revalidación', async () => {
    const socket = connectedSocket();
    gateway.handleDisconnect(socket as unknown as RealtimeSocket);

    await jest.advanceTimersByTimeAsync(
      SOCKET_SESSION_REVALIDATION_INTERVAL_MS * 2,
    );
    expect(resolveSession).not.toHaveBeenCalled();
  });
});
