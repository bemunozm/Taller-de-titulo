import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { Server as HttpServer } from 'node:http';
import request from 'supertest';
import { DataSource, FindOperator, type Repository } from 'typeorm';
import { AnomaliesController } from './anomalies.controller';
import { AnomaliesService } from './anomalies.service';
import type { AnomalyEvent } from './entities/anomaly-event.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { VisionAnalysisService } from './services/vision-analysis.service';
import type { NotificationsGateway } from '../notifications/notifications.gateway';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { ServiceApiKeyGuard } from '../auth/guards/service-api-key.guard';
import { TenantInterceptor } from '../common/tenant/tenant.interceptor';
import { User } from '../users/entities/user.entity';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ANOMALY_A1 = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const ANOMALY_A2 = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const ANOMALY_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MISSING = 'cccccccc-0000-4000-8000-00000000000c';
const SNAPSHOT = 'Zm90by1kZWwtcGF0aW8=';

function user(id: string, permissions: string[]) {
  return {
    id,
    roles: [
      {
        name: 'Rol de prueba',
        permissions: permissions.map((name) => ({ name })),
      },
    ],
    family: null,
  };
}

const USERS: Record<string, ReturnType<typeof user>> = {
  'admin-a': user('admin-a', [
    'detections.read',
    'anomalies.resolve',
    'condominium.view-all',
  ]),
  'admin-b': user('admin-b', [
    'detections.read',
    'anomalies.resolve',
    'condominium.view-all',
  ]),
  // Lee, pero no puede resolver.
  'lector-a': user('lector-a', ['detections.read', 'condominium.view-all']),
  // Puede resolver, pero no ve el condominio completo.
  'resolver-sin-vista-a': user('resolver-sin-vista-a', ['anomalies.resolve']),
};

const MEMBERSHIPS: Record<string, string> = {
  'admin-a': ORG_A,
  'admin-b': ORG_B,
  'lector-a': ORG_A,
  'resolver-sin-vista-a': ORG_A,
};

function makeRows(): AnomalyEvent[] {
  const base = {
    confidence: 0.9,
    durationSeconds: 30,
    trackId: 1,
    suspicionLevel: 'MEDIUM',
    aiReasoning: 'Sin evaluación de IA',
    snapshotJpegB64: SNAPSHOT,
    status: 'open',
    resolvedById: null,
    resolvedAt: null,
    resolutionNote: null,
    aiStatus: 'done',
    aiFalsePositive: false,
  };
  return [
    {
      ...base,
      id: ANOMALY_A1,
      organizationId: ORG_A,
      cameraId: 'cam-1',
      anomalyType: 'loitering',
      timestamp: new Date('2026-10-22T10:00:00Z'),
    },
    {
      ...base,
      id: ANOMALY_A2,
      organizationId: ORG_A,
      cameraId: 'cam-2',
      anomalyType: 'intrusion',
      timestamp: new Date('2026-10-22T11:00:00Z'),
    },
    {
      ...base,
      id: ANOMALY_B,
      organizationId: ORG_B,
      cameraId: 'cam-9',
      anomalyType: 'intrusion',
      timestamp: new Date('2026-10-22T12:00:00Z'),
    },
  ] as AnomalyEvent[];
}

type Where = Record<string, unknown>;

function matches(row: AnomalyEvent, where: Where): boolean {
  const record = row as unknown as Record<string, unknown>;
  return Object.entries(where).every(([key, expected]) =>
    expected instanceof FindOperator
      ? (expected.value as unknown[]).includes(record[key])
      : record[key] === expected,
  );
}

function pick(row: AnomalyEvent, select?: Record<string, boolean>) {
  if (!select) return row;
  const record = row as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(select)
      .filter((key) => select[key])
      .map((key) => [key, record[key]]),
  );
}

/**
 * Listado paginado y revisión de anomalías por HTTP con los guards REALES
 * (`AuthGuard` + `AuthorizationGuard`), el `TenantInterceptor` real, el
 * `ValidationPipe` de main.ts y el servicio real sobre un repositorio en
 * memoria.
 */
describe('GET /anomalies y PATCH /anomalies/:id/status (HTTP)', () => {
  let app: INestApplication | undefined;
  let rows: AnomalyEvent[];
  const sendToOrganizationSecurity = jest.fn();

  beforeEach(async () => {
    rows = makeRows();
    const repository = {
      findAndCount: jest.fn(
        ({
          where,
          select,
          take,
          skip,
        }: {
          where: Where;
          select?: Record<string, boolean>;
          take: number;
          skip: number;
        }) => {
          const all = rows
            .filter((row) => matches(row, where))
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
          return Promise.resolve([
            all.slice(skip, skip + take).map((row) => pick(row, select)),
            all.length,
          ]);
        },
      ),
      findOne: jest.fn(
        ({
          where,
          select,
        }: {
          where: Where;
          select?: Record<string, boolean>;
        }) => {
          const found = rows.find((row) => matches(row, where));
          return Promise.resolve(found ? pick(found, select) : null);
        },
      ),
      update: jest.fn((where: Where, changes: Partial<AnomalyEvent>) => {
        const found = rows.find((row) => matches(row, where));
        if (found) Object.assign(found, changes);
        return Promise.resolve({ affected: found ? 1 : 0 });
      }),
    };
    const service = new AnomaliesService(
      repository as unknown as Repository<AnomalyEvent>,
      {} as Repository<Camera>,
      {} as VisionAnalysisService,
      { sendToOrganizationSecurity } as unknown as NotificationsGateway,
      {
        findOne: ({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, name: `Nombre de ${where.id}` }),
      } as unknown as Repository<User>,
    );
    const dataSource = {
      query: jest.fn((sql: string, params: string[]) => {
        const organizationId = MEMBERSHIPS[params[0]];
        return Promise.resolve(
          sql.includes('FROM member') && organizationId
            ? [{ organizationId }]
            : [],
        );
      }),
    } as unknown as DataSource;

    const moduleRef = await Test.createTestingModule({
      controllers: [AnomaliesController],
      providers: [
        AuthGuard,
        AuthorizationGuard,
        { provide: AnomaliesService, useValue: service },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: ({ where }: { where: { id: string } }) =>
              Promise.resolve(USERS[where.id] ?? null),
          },
        },
        {
          provide: BetterAuthService,
          useValue: {
            api: {
              getSession: ({ headers }: { headers: Headers }) => {
                const match = /session=([\w-]+)/.exec(
                  headers.get('cookie') ?? '',
                );
                return Promise.resolve(
                  match ? { user: { id: match[1] } } : null,
                );
              },
            },
          },
        },
      ],
    })
      .overrideGuard(ServiceApiKeyGuard)
      .useValue({ canActivate: () => false })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new TenantInterceptor(dataSource));
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  function httpServer(): HttpServer {
    if (!app) throw new Error('La app de prueba no se inició');
    return app.getHttpServer() as HttpServer;
  }

  const list = (query: string, userId: string) =>
    request(httpServer())
      .get(`/api/v1/anomalies${query}`)
      .set('Cookie', `session=${userId}`);

  const patch = (id: string, body: unknown, userId?: string) => {
    const req = request(httpServer())
      .patch(`/api/v1/anomalies/${id}/status`)
      .send(body as object);
    return userId ? req.set('Cookie', `session=${userId}`) : req;
  };

  describe('GET /anomalies', () => {
    it('devuelve { items, total } del condominio SIN la foto, de la más nueva a la más antigua', async () => {
      const body: unknown = (await list('', 'admin-a').expect(200)).body;

      const result = body as {
        items: Array<Record<string, unknown>>;
        total: number;
      };
      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).toEqual([
        ANOMALY_A2,
        ANOMALY_A1,
      ]);
      for (const item of result.items) {
        expect(item).not.toHaveProperty('snapshotJpegB64');
        expect(item).toEqual(
          expect.objectContaining({ status: 'open', aiStatus: 'done' }),
        );
      }
    });

    it('filtros y paginación por query string (limit/offset llegan como número)', async () => {
      const byType = await list('?type=intrusion', 'admin-a').expect(200);
      expect((byType.body as { total: number }).total).toBe(1);

      const byCamera = await list('?cameraId=cam-1', 'admin-a').expect(200);
      expect((byCamera.body as { items: unknown[] }).items).toHaveLength(1);

      const page = await list('?limit=1&offset=1', 'admin-a').expect(200);
      const pageBody = page.body as {
        items: Array<{ id: string }>;
        total: number;
      };
      expect(pageBody.total).toBe(2);
      expect(pageBody.items.map((item) => item.id)).toEqual([ANOMALY_A1]);
    });

    it('filtro por status', async () => {
      await patch(ANOMALY_A1, { status: 'reviewed' }, 'admin-a').expect(200);

      const reviewed = await list('?status=reviewed', 'admin-a').expect(200);
      expect((reviewed.body as { total: number }).total).toBe(1);
      const open = await list('?status=open', 'admin-a').expect(200);
      expect((open.body as { total: number }).total).toBe(1);
    });

    it.each([
      '?status=cualquiera',
      '?limit=0',
      '?limit=101',
      '?limit=abc',
      '?offset=-1',
      '?offset=100001',
      '?desconocido=1',
    ])('query inválida %s -> 400', async (query) => {
      await list(query, 'admin-a').expect(400);
    });

    it('otro condominio no ve estas filas', async () => {
      const body: unknown = (await list('', 'admin-b').expect(200)).body;
      expect(
        (body as { items: Array<{ id: string }> }).items.map((i) => i.id),
      ).toEqual([ANOMALY_B]);
    });
  });

  describe('PATCH /anomalies/:id/status', () => {
    it('administrador del condominio: 200, registra quién/cuándo/nota y no devuelve la foto', async () => {
      const body: unknown = (
        await patch(
          ANOMALY_A1,
          { status: 'false_alarm', note: 'era el jardinero' },
          'admin-a',
        ).expect(200)
      ).body;

      expect(sendToOrganizationSecurity).toHaveBeenCalledWith(
        ORG_A,
        'security:anomaly_updated',
        expect.objectContaining({
          anomalyId: ANOMALY_A1,
          status: 'false_alarm',
        }),
      );
      expect(body).toEqual(
        expect.objectContaining({
          id: ANOMALY_A1,
          status: 'false_alarm',
          resolvedById: 'admin-a',
          resolvedByName: 'Nombre de admin-a',
          resolutionNote: 'era el jardinero',
        }),
      );
      expect((body as { resolvedAt: string }).resolvedAt).toEqual(
        expect.any(String),
      );
      expect(body).not.toHaveProperty('snapshotJpegB64');
    });

    it('volver a open limpia resolvedAt/resolvedById', async () => {
      await patch(ANOMALY_A1, { status: 'dismissed' }, 'admin-a').expect(200);
      const body: unknown = (
        await patch(ANOMALY_A1, { status: 'open' }, 'admin-a').expect(200)
      ).body;

      expect(body).toEqual(
        expect.objectContaining({
          status: 'open',
          resolvedAt: null,
          resolvedById: null,
          resolutionNote: null,
        }),
      );
    });

    it('anomalía de OTRO condominio o inexistente: 404 y la fila ajena no cambia', async () => {
      await patch(ANOMALY_B, { status: 'dismissed' }, 'admin-a').expect(404);
      await patch(MISSING, { status: 'dismissed' }, 'admin-a').expect(404);
      expect(rows.find((row) => row.id === ANOMALY_B)?.status).toBe('open');
    });

    it('sin anomalies.resolve (solo lectura): 403 y no cambia nada', async () => {
      await patch(ANOMALY_A1, { status: 'reviewed' }, 'lector-a').expect(403);
      expect(rows.find((row) => row.id === ANOMALY_A1)?.status).toBe('open');
    });

    it('con anomalies.resolve pero sin condominium.view-all: 404', async () => {
      await patch(
        ANOMALY_A1,
        { status: 'reviewed' },
        'resolver-sin-vista-a',
      ).expect(404);
    });

    it('sin sesión: 401', async () => {
      await patch(ANOMALY_A1, { status: 'reviewed' }).expect(401);
    });

    it.each([
      ['status inválido', { status: 'borrada' }],
      ['sin status', {}],
      [
        'nota de más de 500 caracteres',
        { status: 'reviewed', note: 'x'.repeat(501) },
      ],
      ['nota no string', { status: 'reviewed', note: 42 }],
      ['campo extra', { status: 'reviewed', resolvedById: 'otro' }],
    ])('%s: 400', async (_label, body) => {
      await patch(ANOMALY_A1, body, 'admin-a').expect(400);
      expect(rows.find((row) => row.id === ANOMALY_A1)?.status).toBe('open');
    });

    it('nota de exactamente 500 caracteres: 200', async () => {
      await patch(
        ANOMALY_A1,
        { status: 'reviewed', note: 'x'.repeat(500) },
        'admin-a',
      ).expect(200);
    });

    it('id que no es UUID: 400', async () => {
      await patch('no-es-uuid', { status: 'reviewed' }, 'admin-a').expect(400);
    });

    it('no choca con GET /anomalies/:id (el detalle sigue devolviendo la foto)', async () => {
      const body: unknown = (
        await request(httpServer())
          .get(`/api/v1/anomalies/${ANOMALY_A1}`)
          .set('Cookie', 'session=admin-a')
          .expect(200)
      ).body;
      expect(body).toEqual(
        expect.objectContaining({ snapshotJpegB64: SNAPSHOT }),
      );
    });
  });
});
