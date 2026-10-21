import type { ConfigService } from '@nestjs/config';
import { join } from 'path';
import {
  DataSource,
  FindOperator,
  type Repository,
  UpdateQueryBuilder,
} from 'typeorm';
import { EXPIRATION_CRON_JOBS, ExpirationService } from './expiration.service';
import { ConciergeSession } from '../../digital-concierge/entities/concierge-session.entity';
import type { TokensService } from '../../tokens/tokens.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { AccessAttempt } from '../../detections/entities/access-attempt.entity';
import {
  NotificationType,
  type Notification,
} from '../../notifications/entities/notification.entity';
import {
  Visit,
  VisitStatus,
  VisitType,
} from '../../visits/entities/visit.entity';

/**
 * Fase 4 · P3: expiración de visitas. El repositorio es un store en memoria
 * cuyo `update(criteria, patch)` solo toca las filas que calzan (igual que un
 * `UPDATE ... WHERE`), con soporte para `LessThan`; el QueryBuilder del
 * barrido por `validUntil` filtra por los estados que arma el servicio.
 */
interface StatusParams {
  statuses?: VisitStatus[];
}

interface FakeVisitQueryBuilder {
  leftJoinAndSelect: jest.Mock<FakeVisitQueryBuilder, []>;
  where: jest.Mock<FakeVisitQueryBuilder, []>;
  andWhere: jest.Mock<FakeVisitQueryBuilder, [string, StatusParams?]>;
  getMany: jest.Mock<Promise<Visit[]>, []>;
}

function fakeQueryBuilder(
  getMany: () => Promise<Visit[]>,
  onAndWhere: (sql: string, params?: StatusParams) => void = () => undefined,
): FakeVisitQueryBuilder {
  const qb = {} as FakeVisitQueryBuilder;
  qb.leftJoinAndSelect = jest.fn(() => qb);
  qb.where = jest.fn(() => qb);
  qb.andWhere = jest.fn((sql: string, params?: StatusParams) => {
    onAndWhere(sql, params);
    return qb;
  });
  qb.getMany = jest.fn(getMany);
  return qb;
}

describe('ExpirationService — visitas (Fase 4 · P3)', () => {
  const NOW = new Date('2026-10-08T12:00:00.000Z');
  const MINUTE = 60 * 1000;

  let rows: Map<string, Visit>;
  /** Copias "viejas" que devuelve el barrido (para simular carreras). */
  let staleReads: Map<string, Partial<Visit>>;
  let visitRepo: {
    update: jest.Mock;
    createQueryBuilder: jest.Mock<FakeVisitQueryBuilder, []>;
  };
  let notificationsService: {
    create: jest.Mock<Promise<unknown>, [{ type: NotificationType }]>;
  };
  let sweptStatuses: VisitStatus[];

  function matches(row: object, criteria: Record<string, unknown>): boolean {
    const record = row as Record<string, unknown>;
    return Object.entries(criteria).every(([key, expected]) => {
      if (expected instanceof FindOperator) {
        if (expected.type === 'lessThan') {
          return (
            (record[key] as Date).getTime() < (expected.value as Date).getTime()
          );
        }
        throw new Error(`Operador no soportado: ${expected.type}`);
      }
      return record[key] === expected;
    });
  }

  function makeVisit(id: string, overrides: Partial<Visit> = {}): Visit {
    return {
      id,
      type: VisitType.PEDESTRIAN,
      status: VisitStatus.PENDING,
      visitorName: `Visitante ${id}`,
      usedCount: 0,
      maxUses: 1,
      validFrom: new Date(NOW.getTime() - 120 * MINUTE),
      validUntil: new Date(NOW.getTime() + 60 * MINUTE),
      createdAt: new Date(NOW.getTime() - 5 * MINUTE),
      host: { id: 'host-1' },
      vehicle: null,
      ...overrides,
    } as unknown as Visit;
  }

  function seed(...visits: Visit[]): void {
    for (const visit of visits) {
      rows.set(visit.id, { ...visit });
    }
  }

  function statusOf(id: string): VisitStatus | undefined {
    return rows.get(id)?.status;
  }

  function buildService(
    ttl?: string,
    env: Record<string, string> = {},
  ): ExpirationService {
    const configService = {
      get: jest.fn((key: string) =>
        key === 'VISIT_APPROVAL_TTL_MINUTES' ? ttl : env[key],
      ),
    };
    return new ExpirationService(
      {} as TokensService,
      notificationsService as unknown as NotificationsService,
      {} as Repository<AccessAttempt>,
      {} as Repository<Notification>,
      visitRepo as unknown as Repository<Visit>,
      {} as Repository<ConciergeSession>,
      configService as unknown as ConfigService,
    );
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    rows = new Map();
    staleReads = new Map();
    sweptStatuses = [];
    notificationsService = {
      create: jest
        .fn<Promise<unknown>, [{ type: NotificationType }]>()
        .mockResolvedValue({}),
    };

    visitRepo = {
      update: jest.fn(
        (criteria: Record<string, unknown>, patch: Partial<Visit>) => {
          let affected = 0;
          for (const row of rows.values()) {
            if (matches(row, criteria)) {
              Object.assign(row, patch);
              affected++;
            }
          }
          return Promise.resolve({ affected, raw: [], generatedMaps: [] });
        },
      ),
      createQueryBuilder: jest.fn(() =>
        fakeQueryBuilder(
          () =>
            Promise.resolve(
              [...rows.values()]
                .filter(
                  (row) =>
                    row.validUntil.getTime() < NOW.getTime() &&
                    sweptStatuses.includes(row.status),
                )
                .map((row) => ({ ...row, ...staleReads.get(row.id) })),
            ),
          (sql, params) => {
            if (sql === 'visit.status IN (:...statuses)') {
              sweptStatuses = params?.statuses ?? [];
            }
          },
        ),
      ),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('expireAwaitingApprovalVisits (TTL de la solicitud)', () => {
    it('expira la solicitud AWAITING_APPROVAL más vieja que el TTL por defecto (30 min) y deja la reciente', async () => {
      seed(
        makeVisit('old', {
          status: VisitStatus.AWAITING_APPROVAL,
          createdAt: new Date(NOW.getTime() - 31 * MINUTE),
        }),
        makeVisit('fresh', {
          status: VisitStatus.AWAITING_APPROVAL,
          createdAt: new Date(NOW.getTime() - 29 * MINUTE),
        }),
      );

      const expired = await buildService().expireAwaitingApprovalVisits();

      expect(expired).toBe(1);
      expect(statusOf('old')).toBe(VisitStatus.EXPIRED);
      expect(statusOf('fresh')).toBe(VisitStatus.AWAITING_APPROVAL);
    });

    it('es un UPDATE condicionado a AWAITING_APPROVAL: no pisa una solicitud ya aprobada o rechazada', async () => {
      const longAgo = new Date(NOW.getTime() - 120 * MINUTE);
      seed(
        makeVisit('approved', {
          status: VisitStatus.PENDING,
          createdAt: longAgo,
        }),
        makeVisit('denied', { status: VisitStatus.DENIED, createdAt: longAgo }),
      );

      const expired = await buildService().expireAwaitingApprovalVisits();

      expect(expired).toBe(0);
      expect(statusOf('approved')).toBe(VisitStatus.PENDING);
      expect(statusOf('denied')).toBe(VisitStatus.DENIED);
      const [criteria, patch] = visitRepo.update.mock.calls[0] as [
        Record<string, unknown>,
        Partial<Visit>,
      ];
      expect(criteria.status).toBe(VisitStatus.AWAITING_APPROVAL);
      expect(patch).toEqual({ status: VisitStatus.EXPIRED });
    });

    it('respeta VISIT_APPROVAL_TTL_MINUTES', async () => {
      seed(
        makeVisit('a', {
          status: VisitStatus.AWAITING_APPROVAL,
          createdAt: new Date(NOW.getTime() - 11 * MINUTE),
        }),
      );

      await buildService('10').expireAwaitingApprovalVisits();

      expect(statusOf('a')).toBe(VisitStatus.EXPIRED);
    });

    it('un VISIT_APPROVAL_TTL_MINUTES inválido no deja construir el servicio', () => {
      expect(() => buildService('0')).toThrow('VISIT_APPROVAL_TTL_MINUTES');
      expect(() => buildService('abc')).toThrow('VISIT_APPROVAL_TTL_MINUTES');
    });
  });

  describe('expireVisits (fin de la ventana de validez)', () => {
    const past = { validUntil: new Date(NOW.getTime() - 10 * MINUTE) };

    it('NO expira DENIED (ni ACTIVE ni terminales); cierra PENDING, AWAITING y READY', async () => {
      seed(
        makeVisit('denied', { ...past, status: VisitStatus.DENIED }),
        makeVisit('cancelled', { ...past, status: VisitStatus.CANCELLED }),
        makeVisit('active', { ...past, status: VisitStatus.ACTIVE }),
        makeVisit('pending', { ...past, status: VisitStatus.PENDING }),
        makeVisit('awaiting', {
          ...past,
          status: VisitStatus.AWAITING_APPROVAL,
        }),
        makeVisit('ready', {
          ...past,
          status: VisitStatus.READY_FOR_REENTRY,
          usedCount: 1,
          maxUses: 3,
        }),
      );

      await buildService().expireVisits();

      expect(statusOf('denied')).toBe(VisitStatus.DENIED);
      expect(statusOf('cancelled')).toBe(VisitStatus.CANCELLED);
      expect(statusOf('active')).toBe(VisitStatus.ACTIVE);
      expect(statusOf('pending')).toBe(VisitStatus.EXPIRED);
      expect(statusOf('awaiting')).toBe(VisitStatus.EXPIRED);
      expect(statusOf('ready')).toBe(VisitStatus.COMPLETED);
      expect(sweptStatuses).not.toContain(VisitStatus.DENIED);
    });

    it('no pisa una visita que cambió entre la lectura y la escritura (p. ej. check-in concurrente)', async () => {
      // En la BD la visita ya está ACTIVE, pero el barrido la leyó PENDING
      // (lectura previa al check-in concurrente).
      seed(makeVisit('raced', { ...past, status: VisitStatus.ACTIVE }));
      staleReads.set('raced', { status: VisitStatus.PENDING });
      visitRepo.createQueryBuilder.mockImplementationOnce(() =>
        fakeQueryBuilder(() =>
          Promise.resolve(
            [...rows.values()].map((row) => ({
              ...row,
              ...staleReads.get(row.id),
            })),
          ),
        ),
      );

      const closed = await buildService().expireVisits();

      expect(closed).toBe(0);
      expect(statusOf('raced')).toBe(VisitStatus.ACTIVE);
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('notifica al host el cierre (expirada / completada)', async () => {
      seed(
        makeVisit('pending', { ...past, status: VisitStatus.PENDING }),
        makeVisit('ready', {
          ...past,
          status: VisitStatus.READY_FOR_REENTRY,
          usedCount: 1,
        }),
      );

      await buildService().expireVisits();

      const types = notificationsService.create.mock.calls.map(
        ([notification]) => notification.type,
      );
      expect(types.sort()).toEqual(
        [
          NotificationType.VISIT_COMPLETED,
          NotificationType.VISIT_EXPIRED,
        ].sort(),
      );
    });
  });

  describe('expireAbandonedActiveVisits (Fase 4 · P7, QA A1)', () => {
    const HOUR = 60 * MINUTE;

    it('cierra como EXPIRED la ACTIVE cuya validez venció hace más de 24 h (default) y deja la que está en la gracia', async () => {
      seed(
        makeVisit('stale', {
          status: VisitStatus.ACTIVE,
          validUntil: new Date(NOW.getTime() - 25 * HOUR),
        }),
        makeVisit('grace', {
          status: VisitStatus.ACTIVE,
          validUntil: new Date(NOW.getTime() - 23 * HOUR),
        }),
      );

      const closed = await buildService().expireAbandonedActiveVisits();

      expect(closed).toBe(1);
      expect(statusOf('stale')).toBe(VisitStatus.EXPIRED);
      expect(statusOf('grace')).toBe(VisitStatus.ACTIVE);
    });

    it('es un UPDATE condicionado a ACTIVE: no toca otros estados vencidos (ni pisa un check-out concurrente)', async () => {
      const longAgo = new Date(NOW.getTime() - 72 * HOUR);
      seed(
        makeVisit('ready', {
          status: VisitStatus.READY_FOR_REENTRY,
          validUntil: longAgo,
        }),
        makeVisit('completed', {
          status: VisitStatus.COMPLETED,
          validUntil: longAgo,
        }),
        makeVisit('pending', {
          status: VisitStatus.PENDING,
          validUntil: longAgo,
        }),
      );

      const closed = await buildService().expireAbandonedActiveVisits();

      expect(closed).toBe(0);
      expect(statusOf('ready')).toBe(VisitStatus.READY_FOR_REENTRY);
      expect(statusOf('completed')).toBe(VisitStatus.COMPLETED);
      expect(statusOf('pending')).toBe(VisitStatus.PENDING);
      const [criteria, patch] = visitRepo.update.mock.calls[0] as [
        Record<string, unknown>,
        Partial<Visit>,
      ];
      expect(criteria.status).toBe(VisitStatus.ACTIVE);
      expect(patch).toEqual({ status: VisitStatus.EXPIRED });
    });

    it('respeta VISIT_ACTIVE_GRACE_HOURS', async () => {
      seed(
        makeVisit('a', {
          status: VisitStatus.ACTIVE,
          validUntil: new Date(NOW.getTime() - 3 * HOUR),
        }),
      );

      await buildService(undefined, {
        VISIT_ACTIVE_GRACE_HOURS: '2',
      }).expireAbandonedActiveVisits();

      expect(statusOf('a')).toBe(VisitStatus.EXPIRED);
    });

    it('un VISIT_ACTIVE_GRACE_HOURS inválido no deja construir el servicio', () => {
      expect(() =>
        buildService(undefined, { VISIT_ACTIVE_GRACE_HOURS: '0' }),
      ).toThrow('VISIT_ACTIVE_GRACE_HOURS');
      expect(() =>
        buildService(undefined, { VISIT_ACTIVE_GRACE_HOURS: '169' }),
      ).toThrow('VISIT_ACTIVE_GRACE_HOURS');
    });

    it('no notifica al anfitrión (no es una visita "que no ingresó")', async () => {
      seed(
        makeVisit('stale', {
          status: VisitStatus.ACTIVE,
          validUntil: new Date(NOW.getTime() - 48 * HOUR),
        }),
      );

      await buildService().expireAbandonedActiveVisits();

      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });
});

/**
 * Fase 4 · P7 (QA A2): sesiones del conserje abandonadas. El SQL es el que
 * arma TypeORM de verdad (metadata de todas las entidades, sin conectarse);
 * la ejecución contra Postgres se verificó con la sonda de la P7.
 */
describe('ExpirationService.closeAbandonedSessions (Fase 4 · P7, QA A2)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      entities: [join(__dirname, '..', '..', '**', '*.entity.ts')],
    });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function build(): ExpirationService {
    return new ExpirationService(
      {} as TokensService,
      {} as NotificationsService,
      {} as Repository<AccessAttempt>,
      {} as Repository<Notification>,
      {} as Repository<Visit>,
      dataSource.getRepository(ConciergeSession),
      { get: () => undefined } as unknown as ConfigService,
    );
  }

  it('un solo UPDATE condicionado a ACTIVE: TIMEOUT con endTime = el que tenía o inicio + 1 h', async () => {
    let sql = '';
    let params: Record<string, unknown> = {};
    jest
      .spyOn(UpdateQueryBuilder.prototype, 'execute')
      .mockImplementation(function (
        this: UpdateQueryBuilder<ConciergeSession>,
      ) {
        sql = this.getQuery();
        params = this.getParameters();
        return Promise.resolve({ raw: [], affected: 3, generatedMaps: [] });
      });

    await expect(build().closeAbandonedSessions()).resolves.toBe(3);

    expect(sql).toBe(
      `UPDATE "concierge_sessions" SET "status" = :orm_param_0, "endTime" = COALESCE("endTime", COALESCE("startTime", "createdAt") + interval '1 hour'), "updatedAt" = CURRENT_TIMESTAMP WHERE "status" = :status AND COALESCE("startTime", "createdAt") < now() - interval '1 hour'`,
    );
    expect(params).toEqual({ orm_param_0: 'timeout', status: 'active' });
  });

  it('no toca la solicitud AWAITING (la expira el TTL, sin doble transición)', async () => {
    const execute = jest
      .spyOn(UpdateQueryBuilder.prototype, 'execute')
      .mockResolvedValue({ raw: [], affected: 0, generatedMaps: [] });

    await build().closeAbandonedSessions();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('un error de BD no lanza (el cron sigue en la próxima corrida)', async () => {
    jest
      .spyOn(UpdateQueryBuilder.prototype, 'execute')
      .mockRejectedValue(new Error('db down'));

    await expect(build().closeAbandonedSessions()).resolves.toBe(0);
  });

  it('todos los crons tienen nombre (el test de arranque los busca por nombre)', () => {
    expect(Object.values(EXPIRATION_CRON_JOBS)).toHaveLength(8);
  });
});
