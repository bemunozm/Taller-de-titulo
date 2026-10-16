import type { Repository } from 'typeorm';
import { DashboardService } from './dashboard.service';
import type { PlateDetection } from '../detections/entities/plate-detection.entity';
import type { Visit } from '../visits/entities/visit.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { User } from '../users/entities/user.entity';
import type { Family } from '../families/entities/family.entity';
import type { AuditLog } from '../audit/entities/audit-log.entity';
import type { SystemLog } from '../logs/entities/system-log.entity';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import { DUPLICATE_ACCESS_DECISION } from '../detections/access-decision';
import type { TenantContext } from '../common/tenant/tenant-context.types';

const SUPER_ADMIN: TenantContext = { organizationId: null, isSuperAdmin: true };

/**
 * Fase 4 · P3: una lectura `Duplicado` (el LPR repite un paso ya registrado,
 * sin abrir ni alertar) no es una decisión de acceso. Las métricas de tiempo
 * de respuesta y el SLA de ≤5 s la dejan afuera.
 *
 * Se verifica sobre un QueryBuilder falso que registra los `andWhere` de cada
 * consulta (el servicio arma las agregaciones a mano).
 */
describe('DashboardService — métricas de tiempo de respuesta sin "Duplicado"', () => {
  interface RecordingQueryBuilder {
    andWhereCalls: Array<[string, Record<string, unknown>?]>;
    [method: string]: unknown;
  }

  let builders: RecordingQueryBuilder[];
  let service: DashboardService;

  function recordingQueryBuilder(): RecordingQueryBuilder {
    const qb: RecordingQueryBuilder = { andWhereCalls: [] };
    const chain = () => qb;
    for (const method of [
      'leftJoin',
      'leftJoinAndSelect',
      'select',
      'addSelect',
      'where',
      'groupBy',
      'orderBy',
    ]) {
      qb[method] = jest.fn(chain);
    }
    qb.andWhere = jest.fn((sql: string, params?: Record<string, unknown>) => {
      qb.andWhereCalls.push([sql, params]);
      return qb;
    });
    qb.getRawOne = jest.fn().mockResolvedValue({});
    qb.getRawMany = jest.fn().mockResolvedValue([]);
    builders.push(qb);
    return qb;
  }

  function excludesDuplicates(qb: RecordingQueryBuilder): boolean {
    return qb.andWhereCalls.some(
      ([sql, params]) =>
        sql === 'attempt.decision <> :duplicateDecision' &&
        params?.duplicateDecision === DUPLICATE_ACCESS_DECISION,
    );
  }

  beforeEach(() => {
    builders = [];
    const detectionsRepository = {
      createQueryBuilder: jest.fn(() => recordingQueryBuilder()),
    };
    service = new DashboardService(
      detectionsRepository as unknown as Repository<PlateDetection>,
      {} as Repository<Visit>,
      {} as Repository<Camera>,
      {} as Repository<User>,
      {} as Repository<Family>,
      {} as Repository<AuditLog>,
      {} as Repository<SystemLog>,
      {} as Repository<Vehicle>,
    );
  });

  it('la decisión excluida es exactamente "Duplicado"', () => {
    expect(DUPLICATE_ACCESS_DECISION).toBe('Duplicado');
  });

  it('getResponseTimeMetrics: el SLA/estadísticas y el desglose por decisión excluyen "Duplicado"', async () => {
    await service.getResponseTimeMetrics({ period: 'today' }, SUPER_ADMIN);

    expect(builders).toHaveLength(2);
    expect(builders.every(excludesDuplicates)).toBe(true);
  });

  it('getResponseTimeDetailed (export CSV con "Cumple SLA"): también excluye "Duplicado"', async () => {
    await service.getResponseTimeDetailed({ period: 'week' }, SUPER_ADMIN);

    expect(builders).toHaveLength(1);
    expect(excludesDuplicates(builders[0])).toBe(true);
  });
});

/**
 * Fase 4 · P5.B: el dashboard acota todos sus conteos y listados al
 * condominio del actor. Los logs del sistema y la auditoría de la actividad
 * reciente son de plataforma: solo el super-admin.
 */
describe('DashboardService — acotado al condominio del actor (P5.B)', () => {
  const ORG_A = '11111111-1111-4111-8111-111111111111';
  const CTX_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };

  interface FakeRepository {
    count: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
    builders: Array<{ andWhereCalls: Array<[string, unknown?]> }>;
  }

  function fakeRepository(): FakeRepository {
    const repository: FakeRepository = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      builders: [],
      createQueryBuilder: jest.fn(() => {
        const qb: Record<string, unknown> & {
          andWhereCalls: Array<[string, unknown?]>;
        } = { andWhereCalls: [] };
        const chain = () => qb;
        for (const method of [
          'leftJoin',
          'leftJoinAndSelect',
          'select',
          'addSelect',
          'where',
          'groupBy',
          'addGroupBy',
          'orderBy',
          'limit',
          'setParameter',
        ]) {
          qb[method] = jest.fn(chain);
        }
        qb.andWhere = jest.fn((sql: string, params?: unknown) => {
          qb.andWhereCalls.push([sql, params]);
          return qb;
        });
        qb.getRawOne = jest.fn().mockResolvedValue({});
        qb.getRawMany = jest.fn().mockResolvedValue([]);
        qb.getCount = jest.fn().mockResolvedValue(0);
        repository.builders.push(qb);
        return qb;
      }),
    };
    return repository;
  }

  let detections: FakeRepository;
  let visits: FakeRepository;
  let cameras: FakeRepository;
  let users: FakeRepository;
  let families: FakeRepository;
  let audit: FakeRepository;
  let logs: FakeRepository;
  let service: DashboardService;

  /** Cada `where` de `count`/`find` lleva el condominio del actor. */
  function expectScopedFindOptions(repository: FakeRepository): void {
    type FindCall = [{ where?: Record<string, unknown> }?];
    const calls: FindCall[] = [
      ...(repository.count.mock.calls as FindCall[]),
      ...(repository.find.mock.calls as FindCall[]),
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const [options] of calls) {
      expect(options?.where).toEqual(
        expect.objectContaining({ organizationId: ORG_A }),
      );
    }
  }

  /** Cada QueryBuilder lleva el filtro de condominio. */
  function expectScopedBuilders(
    repository: FakeRepository,
    alias: string,
  ): void {
    expect(repository.builders.length).toBeGreaterThan(0);
    for (const qb of repository.builders) {
      expect(qb.andWhereCalls).toContainEqual([
        `${alias}."organizationId" = :tenantOrgId`,
        { tenantOrgId: ORG_A },
      ]);
    }
  }

  beforeEach(() => {
    detections = fakeRepository();
    visits = fakeRepository();
    cameras = fakeRepository();
    users = fakeRepository();
    families = fakeRepository();
    audit = fakeRepository();
    logs = fakeRepository();
    service = new DashboardService(
      detections as unknown as Repository<PlateDetection>,
      visits as unknown as Repository<Visit>,
      cameras as unknown as Repository<Camera>,
      users as unknown as Repository<User>,
      families as unknown as Repository<Family>,
      audit as unknown as Repository<AuditLog>,
      logs as unknown as Repository<SystemLog>,
      {} as Repository<Vehicle>,
    );
  });

  it('summary: detecciones, visitas, cámaras y familias del condominio; sin logs del sistema', async () => {
    const summary = await service.getDashboardSummary(
      { period: 'today' },
      CTX_A,
    );

    expectScopedFindOptions(detections);
    expectScopedFindOptions(visits);
    expectScopedFindOptions(cameras);
    expectScopedFindOptions(families);
    expectScopedBuilders(detections, 'detection');
    expectScopedBuilders(visits, 'visit');
    expect(logs.count).not.toHaveBeenCalled();
    expect(logs.createQueryBuilder).not.toHaveBeenCalled();
    expect(summary.systemHealth.services).toEqual([]);
    expect(summary.systemHealth.totalLogsToday).toBe(0);
  });

  it('summary: usuarios y actividad auditada, por membresía en el condominio', async () => {
    await service.getDashboardSummary({ period: 'today' }, CTX_A);

    for (const repository of [users, audit]) {
      expect(repository.builders.length).toBeGreaterThan(0);
      for (const qb of repository.builders) {
        expect(qb.andWhereCalls).toContainEqual([
          expect.stringContaining('FROM member m'),
          { memberOrgId: ORG_A },
        ]);
      }
    }
  });

  it('actividad reciente: sin logs del sistema para quien no es super-admin', async () => {
    await service.getRecentActivity({ limit: 10 }, CTX_A);
    await service.getRecentActivity({ limit: 10, type: 'error' }, CTX_A);

    expectScopedFindOptions(detections);
    expectScopedFindOptions(visits);
    expect(logs.find).not.toHaveBeenCalled();
  });

  it('P5.C: actividad reciente del Administrador con la auditoría de SU condominio (audit_logs.organizationId)', async () => {
    audit.find.mockResolvedValue([
      {
        id: 'audit-1',
        module: 'visits',
        action: 'CREATE',
        createdAt: new Date(),
        user: { id: 'u-1', name: 'Admin A' },
      },
    ]);

    const activity = await service.getRecentActivity(
      { limit: 10, type: 'audit' },
      CTX_A,
    );

    expectScopedFindOptions(audit);
    const [[auditOptions]] = audit.find.mock.calls as Array<
      [{ select: { user: unknown } }]
    >;
    expect(auditOptions.select.user).toEqual({ id: true, name: true });
    expect(activity).toEqual([
      expect.objectContaining({
        id: 'audit-1',
        type: 'audit',
        message: 'Admin A realizó CREATE en visits',
      }),
    ]);
  });

  it('P5.C: un actor sin condominio no ve auditoría (ninguna fila, nunca las sin condominio)', async () => {
    await service.getRecentActivity(
      { limit: 10, type: 'audit' },
      { organizationId: null, isSuperAdmin: false },
    );

    const [[options]] = audit.find.mock.calls as Array<
      [{ where: { organizationId: { type: string; value: unknown } } }]
    >;
    expect(options.where.organizationId.type).toBe('in');
    expect(options.where.organizationId.value).toEqual([]);
  });

  it('actividad reciente: el super-admin ve errores y la auditoría de toda la plataforma', async () => {
    await service.getRecentActivity({ limit: 10 }, SUPER_ADMIN);

    expect(logs.find).toHaveBeenCalled();
    expect(audit.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('tendencias, distribución, por hora, por cámara y últimas detecciones: acotadas', async () => {
    await service.getVisitsTrend({ days: 7 }, CTX_A);
    await service.getVisitTypeDistribution(CTX_A);
    await service.getDetectionsByHour(CTX_A);
    await service.getCameraActivity(CTX_A);
    await service.getLatestDetections({ limit: 5 }, CTX_A);
    await service.getResponseTimeMetrics({ period: 'today' }, CTX_A);
    await service.getResponseTimeDetailed({ period: 'today' }, CTX_A);

    expectScopedBuilders(detections, 'detection');
    expectScopedBuilders(visits, 'visit');
    expectScopedFindOptions(visits);
    expectScopedFindOptions(cameras);
    expectScopedFindOptions(detections);
    expect(logs.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('tendencias de errores (system_logs): vacío para quien no es super-admin', async () => {
    await expect(service.getErrorTrends(CTX_A)).resolves.toEqual([]);
    expect(logs.createQueryBuilder).not.toHaveBeenCalled();
  });
});
