import {
  type ExecutionContext,
  type INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';
import { AuditInterceptor } from '../audit/interceptors/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { PRIVACY_MANAGE_PERMISSION } from '../common/constants/default-permissions.constant';
import { THROTTLER_MODULE_OPTIONS } from '../common/rate-limit/rate-limit.policies';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { OrganizationMembershipService } from '../organization-membership/organization-membership.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { DisabledUserAnonymizer } from './disabled-user-anonymizer.service';
import {
  ErasureRepository,
  type ErasureTransaction,
  type MatchedRecord,
  type MatchScope,
} from './erasure.repository';
import type { SubjectErasureRequest } from './erasure-request';
import { PrivacyErasureService } from './privacy-erasure.service';
import { PrivacyController } from './privacy.controller';

const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const ORG_B = '1c6e7e46-3a7b-4a64-8e27-6c9a4f4d1b02';
const RUT = '12.345.678-5';
const RUT_DIGITS = '12345678';
const USER_ID = '2d7f8f57-4b8c-4b75-9f38-7dab5a5e2c03';

interface TestActor {
  id: string;
  permissions: string[];
  tenantContext: TenantContext;
}

const ACTORS: Record<string, TestActor> = {
  admin: {
    id: 'admin-a',
    permissions: [PRIVACY_MANAGE_PERMISSION, 'users.read'],
    tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
  },
  // Conserje: ve el condominio, pero sin `privacy.manage`.
  conserje: {
    id: 'conserje-a',
    permissions: ['visits.read', 'condominium.view-all'],
    tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
  },
  superadmin: {
    id: 'root',
    permissions: [PRIVACY_MANAGE_PERMISSION],
    tenantContext: { organizationId: null, isSuperAdmin: true },
  },
};

/**
 * Fase 4 · P7.R: `POST /api/v1/privacy/erasure` por HTTP, con
 * `AuthorizationGuard`, `ValidationPipe`, throttler y `AuditInterceptor`
 * REALES (la sesión de better-auth se reemplaza por un doble que lee
 * `x-test-actor`; la BD, por un repositorio doble).
 */
describe('POST /privacy/erasure (Fase 4 · P7.R)', () => {
  let app: INestApplication<App>;
  let auditLog: jest.Mock;
  let tx: jest.Mocked<ErasureTransaction>;
  let anonymizeUser: jest.Mock;

  const fakeAuthGuard = {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<{
        headers: Record<string, string | undefined>;
        user?: unknown;
        tenantContext?: TenantContext;
      }>();
      const actor = ACTORS[req.headers['x-test-actor'] ?? ''];
      if (!actor) {
        throw new UnauthorizedException();
      }
      req.user = {
        id: actor.id,
        roles: [
          {
            name: 'Rol',
            permissions: actor.permissions.map((name) => ({ name })),
          },
        ],
        family: null,
      };
      req.tenantContext = actor.tenantContext;
      return true;
    },
  };

  beforeEach(async () => {
    auditLog = jest.fn().mockResolvedValue(undefined);
    tx = {
      // Una visita terminal (erasable) y una en curso (kept).
      findVisits: jest.fn<
        Promise<MatchedRecord[]>,
        [SubjectErasureRequest, MatchScope, number]
      >((_request, scope) =>
        Promise.resolve(scope === 'erasable' ? [{ id: 'v1' }] : [{ id: 'v2' }]),
      ),
      anonymizeVisits: jest.fn().mockResolvedValue(1),
      findSessions: jest.fn().mockResolvedValue([]),
      anonymizeSessions: jest.fn().mockResolvedValue(0),
      findDetections: jest.fn().mockResolvedValue([]),
      anonymizeDetections: jest
        .fn()
        .mockResolvedValue({ detections: 0, accessAttempts: 0 }),
      anonymizePassages: jest.fn().mockResolvedValue(0),
      findVisitorVehicles: jest.fn().mockResolvedValue([]),
      deleteVisitorVehicles: jest.fn().mockResolvedValue(0),
      deleteNotifications: jest.fn().mockResolvedValue(2),
      deletePendingActions: jest.fn().mockResolvedValue(0),
    };
    anonymizeUser = jest.fn().mockResolvedValue({
      alreadyAnonymized: false,
      picturesDeleted: 0,
      picturePending: false,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_MODULE_OPTIONS)],
      controllers: [PrivacyController],
      providers: [
        PrivacyErasureService,
        {
          provide: ErasureRepository,
          useValue: {
            inTransaction: (
              work: (transaction: ErasureTransaction) => Promise<unknown>,
            ) => work(tx),
          },
        },
        {
          provide: UsersService,
          useValue: { assertCanAnonymizeForActor: jest.fn() },
        },
        {
          provide: DisabledUserAnonymizer,
          useValue: { anonymize: anonymizeUser },
        },
        // AuthorizationGuard real (lee `request.user`).
        { provide: getRepositoryToken(User), useValue: {} },
        // Auditoría real, con el servicio de escritura reemplazado.
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
      .compile();

    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.setGlobalPrefix('api/v1');
    expressApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await expressApp.init();
    app = expressApp;
  });

  afterEach(async () => {
    await app?.close();
  });

  function erase(actor: string | null, body: Record<string, unknown>) {
    const req = request(app.getHttpServer()).post('/api/v1/privacy/erasure');
    return (actor ? req.set('x-test-actor', actor) : req).send(body);
  }

  /** Espera a que el interceptor (asíncrono) registre la auditoría. */
  async function auditEntries(): Promise<unknown[]> {
    await new Promise((resolve) => setImmediate(resolve));
    return auditLog.mock.calls.map(([entry]: [unknown]) => entry);
  }

  it('Administrador con privacy.manage: 200 con conteos, acotado a su condominio', async () => {
    const response = await erase('admin', { rut: RUT });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      criterion: 'rut',
      organizationId: ORG_A,
      anonymized: {
        visits: 1,
        conciergeSessions: 0,
        detections: 0,
        accessAttempts: 0,
        users: 0,
      },
      deleted: { notifications: 2, pendingActions: 0, visitorVehicles: 0 },
      skipped: {
        visits: 1,
        conciergeSessions: 0,
        detections: 0,
        visitorVehicles: 0,
      },
      imagesPendingDeletion: 0,
      complete: true,
    });
    expect(tx.findVisits).toHaveBeenCalledWith(
      { kind: 'rut', key: '123456785', organizationId: ORG_A },
      'erasable',
      expect.any(Number),
    );
  });

  it('la auditoría registra la supresión SIN el RUT en claro', async () => {
    await erase('admin', { rut: RUT });

    const entries = await auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      module: AuditModule.PRIVACY,
      action: AuditAction.DATA_ERASURE,
      userId: 'admin-a',
      organizationId: ORG_A,
    });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(RUT);
    expect(serialized).not.toContain(RUT_DIGITS);
  });

  it('supresión por userId: la auditoría registra entityId = userId (cyber B3)', async () => {
    const response = await erase('admin', { userId: USER_ID });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      criterion: 'userId',
      id: USER_ID,
      anonymized: { users: 1 },
    });
    expect(anonymizeUser).toHaveBeenCalledWith(USER_ID, {
      deferPictures: true,
    });
    const entries = await auditEntries();
    expect(entries[0]).toMatchObject({
      action: AuditAction.DATA_ERASURE,
      entityId: USER_ID,
    });
  });

  it('un pedido inválido también se audita sin el identificador', async () => {
    const response = await erase('admin', { rut: '1-9', plate: 'BBCD12' });

    expect(response.status).toBe(400);
    const serialized = JSON.stringify(await auditEntries());
    expect(serialized).toContain('FAILED');
    expect(serialized).not.toContain('BBCD12');
    expect(serialized).not.toContain('1-9');
  });

  it('sin privacy.manage (Conserje): 403 y no toca nada', async () => {
    const response = await erase('conserje', { rut: RUT });

    expect(response.status).toBe(403);
    expect(tx.findVisits).not.toHaveBeenCalled();
    expect(tx.findDetections).not.toHaveBeenCalled();
  });

  it('sin sesión: 401', async () => {
    const response = await erase(null, { rut: RUT });

    expect(response.status).toBe(401);
  });

  it('otro condominio pedido por un Administrador: 403', async () => {
    const response = await erase('admin', {
      plate: 'BBCD12',
      organizationId: ORG_B,
    });

    expect(response.status).toBe(403);
    expect(tx.findDetections).not.toHaveBeenCalled();
  });

  it('super-admin: exige organizationId con rut/plate y usa ese condominio', async () => {
    expect((await erase('superadmin', { plate: 'BBCD12' })).status).toBe(400);

    const response = await erase('superadmin', {
      plate: 'bb-cd-12',
      organizationId: ORG_B,
    });

    expect(response.status).toBe(200);
    expect(tx.findDetections).toHaveBeenCalledWith(
      { kind: 'plate', key: 'BBCD12', organizationId: ORG_B },
      'erasable',
      expect.any(Number),
    );
  });

  it.each([
    [{}],
    [{ rut: RUT, plate: 'BBCD12' }],
    [{ rut: RUT, extra: 'x' }],
    [{ userId: 'no-es-uuid' }],
    [{ rut: 'x'.repeat(33) }],
  ])('400 con el cuerpo %p', async (body) => {
    expect((await erase('admin', body)).status).toBe(400);
    expect(tx.findVisits).not.toHaveBeenCalled();
  });

  it('rate limit: 20 por hora por usuario; el 21 responde 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await erase('admin', { plate: 'BBCD12' })).status);
    }

    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    // Otro usuario sigue pudiendo.
    expect(
      (
        await erase('superadmin', {
          plate: 'BBCD12',
          organizationId: ORG_A,
        })
      ).status,
    ).toBe(200);
  });
});
