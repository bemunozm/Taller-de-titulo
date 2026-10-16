import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import { join } from 'path';
import {
  DataSource,
  SelectQueryBuilder,
  UpdateQueryBuilder,
  type Repository,
} from 'typeorm';
import { DetectionsService } from './detections.service';
import { DetectionsController } from './detections.controller';
import type { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { VehiclesService } from '../vehicles/vehicles.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { UsersService } from '../users/users.service';
import type { HubGateway } from '../hub/hub.gateway';
import type { VisitsService } from '../visits/visits.service';
import type { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { handlerMetadata } from '../test-utils/handler-metadata';
import type { FamilyScope, TenantActor } from '../common/tenant/tenant-actor';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const CTX_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };
const SUPER_ADMIN: TenantContext = { organizationId: null, isSuperAdmin: true };
const ATTEMPT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TENANT_FILTER = 'attempt."organizationId" = :tenantOrgId';
/** Residente de la familia 1 (sin `condominium.view-all`). */
const RESIDENT: FamilyScope = { userId: 'res-1', familyId: 'fam-1' };

const noConfig = { get: () => undefined } as unknown as ConfigService;

interface RecordingQb {
  whereCalls: Array<[string, Record<string, unknown>?]>;
  andWhereCalls: Array<[string, Record<string, unknown>?]>;
  addSelectCalls: unknown[];
  joins: Array<[string, string, string]>;
  [method: string]: unknown;
}

function recordingQb(): RecordingQb {
  const qb: RecordingQb = {
    whereCalls: [],
    andWhereCalls: [],
    addSelectCalls: [],
    joins: [],
  };
  for (const method of ['orderBy', 'take', 'update', 'set']) {
    qb[method] = jest.fn(() => qb);
  }
  for (const join of ['leftJoin', 'leftJoinAndSelect']) {
    qb[join] = jest.fn((relation: string, alias: string) => {
      qb.joins.push([join, relation, alias]);
      return qb;
    });
  }
  qb.where = jest.fn((sql: string, params?: Record<string, unknown>) => {
    qb.whereCalls.push([sql, params]);
    return qb;
  });
  qb.andWhere = jest.fn((sql: string, params?: Record<string, unknown>) => {
    qb.andWhereCalls.push([sql, params]);
    return qb;
  });
  qb.addSelect = jest.fn((selection: unknown) => {
    qb.addSelectCalls.push(selection);
    return qb;
  });
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
  return qb;
}

/**
 * Fase 4 · P5.B: las lecturas y la respuesta de detecciones con sesión
 * humana se acotan al condominio del actor (antes devolvían o tocaban las de
 * todos los condominios).
 */
describe('DetectionsService — aislamiento por condominio (P5.B)', () => {
  let detectionsQbs: RecordingQb[];
  let attemptsQbs: RecordingQb[];
  let attemptsRepo: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let usersService: { findByFamily: jest.Mock };
  let vehiclesService: { findByOwnerIds: jest.Mock };
  let service: DetectionsService;

  beforeEach(() => {
    detectionsQbs = [];
    attemptsQbs = [];
    attemptsRepo = {
      createQueryBuilder: jest.fn(() => {
        const qb = recordingQb();
        attemptsQbs.push(qb);
        return qb;
      }),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn((attempt: AccessAttempt) => Promise.resolve(attempt)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    usersService = { findByFamily: jest.fn() };
    vehiclesService = { findByOwnerIds: jest.fn() };
    service = new DetectionsService(
      {
        createQueryBuilder: jest.fn(() => {
          const qb = recordingQb();
          detectionsQbs.push(qb);
          return qb;
        }),
      } as unknown as Repository<PlateDetection>,
      attemptsRepo as unknown as Repository<AccessAttempt>,
      {} as Repository<Camera>,
      vehiclesService as unknown as VehiclesService,
      {} as NotificationsService,
      usersService as unknown as UsersService,
      {} as HubGateway,
      {} as VisitsService,
      noConfig,
    );
  });

  describe('GET /detections/plates (listDetections)', () => {
    it('filtra por el condominio del actor', async () => {
      await service.listDetections(CTX_A, null);

      expect(detectionsQbs[0].andWhereCalls).toContainEqual([
        'detection."organizationId" = :tenantOrgId',
        { tenantOrgId: ORG_A },
      ]);
    });

    it('P5.C: residente -> solo las patentes de su familia, y (corrección cyber M3) solo desde que se registró cada vehículo', async () => {
      const since1 = new Date('2026-10-01T10:00:00Z');
      const since2 = new Date('2026-10-05T10:00:00Z');
      usersService.findByFamily.mockResolvedValue([
        { id: 'res-1' },
        { id: 'res-2' },
      ]);
      vehiclesService.findByOwnerIds.mockResolvedValue([
        { plate: 'abcd12', createdAt: since1 },
        { plate: 'WXYZ98', createdAt: since2 },
        // Misma patente registrada dos veces: cuenta la fecha más antigua.
        { plate: 'ABCD12', createdAt: since2 },
      ]);

      await service.listDetections(CTX_A, RESIDENT);

      expect(usersService.findByFamily).toHaveBeenCalledWith('fam-1');
      expect(vehiclesService.findByOwnerIds).toHaveBeenCalledWith([
        'res-1',
        'res-2',
      ]);
      const qb = detectionsQbs[0];
      expect(qb.whereCalls).toEqual([]);
      expect(qb.andWhereCalls).toEqual([
        ['detection."organizationId" = :tenantOrgId', { tenantOrgId: ORG_A }],
        [
          '((UPPER(detection.plate) = :familyPlate0 AND detection.createdAt >= :familyPlateSince0) OR (UPPER(detection.plate) = :familyPlate1 AND detection.createdAt >= :familyPlateSince1))',
          {
            familyPlate0: 'ABCD12',
            familyPlateSince0: since1,
            familyPlate1: 'WXYZ98',
            familyPlateSince1: since2,
          },
        ],
      ]);
    });

    it('P5.C: residente SIN familia -> vacío (antes el interceptor lo dejaba sin filtro)', async () => {
      await expect(
        service.listDetections(CTX_A, { userId: 'res-solo', familyId: null }),
      ).resolves.toEqual([]);
      expect(detectionsQbs[0].getMany).not.toHaveBeenCalled();
      expect(usersService.findByFamily).not.toHaveBeenCalled();
    });

    it('P5.C: familia sin vehículos -> vacío', async () => {
      usersService.findByFamily.mockResolvedValue([{ id: 'res-1' }]);
      vehiclesService.findByOwnerIds.mockResolvedValue([]);

      await expect(service.listDetections(CTX_A, RESIDENT)).resolves.toEqual(
        [],
      );
      expect(detectionsQbs[0].getMany).not.toHaveBeenCalled();
    });

    it('super-admin: sin filtro de condominio', async () => {
      await service.listDetections(SUPER_ADMIN, null);

      expect(detectionsQbs[0].andWhereCalls).toEqual([]);
    });

    it('P5.C: actor sin condominio -> 1 = 0', async () => {
      await service.listDetections(
        { organizationId: null, isSuperAdmin: false },
        null,
      );

      expect(detectionsQbs[0].andWhereCalls).toEqual([['1 = 0', undefined]]);
    });
  });

  it('GET /detections/plates/attempts (listAttempts) filtra por el condominio', async () => {
    await service.listAttempts(50, CTX_A);

    expect(attemptsQbs[0].andWhereCalls).toContainEqual([
      TENANT_FILTER,
      { tenantOrgId: ORG_A },
    ]);
  });

  it('P5.C: listAttempts de un residente -> solo las patentes de su familia; sin familia, vacío', async () => {
    const since = new Date('2026-10-01T10:00:00Z');
    usersService.findByFamily.mockResolvedValue([{ id: 'res-1' }]);
    vehiclesService.findByOwnerIds.mockResolvedValue([
      { plate: 'abcd12', createdAt: since },
    ]);

    await service.listAttempts(50, CTX_A, RESIDENT);

    expect(attemptsQbs[0].andWhereCalls).toEqual([
      [TENANT_FILTER, { tenantOrgId: ORG_A }],
      [
        '((UPPER(detection.plate) = :familyPlate0 AND detection.createdAt >= :familyPlateSince0))',
        { familyPlate0: 'ABCD12', familyPlateSince0: since },
      ],
    ]);

    await expect(
      service.listAttempts(50, CTX_A, { userId: 'res-solo', familyId: null }),
    ).resolves.toEqual([]);
  });

  describe('GET /detections/pending (listPendingDetections)', () => {
    it('el listado se acota al condominio; el UPDATE de vencidas sigue global (mantenimiento)', async () => {
      await service.listPendingDetections(CTX_A);

      const [expireUpdate, listing] = attemptsQbs;
      expect(expireUpdate.execute).toHaveBeenCalled();
      expect(expireUpdate.andWhereCalls).not.toContainEqual(
        expect.arrayContaining([expect.stringContaining('organizationId')]),
      );
      expect(listing.andWhereCalls).toContainEqual([
        TENANT_FILTER,
        { tenantOrgId: ORG_A },
      ]);
    });

    it('respondedBy sale solo con id y name (antes el User completo)', async () => {
      await service.listPendingDetections(CTX_A);

      const listing = attemptsQbs[1];
      expect(listing.joins).toContainEqual([
        'leftJoin',
        'attempt.respondedBy',
        'respondedBy',
      ]);
      expect(listing.joins).not.toContainEqual([
        'leftJoinAndSelect',
        'attempt.respondedBy',
        'respondedBy',
      ]);
      expect(listing.addSelectCalls).toEqual([
        ['respondedBy.id', 'respondedBy.name'],
      ]);
    });
  });

  describe('GET /detections/pending/:id/status', () => {
    it('busca el intento acotado al condominio; uno ajeno responde como inexistente', async () => {
      await expect(
        service.checkPendingDetectionStatus(ATTEMPT_ID, CTX_A),
      ).resolves.toEqual({
        active: false,
        reason: 'Intento de acceso no encontrado',
      });
      expect(attemptsRepo.findOne).toHaveBeenCalledWith({
        where: { id: ATTEMPT_ID, organizationId: ORG_A },
      });
    });
  });

  describe('PATCH /detections/pending/:id/respond', () => {
    const responder = { id: 'conserje-a', name: 'Conserje A' };

    it('intento de otro condominio -> 404 sin guardar nada', async () => {
      await expect(
        service.respondToPendingDetection(
          ATTEMPT_ID,
          responder,
          { decision: 'approved' },
          CTX_A,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(attemptsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ATTEMPT_ID, organizationId: ORG_A },
        }),
      );
      expect(attemptsRepo.save).not.toHaveBeenCalled();
    });

    function pendingAttempt(overrides: Partial<AccessAttempt> = {}) {
      return {
        id: ATTEMPT_ID,
        organizationId: ORG_A,
        decision: 'Pendiente',
        reason: 'Vehículo no registrado',
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
      };
    }

    /** El `UPDATE` del claim: el primer QB que pide el servicio. */
    function claimQb(affected: number): RecordingQb {
      const qb = recordingQb();
      qb.execute = jest.fn().mockResolvedValue({ affected });
      attemptsRepo.createQueryBuilder.mockImplementationOnce(() => {
        attemptsQbs.push(qb);
        return qb;
      });
      return qb;
    }

    it('intento del condominio: claim atómico con respondedBy mínimo (id, name)', async () => {
      attemptsRepo.findOne.mockResolvedValue(pendingAttempt());
      const qb = claimQb(1);

      const result = await service.respondToPendingDetection(
        ATTEMPT_ID,
        responder,
        { decision: 'denied' },
        CTX_A,
      );

      expect(result.decision).toBe('denied');
      expect(result.attempt.decision).toBe('Denegado');
      expect(result.attempt.respondedBy).toEqual({
        id: 'conserje-a',
        name: 'Conserje A',
      });
      // P5.C: un único UPDATE condicionado (no un save del objeto leído).
      expect(attemptsRepo.save).not.toHaveBeenCalled();
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Denegado',
          method: 'Manual - Conserje',
          respondedBy: { id: 'conserje-a' },
        }),
      );
      expect(qb.whereCalls).toEqual([
        ['id = :attemptId', { attemptId: ATTEMPT_ID }],
      ]);
      expect(qb.andWhereCalls).toEqual([
        ['decision = :pending', { pending: 'Pendiente' }],
        ['("expiresAt" IS NULL OR "expiresAt" >= :now)', expect.anything()],
        ['"organizationId" = :claimOrgId', { claimOrgId: ORG_A }],
      ]);
    });

    it('P5.C: la segunda respuesta (perdió el claim: ya está Permitido) -> 409', async () => {
      attemptsRepo.findOne
        .mockResolvedValueOnce(pendingAttempt())
        .mockResolvedValueOnce(pendingAttempt({ decision: 'Permitido' }));
      claimQb(0);

      await expect(
        service.respondToPendingDetection(
          ATTEMPT_ID,
          responder,
          { decision: 'denied' },
          CTX_A,
        ),
      ).rejects.toThrow(ConflictException);
      expect(attemptsRepo.save).not.toHaveBeenCalled();
    });

    it('P5.C: un intento que ya tenía decisión al leerlo -> 409 sin intentar el claim', async () => {
      attemptsRepo.findOne.mockResolvedValue(
        pendingAttempt({ decision: 'Denegado' }),
      );

      await expect(
        service.respondToPendingDetection(
          ATTEMPT_ID,
          responder,
          { decision: 'approved' },
          CTX_A,
        ),
      ).rejects.toThrow(ConflictException);
      expect(attemptsRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('vencido: el claim no aplica -> se marca Expirado (condicionado a Pendiente) y 400', async () => {
      const expired = pendingAttempt({
        expiresAt: new Date(Date.now() - 1000),
      });
      attemptsRepo.findOne
        .mockResolvedValueOnce(expired)
        .mockResolvedValueOnce(expired);
      claimQb(0);

      await expect(
        service.respondToPendingDetection(
          ATTEMPT_ID,
          responder,
          { decision: 'approved' },
          CTX_A,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(attemptsRepo.update).toHaveBeenCalledWith(
        { id: ATTEMPT_ID, decision: 'Pendiente' },
        { decision: 'Expirado', reason: 'Tiempo de decisión expirado' },
      );
    });

    it('super-admin: busca el intento en cualquier condominio', async () => {
      await expect(
        service.respondToPendingDetection(
          ATTEMPT_ID,
          responder,
          { decision: 'approved' },
          SUPER_ADMIN,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(attemptsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ATTEMPT_ID } }),
      );
    });
  });
});

describe('DetectionsController — pasa el condominio del actor (P5.B)', () => {
  let plates: {
    listDetections: jest.Mock;
    listAttempts: jest.Mock;
    listPendingDetections: jest.Mock;
    checkPendingDetectionStatus: jest.Mock;
    respondToPendingDetection: jest.Mock;
  };
  let controller: DetectionsController;

  beforeEach(() => {
    plates = {
      listDetections: jest.fn().mockResolvedValue([]),
      listAttempts: jest.fn().mockResolvedValue([]),
      listPendingDetections: jest.fn().mockResolvedValue([]),
      checkPendingDetectionStatus: jest.fn().mockResolvedValue({}),
      respondToPendingDetection: jest.fn().mockResolvedValue({}),
    };
    controller = new DetectionsController(
      plates as unknown as DetectionsService,
      {
        getContext: () => Promise.resolve(CTX_A),
      } as unknown as TenantContextService,
    );
  });

  function actor(permissions: string[], familyId: string | null): TenantActor {
    return {
      userId: 'u-1',
      organizationId: ORG_A,
      isSuperAdmin: false,
      permissionNames: new Set(permissions),
      familyId,
    };
  }

  it('listados y respuesta reciben el TenantContext del actor', async () => {
    const req = { user: { id: 'u-1', name: 'Conserje' } };
    const concierge = actor(['detections.read', 'condominium.view-all'], null);

    await controller.listDetections(concierge);
    await controller.listAttempts(concierge);
    await controller.listPendingDetections();
    await controller.checkPendingDetectionStatus(ATTEMPT_ID);
    await controller.respondToPendingDetection(ATTEMPT_ID, req, {
      decision: 'approved',
    });

    // Con condominium.view-all: sin alcance por familia (null).
    expect(plates.listDetections).toHaveBeenCalledWith(CTX_A, null);
    expect(plates.listAttempts).toHaveBeenCalledWith(50, CTX_A, null);
    expect(plates.listPendingDetections).toHaveBeenCalledWith(CTX_A);
    expect(plates.checkPendingDetectionStatus).toHaveBeenCalledWith(
      ATTEMPT_ID,
      CTX_A,
    );
    expect(plates.respondToPendingDetection).toHaveBeenCalledWith(
      ATTEMPT_ID,
      { id: 'u-1', name: 'Conserje' },
      { decision: 'approved' },
      CTX_A,
    );
  });

  it('P5.C: sin condominium.view-all (Residente) el controller pasa el alcance por familia', async () => {
    const resident = actor(['detections.read'], 'fam-1');

    await controller.listDetections(resident);
    await controller.listAttempts(resident);

    expect(plates.listDetections).toHaveBeenCalledWith(CTX_A, {
      userId: 'u-1',
      familyId: 'fam-1',
    });
    expect(plates.listAttempts).toHaveBeenCalledWith(50, CTX_A, {
      userId: 'u-1',
      familyId: 'fam-1',
    });
  });

  it('GET /pending/:id/status ahora exige AuthorizationGuard y un permiso de detecciones', () => {
    const handler = 'checkPendingDetectionStatus';
    expect(
      handlerMetadata(DetectionsController, handler, GUARDS_METADATA),
    ).toEqual([AuthGuard, AuthorizationGuard]);
    expect(
      handlerMetadata(DetectionsController, handler, PERMISSIONS_KEY),
    ).toEqual(['detections.check-status', 'detections.approve']);
  });
});

/**
 * Fase 4 · P5.C: el SQL REAL del claim de `respond` (TypeORM sin BD, ver
 * memoria "typeorm-sql-without-db"): las columnas camelCase van entre
 * comillas (si no, Postgres las pasa a minúsculas y la consulta falla) y el
 * `UPDATE` lleva id + Pendiente + no vencido + condominio.
 */
describe('DetectionsService — SQL del claim de respond (P5.C)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      entities: [join(__dirname, '..', '**', '*.entity.ts')],
    });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
  });

  afterEach(() => jest.restoreAllMocks());

  it('UPDATE access_attempts ... WHERE id AND decision = Pendiente AND no vencido AND organizationId', async () => {
    const executed: Array<{ sql: string; params: Record<string, unknown> }> =
      [];
    jest.spyOn(SelectQueryBuilder.prototype, 'getOne').mockResolvedValue(
      Object.assign(new AccessAttempt(), {
        id: ATTEMPT_ID,
        organizationId: ORG_A,
        decision: 'Pendiente',
        reason: 'Vehículo no registrado',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    jest
      .spyOn(UpdateQueryBuilder.prototype, 'execute')
      .mockImplementation(function (this: UpdateQueryBuilder<AccessAttempt>) {
        executed.push({ sql: this.getQuery(), params: this.getParameters() });
        return Promise.resolve({ affected: 1, raw: [], generatedMaps: [] });
      });
    const service = new DetectionsService(
      {} as Repository<PlateDetection>,
      dataSource.getRepository(AccessAttempt),
      {} as Repository<Camera>,
      {} as VehiclesService,
      {} as NotificationsService,
      {} as UsersService,
      {} as HubGateway,
      {} as VisitsService,
      noConfig,
    );

    await service.respondToPendingDetection(
      ATTEMPT_ID,
      { id: 'conserje-a', name: 'Conserje A' },
      { decision: 'approved' },
      CTX_A,
    );

    expect(executed).toHaveLength(1);
    const [{ sql, params }] = executed;
    expect(sql).toMatch(/^UPDATE "access_attempts" SET /);
    expect(sql).toMatch(/"decision" = :orm_param_[0-9]+/);
    expect(sql).toMatch(/"responded_by_id" = :orm_param_[0-9]+/);
    expect(sql).toContain(
      'WHERE "id" = :attemptId AND "decision" = :pending AND ("expiresAt" IS NULL OR "expiresAt" >= :now) AND "organizationId" = :claimOrgId',
    );
    expect(params).toEqual(
      expect.objectContaining({
        attemptId: ATTEMPT_ID,
        pending: 'Pendiente',
        claimOrgId: ORG_A,
      }),
    );
    expect(Object.values(params)).toEqual(
      expect.arrayContaining(['Permitido', 'conserje-a']),
    );
  });
});
