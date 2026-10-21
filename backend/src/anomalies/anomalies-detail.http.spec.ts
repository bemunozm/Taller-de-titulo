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
import { PLATFORM_SUPER_ADMIN_ROLE } from '../common/tenant/tenant-context.types';
import { User } from '../users/entities/user.entity';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ANOMALY_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ANOMALY_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const MISSING = 'cccccccc-0000-4000-8000-00000000000c';
const SNAPSHOT = 'Zm90by1kZWwtcGF0aW8=';

function user(id: string, permissions: string[], role = 'Rol de prueba') {
  return {
    id,
    roles: [{ name: role, permissions: permissions.map((name) => ({ name })) }],
    family: null,
  };
}

const USERS: Record<string, ReturnType<typeof user>> = {
  'conserje-a': user('conserje-a', ['detections.read', 'condominium.view-all']),
  'conserje-b': user('conserje-b', ['detections.read', 'condominium.view-all']),
  'residente-a': user('residente-a', ['detections.read']),
  'sin-permiso-a': user('sin-permiso-a', [
    'visits.read',
    'condominium.view-all',
  ]),
  'super-admin': user(
    'super-admin',
    ['detections.read', 'condominium.view-all'],
    PLATFORM_SUPER_ADMIN_ROLE,
  ),
};

const MEMBERSHIPS: Record<string, string> = {
  'conserje-a': ORG_A,
  'residente-a': ORG_A,
  'sin-permiso-a': ORG_A,
  'conserje-b': ORG_B,
};

const ANOMALIES: Array<Partial<AnomalyEvent>> = [
  {
    id: ANOMALY_A,
    organizationId: ORG_A,
    cameraId: 'porton',
    anomalyType: 'loitering',
    snapshotJpegB64: SNAPSHOT,
  },
  {
    id: ANOMALY_B,
    organizationId: ORG_B,
    cameraId: 'patio',
    anomalyType: 'intrusion',
    snapshotJpegB64: SNAPSHOT,
  },
];

/** `where` objeto de TypeORM: igualdad o `In(...)`. */
function matches(
  row: Partial<AnomalyEvent>,
  where: Record<string, unknown>,
): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      return (expected.value as unknown[]).includes(record[key]);
    }
    return record[key] === expected;
  });
}

/**
 * Fase 4 · P6.R (D13): `GET /anomalies/:id` por HTTP con los guards REALES
 * (`AuthGuard` + `AuthorizationGuard`), el `TenantInterceptor` real y el
 * servicio real. Es donde el conserje pide la foto que el evento
 * `security:anomaly_highlight` ya no lleva.
 */
describe('GET /anomalies/:id (sesión humana, acotado al condominio)', () => {
  let app: INestApplication | undefined;
  const findOne = jest.fn(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(ANOMALIES.find((row) => matches(row, where)) ?? null),
  );

  beforeEach(async () => {
    findOne.mockClear();
    const service = new AnomaliesService(
      { findOne } as unknown as Repository<AnomalyEvent>,
      {} as Repository<Camera>,
      {} as VisionAnalysisService,
      {} as NotificationsGateway,
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
    if (!app) {
      throw new Error('La app de prueba no se inició');
    }
    return app.getHttpServer() as HttpServer;
  }

  function getAnomaly(id: string, userId?: string) {
    const req = request(httpServer()).get(`/api/v1/anomalies/${id}`);
    return userId ? req.set('Cookie', `session=${userId}`) : req;
  }

  it('conserje del condominio: 200 con la foto', async () => {
    const response = await getAnomaly(ANOMALY_A, 'conserje-a').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        id: ANOMALY_A,
        organizationId: ORG_A,
        snapshotJpegB64: SNAPSHOT,
      }),
    );
    expect(findOne).toHaveBeenCalledWith({
      where: { id: ANOMALY_A, organizationId: ORG_A },
    });
  });

  it('anomalía de OTRO condominio: 404 (igual que una inexistente)', async () => {
    await getAnomaly(ANOMALY_A, 'conserje-b').expect(404);
    await getAnomaly(MISSING, 'conserje-a').expect(404);
  });

  it('residente (detections.read sin condominium.view-all): 404 sin consultar', async () => {
    await getAnomaly(ANOMALY_A, 'residente-a').expect(404);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('sin detections.read: 403', async () => {
    await getAnomaly(ANOMALY_A, 'sin-permiso-a').expect(403);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('sin sesión: 401', async () => {
    await getAnomaly(ANOMALY_A).expect(401);
  });

  it('id que no es UUID: 400 (ParseUUIDPipe)', async () => {
    await getAnomaly('no-es-uuid', 'conserje-a').expect(400);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('super-admin: la de cualquier condominio', async () => {
    const response = await getAnomaly(ANOMALY_B, 'super-admin').expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({ id: ANOMALY_B, organizationId: ORG_B }),
    );
  });

  it('la ruta de zonas del Guardián sigue en su propio handler (no la captura :id)', async () => {
    // ServiceApiKeyGuard simulado en `false`: 403 del guard de la key, no
    // un 400 de ParseUUIDPipe de `:id`.
    await request(httpServer())
      .get(`/api/v1/anomalies/cameras/${ANOMALY_A}/zones`)
      .expect(403);
  });
});
