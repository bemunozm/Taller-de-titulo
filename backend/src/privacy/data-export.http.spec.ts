import {
  type ExecutionContext,
  type INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';
import { AuditInterceptor } from '../audit/interceptors/audit.interceptor';
import { AuthController } from '../auth/auth.controller';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { THROTTLER_MODULE_OPTIONS } from '../common/rate-limit/rate-limit.policies';
import { OrganizationMembershipService } from '../organization-membership/organization-membership.service';
import {
  DataExportService,
  type PersonalDataExport,
} from './data-export.service';

function exportOf(userId: string): PersonalDataExport {
  return {
    formatVersion: 1,
    generatedAt: '2026-10-09T15:30:00.000Z',
    user: {
      id: userId,
      name: 'Ana',
      email: 'ana@example.com',
      emailVerified: true,
      rut: '12.345.678-5',
      phone: '+56911111111',
      age: null,
      profilePicture: null,
      roles: ['Residente'],
      condominium: null,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-01T12:00:00.000Z',
    },
    family: null,
    vehicles: [],
    visitsHosted: [],
    notifications: [],
  };
}

/**
 * Fase 4 · P7.R: `GET /api/v1/auth/me/data-export` por HTTP (throttler y
 * auditoría reales; la sesión, un doble que lee `x-test-user`).
 */
describe('GET /auth/me/data-export (Fase 4 · P7.R)', () => {
  let app: INestApplication<App>;
  let exportForUser: jest.Mock<Promise<PersonalDataExport>, [string]>;
  let auditLog: jest.Mock;

  const fakeAuthGuard = {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<{
        headers: Record<string, string | undefined>;
        user?: { id: string };
      }>();
      const userId = req.headers['x-test-user'];
      if (!userId) {
        throw new UnauthorizedException();
      }
      req.user = { id: userId };
      return true;
    },
  };

  beforeEach(async () => {
    exportForUser = jest.fn((userId: string) =>
      Promise.resolve(exportOf(userId)),
    );
    auditLog = jest.fn().mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_MODULE_OPTIONS)],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: DataExportService, useValue: { exportForUser } },
        { provide: AuditService, useValue: { log: auditLog } },
        {
          provide: OrganizationMembershipService,
          useValue: { getOrganizationIdForUser: jest.fn() },
        },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(fakeAuthGuard)
      .overrideGuard(AuthorizationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix('api/v1');
    await expressApp.init();
    app = expressApp;
  });

  afterEach(async () => {
    await app?.close();
  });

  function download(userId: string | null) {
    const req = request(app.getHttpServer()).get('/api/v1/auth/me/data-export');
    return userId ? req.set('x-test-user', userId) : req;
  }

  it('descarga un JSON adjunto con el nombre del día y sin caché', async () => {
    const response = await download('user-1');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="vigilia-mis-datos-2026-10-09.json"',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual(exportOf('user-1'));
  });

  it('solo los datos del usuario de la sesión', async () => {
    await download('user-1');

    expect(exportForUser).toHaveBeenCalledTimes(1);
    expect(exportForUser).toHaveBeenCalledWith('user-1');
  });

  it('sin sesión: 401', async () => {
    expect((await download(null)).status).toBe(401);
    expect(exportForUser).not.toHaveBeenCalled();
  });

  it('se audita la descarga, sin guardar el contenido', async () => {
    await download('user-1');
    await new Promise((resolve) => setImmediate(resolve));

    expect(auditLog).toHaveBeenCalledTimes(1);
    const [[entry]] = auditLog.mock.calls as [[Record<string, unknown>]];
    expect(entry).toMatchObject({
      module: AuditModule.PRIVACY,
      action: AuditAction.DATA_EXPORT,
      userId: 'user-1',
    });
    expect(entry.newValue).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain('12.345.678-5');
  });

  it('rate limit: 5 por hora por usuario; el 6 responde 429 y otro usuario sigue pudiendo', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await download('user-1')).status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect((await download('user-2')).status).toBe(200);
  });
});
