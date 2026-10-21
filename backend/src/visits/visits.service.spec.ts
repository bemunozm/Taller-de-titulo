import {
  ArgumentMetadata,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import type { PersistenceRepositoryMock } from '../test-utils/mock-repository';
import {
  FindOperator,
  QueryFailedError,
  type DataSource,
  type Repository,
} from 'typeorm';
import { VisitsService } from './visits.service';
import { Visit, VisitStatus, VisitType } from './entities/visit.entity';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UsersService } from '../users/users.service';
import { FamiliesService } from '../families/families.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { VehicleAccessLevel } from '../vehicles/vehicle-access';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { resolveTenantContext } from '../common/tenant/tenant-context.util';
import type { User } from '../users/entities/user.entity';
import { VisitEntryAlreadyRegisteredException } from './visit-entry-already-registered.exception';
import { VisitExitAlreadyRegisteredException } from './visit-exit-already-registered.exception';

/**
 * Cierre de fases 1-2 (follow-up post-auditoría) — FIX 1: escritura
 * cross-tenant vía `hostId`. `UsersService.findOne` que resuelve el host NO
 * está scopeado por tenant (a propósito, ver docstring de
 * `VisitsService.assertHostBelongsToCreatorTenant`), así que sin esta
 * validación un admin del condominio A podía pasar el `hostId` de un usuario
 * del condominio B y `create`/`update` atribuían el recurso a B.
 *
 * Se instancia `VisitsService` directamente (sin `Test.createTestingModule`)
 * porque sus dependencias son providers planos — más simple mockear a mano
 * dado que `TenantContextService` es REQUEST-scoped y no aporta valor
 * levantar el DI container completo solo para esto.
 */
describe('VisitsService — aislamiento cross-tenant por hostId', () => {
  let service: VisitsService;
  let visitRepository: PersistenceRepositoryMock<Visit>;
  let vehicleRepository: PersistenceRepositoryMock<Vehicle>;
  let usersService: jest.Mocked<Pick<UsersService, 'findOne'>>;
  let vehiclesService: jest.Mocked<
    Pick<VehiclesService, 'findByPlate' | 'update' | 'create'>
  >;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'create'>>;
  let tenantContext: jest.Mocked<Pick<TenantContextService, 'getContext'>>;

  const buildHost = (organizationId: string | null): User =>
    ({
      id: 'host-1',
      name: 'Host Uno',
      family: { id: 'family-1', organizationId },
    }) as unknown as User;

  const baseCreateDto: CreateVisitDto = {
    type: VisitType.PEDESTRIAN,
    visitorName: 'Visitante Test',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    hostId: 'host-1',
  };

  const setCtx = (ctx: TenantContext) => {
    tenantContext.getContext.mockResolvedValue(ctx);
  };

  beforeEach(() => {
    visitRepository = {
      create: jest.fn((data) => data as unknown as Visit),
      save: jest.fn((visit) => Promise.resolve(visit as Visit)),
      findOne: jest.fn<Promise<Visit | null>, [unknown]>(),
    };
    vehicleRepository = {
      create: jest.fn<Vehicle, [Partial<Vehicle>]>(),
      save: jest.fn<Promise<Vehicle>, [Partial<Vehicle>]>(),
      findOne: jest.fn<Promise<Vehicle | null>, [unknown]>(),
    };
    usersService = { findOne: jest.fn() };
    vehiclesService = {
      findByPlate: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    };
    notificationsService = { create: jest.fn().mockResolvedValue({}) };
    tenantContext = { getContext: jest.fn() };

    service = new VisitsService(
      visitRepository as unknown as Repository<Visit>,
      vehicleRepository as unknown as Repository<Vehicle>,
      usersService as unknown as UsersService,
      {} as FamiliesService,
      vehiclesService as unknown as VehiclesService,
      notificationsService as unknown as NotificationsService,
      tenantContext as unknown as TenantContextService,
    );
  });

  describe('create', () => {
    it('rechaza cuando el host resuelto pertenece a otro condominio que el creador autenticado', async () => {
      usersService.findOne.mockResolvedValue(buildHost('org-B'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      await expect(service.create(baseCreateDto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(visitRepository.save).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('permite crear la visita cuando el host pertenece al mismo condominio que el creador', async () => {
      usersService.findOne.mockResolvedValue(buildHost('org-A'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      await expect(service.create(baseCreateDto)).resolves.toBeDefined();
      expect(visitRepository.save).toHaveBeenCalled();
    });

    it('permite a un super-admin crear la visita sin importar el condominio del host (queda en el condominio del host)', async () => {
      usersService.findOne.mockResolvedValue(buildHost('org-B'));
      setCtx({ organizationId: null, isSuperAdmin: true });

      await expect(service.create(baseCreateDto)).resolves.toEqual(
        expect.objectContaining({ organizationId: 'org-B' }),
      );
      expect(visitRepository.save).toHaveBeenCalled();
    });

    it('con condominio: la visita queda estampada con el condominio del creador', async () => {
      usersService.findOne.mockResolvedValue(buildHost('org-A'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      await expect(service.create(baseCreateDto)).resolves.toEqual(
        expect.objectContaining({ organizationId: 'org-A' }),
      );
    });

    /**
     * Fase 4 · P3 (seguridad ALTO): antes un contexto nulo SALTABA la
     * validación del anfitrión y la visita tomaba el condominio de la familia
     * del anfitrión: un usuario sin condominio creaba visitas que el LPR de
     * otro condominio abría.
     */
    describe('bypass por contexto nulo (camino HTTP)', () => {
      it.each([VisitType.PEDESTRIAN, VisitType.VEHICULAR])(
        'usuario sin condominio + anfitrión de otro condominio (%s) -> 403 sin crear nada',
        async (type) => {
          usersService.findOne.mockResolvedValue(buildHost('org-B'));
          setCtx({ organizationId: null, isSuperAdmin: false });

          await expect(
            service.create({ ...baseCreateDto, type, vehiclePlate: 'BBCD12' }),
          ).rejects.toThrow(ForbiddenException);
          expect(usersService.findOne).not.toHaveBeenCalled();
          expect(vehicleRepository.save).not.toHaveBeenCalled();
          expect(visitRepository.save).not.toHaveBeenCalled();
          expect(notificationsService.create).not.toHaveBeenCalled();
        },
      );

      it('un error de BD al resolver la membresía (contexto nulo) cae en el mismo 403', async () => {
        const failingDataSource = {
          query: jest.fn().mockRejectedValue(new Error('BD caída')),
        } as unknown as DataSource;
        setCtx(
          await resolveTenantContext(
            { id: 'user-1', roles: [{ name: 'Conserje' }] },
            failingDataSource,
          ),
        );
        usersService.findOne.mockResolvedValue(buildHost('org-B'));

        await expect(service.create(baseCreateDto)).rejects.toThrow(
          ForbiddenException,
        );
        expect(visitRepository.save).not.toHaveBeenCalled();
      });
    });

    describe('organizationId explícito (flujo interno: conserje digital)', () => {
      it('crea la visita en ESE condominio sin depender del contexto (que puede ser nulo)', async () => {
        usersService.findOne.mockResolvedValue(buildHost('org-B'));
        setCtx({ organizationId: null, isSuperAdmin: false });

        const visit = await service.create(baseCreateDto, {
          initialStatus: VisitStatus.AWAITING_APPROVAL,
          organizationId: 'org-B',
        });

        expect(visit.organizationId).toBe('org-B');
        expect(visit.status).toBe(VisitStatus.AWAITING_APPROVAL);
        expect(tenantContext.getContext).not.toHaveBeenCalled();
      });

      it('con un anfitrión de otro condominio -> 403 sin crear nada', async () => {
        usersService.findOne.mockResolvedValue(buildHost('org-A'));

        await expect(
          service.create(baseCreateDto, {
            initialStatus: VisitStatus.AWAITING_APPROVAL,
            organizationId: 'org-B',
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(visitRepository.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('update', () => {
    const existingVisit = {
      id: 'visit-1',
      type: VisitType.PEDESTRIAN,
      host: buildHost('org-A'),
      family: { id: 'family-1', organizationId: 'org-A' },
      vehicle: null,
      status: VisitStatus.PENDING,
      usedCount: 0,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 3_600_000),
    } as unknown as Visit;
    let update: jest.Mock;

    beforeEach(() => {
      // PATCH escribe con un UPDATE condicionado (Fase 4 · P3), no con save().
      update = jest.fn().mockResolvedValue({ affected: 1 });
      (visitRepository as unknown as { update: jest.Mock }).update = update;
    });

    it('rechaza reasignar el host a un usuario de otro condominio', async () => {
      visitRepository.findOne.mockResolvedValue(existingVisit);
      usersService.findOne.mockResolvedValue(buildHost('org-B'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      const dto: UpdateVisitDto = { hostId: 'host-2' };

      await expect(service.update('visit-1', dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(update).not.toHaveBeenCalled();
      expect(visitRepository.save).not.toHaveBeenCalled();
    });

    it('permite reasignar el host a un usuario del mismo condominio', async () => {
      visitRepository.findOne.mockResolvedValue(existingVisit);
      usersService.findOne.mockResolvedValue(buildHost('org-A'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      const dto: UpdateVisitDto = { hostId: 'host-2' };

      await expect(service.update('visit-1', dto)).resolves.toBeDefined();
      expect(update).toHaveBeenCalledWith(
        {
          id: 'visit-1',
          organizationId: 'org-A',
          status: VisitStatus.PENDING,
          usedCount: 0,
        },
        { host: { id: 'host-1' }, family: { id: 'family-1' } },
      );
      expect(visitRepository.save).not.toHaveBeenCalled();
    });

    it.each([
      ['reasignando a un anfitrión de otro condominio', { hostId: 'host-2' }],
      ['solo cambiando el nombre', { visitorName: 'Otro' }],
    ])(
      'usuario sin condominio (contexto nulo) -> 403 %s, sin leer ni escribir',
      async (_label, dto: UpdateVisitDto) => {
        visitRepository.findOne.mockResolvedValue(existingVisit);
        usersService.findOne.mockResolvedValue(buildHost('org-B'));
        setCtx({ organizationId: null, isSuperAdmin: false });

        await expect(service.update('visit-1', dto)).rejects.toThrow(
          ForbiddenException,
        );
        expect(visitRepository.findOne).not.toHaveBeenCalled();
        expect(usersService.findOne).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      },
    );
  });

  /**
   * FIX cross-tenant (rama feature/cierre-fases-1-2): apertura autónoma del
   * portón por visita vehicular pre-aprobada. `DetectionsService` (ver su
   * spec, describe 'apertura autónoma...') llamaba a
   * `validateAccess(plate, 'plate', { skipTenantScope: true })`, que delega en
   * `findByPlate`. Este describe caracteriza el comportamiento REAL de
   * `findByPlate` frente al scoping por tenant, usando un mock de
   * QueryBuilder (createQueryBuilder/leftJoinAndSelect/where/andWhere/getOne
   * encadenados) porque el método arma la query manualmente en vez de usar
   * `repository.find`.
   *
   * HALLAZGO ORIGINAL (ya corregido — ver commits de esta rama): con
   * `skipTenantScope: true` (el modo que usaba TODO el camino del worker LPR)
   * la query no agregaba ningún filtro por `organizationId` — buscaba la
   * patente en TODOS los condominios de la plataforma. En la práctica: una
   * visita vehicular pre-aprobada creada en el condominio B con la patente X
   * abría el portón del condominio A si una cámara de A detectaba esa misma
   * patente X.
   *
   * FIX: `DetectionsService.createDetection` ahora pasa `organizationId`
   * (el de la CÁMARA que detectó la patente, resource-derived) en vez de
   * `skipTenantScope`. `findByPlate`/`validateAccess` aceptan este scope
   * explícito y lo aplican vía `applyTenantFilter` con un `TenantContext`
   * sintético `{ organizationId, isSuperAdmin: false }` — la query SÍ filtra
   * por ese condominio específico, sin necesidad de `TenantContextService`
   * (que no puede resolver nada sin `request.user`). `skipTenantScope` queda
   * reservado para call-sites que de verdad no tienen NINGÚN tenant confiable
   * (p.ej. Conserje Digital, visitante anónimo en el citófono).
   */
  describe('findByPlate — aislamiento tenant', () => {
    let qb: {
      leftJoinAndSelect: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock<unknown, [string, Record<string, unknown>?]>;
      getOne: jest.Mock;
    };

    beforeEach(() => {
      qb = {
        leftJoinAndSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn<unknown, [string, Record<string, unknown>?]>(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      // Encadenable: cada método de la query devuelve el mismo mock.
      qb.leftJoinAndSelect.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);

      (
        visitRepository as unknown as { createQueryBuilder: jest.Mock }
      ).createQueryBuilder = jest.fn().mockReturnValue(qb);
    });

    it('[FIX] con organizationId explícito (camino LPR tras el fix) SÍ filtra por ESE condominio, sin consultar TenantContextService', async () => {
      await service.findByPlate('ABCD12', { organizationId: 'org-camara-A' });

      // El worker LPR no tiene request.user — el scope viene explícito desde
      // afuera (organizationId de la CÁMARA), no se resuelve ningún contexto.
      expect(tenantContext.getContext).not.toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith(
        'visit."organizationId" = :tenantOrgId',
        {
          tenantOrgId: 'org-camara-A',
        },
      );
    });

    it('[FIX] patente de una visita de OTRO condominio (B) no matchea cuando se busca scopeado al condominio de la cámara (A)', async () => {
      // El mock de queryBuilder no ejecuta SQL real, así que "no matchea" se
      // verifica a nivel de contrato: el filtro aplicado exige
      // organizationId = 'org-A' exacto (no 'org-B', no ausencia de filtro).
      // getOne() devuelve null (setup del beforeEach) — equivalente a que la
      // fila de la visita de 'org-B' no calce con esa condición SQL.
      const visit = await service.findByPlate('ABCD12', {
        organizationId: 'org-A',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'visit."organizationId" = :tenantOrgId',
        {
          tenantOrgId: 'org-A',
        },
      );
      expect(qb.andWhere).not.toHaveBeenCalledWith(
        'visit."organizationId" = :tenantOrgId',
        {
          tenantOrgId: 'org-B',
        },
      );
      expect(visit).toBeNull();
    });

    it('skipTenantScope sigue sin filtrar por organizationId — reservado para call-sites SIN ningún tenant confiable (Conserje Digital), ya NO usado por el camino LPR', async () => {
      await service.findByPlate('ABCD12', { skipTenantScope: true });

      expect(tenantContext.getContext).not.toHaveBeenCalled();

      // Los únicos andWhere aplicados son estado + ventana de validez, NUNCA
      // uno que referencie organizationId.
      const andWhereClauses = qb.andWhere.mock.calls.map((call) => call[0]);
      expect(
        andWhereClauses.some((clause) => clause.includes('organizationId')),
      ).toBe(false);
      expect(andWhereClauses).toEqual([
        'visit.status IN (:...statuses)',
        'visit.validFrom <= :now',
        'visit.validUntil >= :now',
      ]);
    });

    it('con sesión de usuario (sin skipTenantScope ni organizationId explícito) SÍ filtra por el organizationId del contexto tenant', async () => {
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      await service.findByPlate('ABCD12');

      expect(tenantContext.getContext).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith(
        'visit."organizationId" = :tenantOrgId',
        {
          tenantOrgId: 'org-A',
        },
      );
    });

    it('super-admin (sin skipTenantScope) tampoco filtra por organizationId — bypass real intencional', async () => {
      setCtx({ organizationId: null, isSuperAdmin: true });

      await service.findByPlate('ABCD12');

      const andWhereClauses = qb.andWhere.mock.calls.map((call) => call[0]);
      expect(
        andWhereClauses.some((clause) => clause.includes('organizationId')),
      ).toBe(false);
    });
  });
});

/**
 * Fase 4 · P3 (docs/modulos/hardening-pre-piloto.md §2 D2/D3 y §3): máquina
 * de estados de `Visit`. El repositorio de visitas es un store en memoria
 * cuyo `update(criteria, patch)` aplica el patch SOLO a las filas que calzan
 * con el criterio, igual que el `UPDATE ... WHERE` de Postgres: así los
 * claims condicionados (aprobar, denegar, check-in) se prueban con su
 * semántica real, incluida la concurrencia.
 */
describe('VisitsService — máquina de estados (Fase 4 · P3)', () => {
  const ORG = 'org-A';
  const HOST = {
    id: 'host-1',
    name: 'Host Uno',
    family: { id: 'family-1', organizationId: ORG },
  };
  const SCOPE = { tenantId: ORG, isSuperAdmin: false };
  /** Quién responde la solicitud (Fase 4 · P4): siempre lo pasa el caller. */
  const RESPONDER = { respondedById: 'responder-1' };

  let rows: Map<string, Visit>;
  let vehicles: Map<string, Vehicle>;
  /** Cada UPDATE del store, y si ocurrió dentro de `manager.transaction`. */
  let writes: Array<{
    criteria: Record<string, unknown>;
    patch: Partial<Visit>;
    inTransaction: boolean;
  }>;
  /** Cada lectura con `relations` (la entidad que devuelven approve/deny). */
  let relationReads: Array<{ inTransaction: boolean }>;
  let inTransaction: boolean;
  let visitRepository: {
    findOne: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let vehicleRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let usersService: jest.Mocked<Pick<UsersService, 'findOne'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'create'>>;
  let tenantContext: jest.Mocked<Pick<TenantContextService, 'getContext'>>;
  let service: VisitsService;

  function matches(row: object, criteria: Record<string, unknown>): boolean {
    const record = row as Record<string, unknown>;
    return Object.entries(criteria).every(([key, expected]) => {
      if (expected instanceof FindOperator) {
        if (expected.type === 'isNull') {
          return record[key] === null || record[key] === undefined;
        }
        if (expected.type === 'in') {
          return (expected.value as unknown[]).includes(record[key]);
        }
        throw new Error(
          `Operador no soportado por el store de test: ${expected.type}`,
        );
      }
      return record[key] === expected;
    });
  }

  function whereOf(options: unknown): Record<string, unknown> {
    return (options as { where?: Record<string, unknown> }).where ?? {};
  }

  function makeVisit(overrides: Partial<Visit> = {}): Visit {
    const now = Date.now();
    return {
      id: 'visit-1',
      organizationId: ORG,
      type: VisitType.PEDESTRIAN,
      status: VisitStatus.AWAITING_APPROVAL,
      visitorName: 'Visitante Test',
      visitorRut: null,
      visitorPhone: null,
      reason: null,
      requestedPlate: null,
      qrCode: 'qr-1',
      maxUses: 1,
      usedCount: 0,
      validFrom: new Date(now - 60_000),
      validUntil: new Date(now + 3_600_000),
      entryTime: null,
      exitTime: null,
      host: HOST,
      family: HOST.family,
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

  beforeEach(() => {
    rows = new Map();
    vehicles = new Map();
    writes = [];
    relationReads = [];
    inTransaction = false;

    visitRepository = {
      findOne: jest.fn((options: unknown) => {
        if ((options as { relations?: unknown }).relations) {
          relationReads.push({ inTransaction });
        }
        const criteria = whereOf(options);
        const row = [...rows.values()].find((r) => matches(r, criteria));
        return Promise.resolve(row ? { ...row } : null);
      }),
      update: jest.fn(
        (criteria: Record<string, unknown>, patch: Partial<Visit>) => {
          writes.push({ criteria, patch, inTransaction });
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
      create: jest.fn((data: Partial<Visit>) => ({ ...data }) as Visit),
      save: jest.fn((visit: Visit) => {
        const saved = { ...visit, id: visit.id ?? 'visit-new' };
        rows.set(saved.id, saved);
        return Promise.resolve(saved);
      }),
      createQueryBuilder: jest.fn(),
      manager: { transaction: jest.fn() },
    };

    vehicleRepository = {
      findOne: jest.fn((options: unknown) => {
        const plate = whereOf(options).plate as string;
        return Promise.resolve(vehicles.get(plate) ?? null);
      }),
      create: jest.fn((data: Partial<Vehicle>) => ({ ...data }) as Vehicle),
      save: jest.fn((vehicle: Vehicle) => {
        const saved = {
          ...vehicle,
          id: `vehicle-${vehicle.plate}`,
        };
        vehicles.set(saved.plate, saved);
        return Promise.resolve(saved);
      }),
    };

    visitRepository.manager.transaction.mockImplementation(
      async (
        work: (manager: {
          getRepository: (entity: unknown) => unknown;
        }) => Promise<unknown>,
      ) => {
        inTransaction = true;
        try {
          return await work({
            getRepository: (entity: unknown) =>
              entity === Vehicle ? vehicleRepository : visitRepository,
          });
        } finally {
          inTransaction = false;
        }
      },
    );

    usersService = {
      findOne: jest.fn().mockResolvedValue(HOST),
    };
    notificationsService = { create: jest.fn().mockResolvedValue({}) };
    tenantContext = {
      getContext: jest
        .fn()
        .mockResolvedValue({ organizationId: ORG, isSuperAdmin: false }),
    };

    service = new VisitsService(
      visitRepository as unknown as Repository<Visit>,
      vehicleRepository as unknown as Repository<Vehicle>,
      usersService as unknown as UsersService,
      {} as FamiliesService,
      {
        findByPlate: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      } as unknown as VehiclesService,
      notificationsService as unknown as NotificationsService,
      tenantContext as unknown as TenantContextService,
    );
  });

  describe('create', () => {
    const vehicularDto: CreateVisitDto = {
      type: VisitType.VEHICULAR,
      visitorName: 'Visitante Test',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      hostId: 'host-1',
      vehiclePlate: 'ABCD12',
    };

    it('con initialStatus AWAITING_APPROVAL: no notifica VISIT_APPROVED ni crea el Vehicle; guarda la patente pedida', async () => {
      const visit = await service.create(vehicularDto, {
        initialStatus: VisitStatus.AWAITING_APPROVAL,
      });

      expect(visit.status).toBe(VisitStatus.AWAITING_APPROVAL);
      expect(visit.requestedPlate).toBe('ABCD12');
      expect(visit.vehicle).toBeUndefined();
      expect(vehicleRepository.findOne).not.toHaveBeenCalled();
      expect(vehicleRepository.save).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('sin opciones (HTTP) nace PENDING, crea el Vehicle temporal y notifica al host', async () => {
      const visit = await service.create(vehicularDto);

      expect(visit.status).toBe(VisitStatus.PENDING);
      expect(visit.requestedPlate).toBeUndefined();
      expect(visit.vehicle?.plate).toBe('ABCD12');
      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plate: 'ABCD12',
          vehicleType: null,
          accessLevel: 'visitante',
        }),
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationType.VISIT_APPROVED }),
      );
    });
  });

  describe('approve', () => {
    it('AWAITING_APPROVAL -> PENDING con claim condicionado al estado y al tenant, y notifica VISIT_APPROVED', async () => {
      seed(makeVisit());

      const approved = await service.approve('visit-1', SCOPE, RESPONDER);

      expect(approved.status).toBe(VisitStatus.PENDING);
      expect(statusOf('visit-1')).toBe(VisitStatus.PENDING);
      expect(visitRepository.update).toHaveBeenCalledWith(
        {
          id: 'visit-1',
          organizationId: ORG,
          status: VisitStatus.AWAITING_APPROVAL,
        },
        {
          status: VisitStatus.PENDING,
          qrCode: expect.any(String) as string,
          respondedById: 'responder-1',
          respondedAt: expect.any(Date) as Date,
        },
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'host-1',
          type: NotificationType.VISIT_APPROVED,
        }),
      );
    });

    it('dos aprobaciones concurrentes: solo una gana el claim, la segunda recibe 409', async () => {
      seed(makeVisit());

      const results = await Promise.allSettled([
        service.approve('visit-1', SCOPE, RESPONDER),
        service.approve('visit-1', SCOPE, RESPONDER),
      ]);

      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(statusOf('visit-1')).toBe(VisitStatus.PENDING);
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      VisitStatus.PENDING,
      VisitStatus.DENIED,
      VisitStatus.EXPIRED,
      VisitStatus.ACTIVE,
    ])(
      'una visita en %s (no en AWAITING_APPROVAL) -> 409 sin efectos',
      async (status) => {
        seed(makeVisit({ status }));

        await expect(
          service.approve('visit-1', SCOPE, RESPONDER),
        ).rejects.toThrow(ConflictException);
        expect(statusOf('visit-1')).toBe(status);
        expect(notificationsService.create).not.toHaveBeenCalled();
      },
    );

    it('una visita de otro condominio no se puede aprobar (404, sin tocarla)', async () => {
      seed(makeVisit({ organizationId: 'org-B' }));

      await expect(
        service.approve('visit-1', SCOPE, RESPONDER),
      ).rejects.toThrow(NotFoundException);
      expect(statusOf('visit-1')).toBe(VisitStatus.AWAITING_APPROVAL);
    });

    it('P5.C: scope sin condominio no alcanza ninguna visita (In([]), ni el "cajón nulo") -> 404', async () => {
      seed(makeVisit({ organizationId: null }));

      await expect(
        service.approve(
          'visit-1',
          { tenantId: null, isSuperAdmin: false },
          RESPONDER,
        ),
      ).rejects.toThrow(NotFoundException);

      const [criteria] = visitRepository.update.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(criteria.organizationId).toBeInstanceOf(FindOperator);
      expect((criteria.organizationId as FindOperator<unknown>).type).toBe(
        'in',
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.AWAITING_APPROVAL);
    });

    it('vehicular: crea el Vehicle desde requestedPlate y lo asocia a la visita', async () => {
      seed(makeVisit({ type: VisitType.VEHICULAR, requestedPlate: 'ABCD12' }));

      const approved = await service.approve('visit-1', SCOPE, RESPONDER);

      expect(visitRepository.manager.transaction).toHaveBeenCalledTimes(1);
      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plate: 'ABCD12',
          vehicleType: null,
          accessLevel: 'visitante',
          active: true,
        }),
      );
      expect(visitRepository.update).toHaveBeenCalledWith(
        { id: 'visit-1' },
        { vehicle: { id: 'vehicle-ABCD12' } },
      );
      expect(approved.status).toBe(VisitStatus.PENDING);
      expect(approved.vehicle).toEqual({ id: 'vehicle-ABCD12' });
    });

    it('vehicular con un Vehicle ya registrado para la patente: lo reutiliza', async () => {
      vehicles.set('ABCD12', {
        id: 'vehicle-existente',
        plate: 'ABCD12',
      } as Vehicle);
      seed(makeVisit({ type: VisitType.VEHICULAR, requestedPlate: 'ABCD12' }));

      await service.approve('visit-1', SCOPE, RESPONDER);

      expect(vehicleRepository.save).not.toHaveBeenCalled();
      expect(visitRepository.update).toHaveBeenCalledWith(
        { id: 'visit-1' },
        { vehicle: { id: 'vehicle-existente' } },
      );
    });

    it('vehicular: si falla crear el Vehicle, la transacción no se confirma y no se notifica', async () => {
      seed(makeVisit({ type: VisitType.VEHICULAR, requestedPlate: 'ABCD12' }));
      vehicleRepository.save.mockRejectedValueOnce(
        new Error('unique_violation'),
      );

      await expect(
        service.approve('visit-1', SCOPE, RESPONDER),
      ).rejects.toThrow('unique_violation');
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('peatonal: no crea ningún Vehicle', async () => {
      seed(makeVisit());

      await service.approve('visit-1', SCOPE, RESPONDER);

      expect(vehicleRepository.findOne).not.toHaveBeenCalled();
      expect(vehicleRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('deny', () => {
    it('AWAITING_APPROVAL -> DENIED con claim condicionado', async () => {
      seed(makeVisit());

      const denied = await service.deny('visit-1', SCOPE, RESPONDER);

      expect(denied.status).toBe(VisitStatus.DENIED);
      expect(visitRepository.update).toHaveBeenCalledWith(
        {
          id: 'visit-1',
          organizationId: ORG,
          status: VisitStatus.AWAITING_APPROVAL,
        },
        {
          status: VisitStatus.DENIED,
          respondedById: 'responder-1',
          respondedAt: expect.any(Date) as Date,
        },
      );
    });

    it.each([VisitStatus.PENDING, VisitStatus.ACTIVE, VisitStatus.DENIED])(
      'una visita en %s -> 409 sin cambiarla',
      async (status) => {
        seed(makeVisit({ status }));

        await expect(service.deny('visit-1', SCOPE, RESPONDER)).rejects.toThrow(
          ConflictException,
        );
        expect(statusOf('visit-1')).toBe(status);
      },
    );
  });

  describe('checkIn', () => {
    it.each([
      VisitStatus.AWAITING_APPROVAL,
      VisitStatus.DENIED,
      VisitStatus.COMPLETED,
      VisitStatus.CANCELLED,
      VisitStatus.EXPIRED,
      VisitStatus.ACTIVE,
    ])(
      'rechaza el check-in desde %s (409) sin registrar uso',
      async (status) => {
        seed(makeVisit({ status }));

        await expect(service.checkIn('visit-1')).rejects.toThrow(
          ConflictException,
        );
        expect(visitRepository.update).not.toHaveBeenCalled();
        expect(notificationsService.create).not.toHaveBeenCalled();
        expect(statusOf('visit-1')).toBe(status);
      },
    );

    it.each([VisitStatus.PENDING, VisitStatus.READY_FOR_REENTRY])(
      'acepta el check-in desde %s: ACTIVE, +1 uso, condicionado al estado y contador leídos',
      async (status) => {
        const usedBefore = status === VisitStatus.PENDING ? 0 : 1;
        seed(makeVisit({ status, maxUses: 3, usedCount: usedBefore }));

        const visit = await service.checkIn('visit-1');

        expect(visit.status).toBe(VisitStatus.ACTIVE);
        expect(statusOf('visit-1')).toBe(VisitStatus.ACTIVE);
        expect(rows.get('visit-1')?.usedCount).toBe(usedBefore + 1);
        expect(visitRepository.update).toHaveBeenCalledWith(
          { id: 'visit-1', status, usedCount: usedBefore },
          expect.objectContaining({
            status: VisitStatus.ACTIVE,
            usedCount: usedBefore + 1,
          }),
        );
      },
    );
  });

  describe('validateAccess (QR, lista blanca)', () => {
    it('una visita AWAITING_APPROVAL es inválida: "Visita pendiente de aprobación del residente"', async () => {
      seed(makeVisit({ status: VisitStatus.AWAITING_APPROVAL }));

      const result = await service.validateAccess('qr-1', 'qr');

      expect(result.valid).toBe(false);
      expect(result.message).toBe(
        'Visita pendiente de aprobación del residente',
      );
      expect(visitRepository.update).not.toHaveBeenCalled();
    });

    it.each([
      [VisitStatus.DENIED, 'Visita rechazada'],
      [VisitStatus.CANCELLED, 'Visita cancelada'],
      [VisitStatus.COMPLETED, 'Visita completada (sin usos disponibles)'],
      [VisitStatus.EXPIRED, 'Visita expirada'],
    ])('una visita %s es inválida (%s)', async (status, message) => {
      seed(makeVisit({ status }));

      const result = await service.validateAccess('qr-1', 'qr');

      expect(result).toEqual(
        expect.objectContaining({ valid: false, message }),
      );
    });

    it.each([
      VisitStatus.PENDING,
      VisitStatus.ACTIVE,
      VisitStatus.READY_FOR_REENTRY,
    ])('una visita %s dentro de su ventana es válida', async (status) => {
      seed(makeVisit({ status, maxUses: null }));

      const result = await service.validateAccess('qr-1', 'qr');

      expect(result.valid).toBe(true);
    });

    it('READY_FOR_REENTRY con los usos agotados -> inválida, sin escribir', async () => {
      seed(
        makeVisit({
          status: VisitStatus.READY_FOR_REENTRY,
          maxUses: 2,
          usedCount: 2,
        }),
      );

      const result = await service.validateAccess('qr-1', 'qr');

      expect(result).toEqual(
        expect.objectContaining({
          valid: false,
          message: 'Visita sin usos disponibles',
        }),
      );
      expect(visitRepository.update).not.toHaveBeenCalled();
    });

    it('fuera de la ventana: la marca EXPIRED con escritura condicionada y responde inválido', async () => {
      seed(
        makeVisit({
          status: VisitStatus.PENDING,
          validFrom: new Date(Date.now() - 7_200_000),
          validUntil: new Date(Date.now() - 3_600_000),
        }),
      );

      const result = await service.validateAccess('qr-1', 'qr');

      expect(result).toEqual(
        expect.objectContaining({ valid: false, message: 'Visita expirada' }),
      );
      expect(visitRepository.update).toHaveBeenCalledWith(
        { id: 'visit-1', status: VisitStatus.PENDING },
        { status: VisitStatus.EXPIRED },
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.EXPIRED);
    });
  });

  describe('findByPlate (LPR)', () => {
    it('filtra por LPR_MATCHABLE: AWAITING_APPROVAL nunca calza', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn<unknown, [string, Record<string, unknown>?]>(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      qb.leftJoinAndSelect.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);
      visitRepository.createQueryBuilder.mockReturnValue(qb);

      await service.findByPlate('ABCD12', { organizationId: ORG });

      const statusCall = qb.andWhere.mock.calls.find(
        (call) => call[0] === 'visit.status IN (:...statuses)',
      ) as [string, { statuses: VisitStatus[] }] | undefined;
      expect(statusCall).toBeDefined();
      expect([...(statusCall?.[1].statuses ?? [])].sort()).toEqual(
        [
          VisitStatus.PENDING,
          VisitStatus.ACTIVE,
          VisitStatus.READY_FOR_REENTRY,
        ].sort(),
      );
      expect(statusCall?.[1].statuses).not.toContain(
        VisitStatus.AWAITING_APPROVAL,
      );
    });
  });

  describe('update y cancel no saltan la máquina de estados', () => {
    it('update ignora entryTime/exitTime (las registran check-in/check-out) y NO cambia el estado', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      const saved = await service.update('visit-1', {
        visitorName: 'Otro Nombre',
        entryTime: new Date().toISOString(),
        exitTime: new Date().toISOString(),
      });

      expect(saved.status).toBe(VisitStatus.PENDING);
      expect(saved.entryTime).toBeNull();
      expect(saved.exitTime).toBeNull();
      expect(statusOf('visit-1')).toBe(VisitStatus.PENDING);
    });

    it('cancel de una solicitud AWAITING_APPROVAL -> 409 (se rechaza con deny, no se cancela)', async () => {
      seed(makeVisit({ status: VisitStatus.AWAITING_APPROVAL }));

      await expect(service.cancel('visit-1')).rejects.toThrow(
        ConflictException,
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.AWAITING_APPROVAL);
    });

    it('cancel de una visita PENDING sin usos -> CANCELLED', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      const cancelled = await service.cancel('visit-1');

      expect(cancelled.status).toBe(VisitStatus.CANCELLED);
      expect(statusOf('visit-1')).toBe(VisitStatus.CANCELLED);
    });
  });
  describe('checkIn: entrada ya registrada (seguridad B4)', () => {
    it('una visita ya ACTIVE -> VisitEntryAlreadyRegisteredException (409) sin escribir', async () => {
      seed(makeVisit({ status: VisitStatus.ACTIVE, usedCount: 1 }));

      const error: unknown = await service
        .checkIn('visit-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(VisitEntryAlreadyRegisteredException);
      expect(error).toBeInstanceOf(ConflictException);
      expect(visitRepository.update).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('check-in concurrente: el perdedor recibe 409 (entrada ya registrada) y solo se envía UNA notificación', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING, maxUses: 3 }));

      const results = await Promise.allSettled([
        service.checkIn('visit-1'),
        service.checkIn('visit-1'),
      ]);

      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(
        VisitEntryAlreadyRegisteredException,
      );
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(rows.get('visit-1')?.usedCount).toBe(1);
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkOut', () => {
    it.each([
      VisitStatus.PENDING,
      VisitStatus.READY_FOR_REENTRY,
      VisitStatus.AWAITING_APPROVAL,
      VisitStatus.COMPLETED,
      VisitStatus.CANCELLED,
      VisitStatus.EXPIRED,
      VisitStatus.DENIED,
    ])('desde %s -> 409 sin escribir', async (status) => {
      seed(makeVisit({ status }));

      await expect(service.checkOut('visit-1')).rejects.toThrow(
        ConflictException,
      );
      expect(visitRepository.update).not.toHaveBeenCalled();
      expect(statusOf('visit-1')).toBe(status);
    });

    it('con usos disponibles -> READY_FOR_REENTRY, condicionado a que siga ACTIVE', async () => {
      seed(makeVisit({ status: VisitStatus.ACTIVE, maxUses: 3, usedCount: 1 }));

      const visit = await service.checkOut('visit-1');

      expect(visit.status).toBe(VisitStatus.READY_FOR_REENTRY);
      expect(visitRepository.update).toHaveBeenCalledWith(
        { id: 'visit-1', status: VisitStatus.ACTIVE },
        expect.objectContaining({ status: VisitStatus.READY_FOR_REENTRY }),
      );
    });

    it('con los usos agotados -> COMPLETED', async () => {
      seed(makeVisit({ status: VisitStatus.ACTIVE, maxUses: 1, usedCount: 1 }));

      const visit = await service.checkOut('visit-1');

      expect(visit.status).toBe(VisitStatus.COMPLETED);
      expect(statusOf('visit-1')).toBe(VisitStatus.COMPLETED);
    });

    it('concurrencia: el perdedor recibe 409 (salida ya registrada) y solo se envía UNA notificación', async () => {
      seed(
        makeVisit({ status: VisitStatus.ACTIVE, maxUses: null, usedCount: 1 }),
      );

      const results = await Promise.allSettled([
        service.checkOut('visit-1'),
        service.checkOut('visit-1'),
      ]);

      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(
        VisitExitAlreadyRegisteredException,
      );
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect(statusOf('visit-1')).toBe(VisitStatus.READY_FOR_REENTRY);
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });

    it.each([VisitStatus.READY_FOR_REENTRY, VisitStatus.COMPLETED])(
      'salida ya registrada (%s) -> VisitExitAlreadyRegisteredException (409) sin escribir',
      async (status) => {
        seed(makeVisit({ status, usedCount: 1 }));

        const error: unknown = await service
          .checkOut('visit-1')
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(VisitExitAlreadyRegisteredException);
        expect(visitRepository.update).not.toHaveBeenCalled();
      },
    );

    it('UPDATE de 0 filas porque la visita expiró en el medio: 409 genérico, NO "salida ya registrada"', async () => {
      seed(
        makeVisit({ status: VisitStatus.ACTIVE, maxUses: null, usedCount: 1 }),
      );
      visitRepository.update.mockImplementationOnce(() => {
        const row = rows.get('visit-1');
        if (row) row.status = VisitStatus.EXPIRED;
        return Promise.resolve({ affected: 0, raw: [], generatedMaps: [] });
      });

      const error: unknown = await service
        .checkOut('visit-1')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error).not.toBeInstanceOf(VisitExitAlreadyRegisteredException);
      expect(notificationsService.create).not.toHaveBeenCalled();
    });
  });

  describe('cancel (409 uniforme para problemas de estado, QA B6)', () => {
    it.each([
      [VisitStatus.ACTIVE, 1],
      [VisitStatus.READY_FOR_REENTRY, 1],
      [VisitStatus.COMPLETED, 1],
      [VisitStatus.EXPIRED, 0],
      [VisitStatus.DENIED, 0],
      [VisitStatus.CANCELLED, 0],
    ])('desde %s -> 409 sin cambiarla', async (status, usedCount) => {
      seed(makeVisit({ status, usedCount }));

      await expect(service.cancel('visit-1')).rejects.toThrow(
        ConflictException,
      );
      expect(statusOf('visit-1')).toBe(status);
      expect(visitRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('update (PATCH, seguridad M1 / QA M3)', () => {
    it.each([
      VisitStatus.AWAITING_APPROVAL,
      VisitStatus.ACTIVE,
      VisitStatus.COMPLETED,
      VisitStatus.CANCELLED,
      VisitStatus.EXPIRED,
      VisitStatus.DENIED,
    ])('en %s -> 409 sin escribir', async (status) => {
      seed(makeVisit({ status, requestedPlate: 'ABCD12' }));

      await expect(
        service.update('visit-1', {
          visitorName: 'Otro Nombre',
          vehiclePlate: 'ZZZZ99',
        }),
      ).rejects.toThrow(ConflictException);
      expect(visitRepository.update).not.toHaveBeenCalled();
      expect(vehicleRepository.save).not.toHaveBeenCalled();
      expect(rows.get('visit-1')?.visitorName).toBe('Visitante Test');
    });

    it.each([VisitStatus.PENDING, VisitStatus.READY_FOR_REENTRY])(
      'en %s escribe un patch explícito: nunca status, usedCount, entryTime, exitTime ni qrCode',
      async (status) => {
        const entryTime = new Date(Date.now() - 30_000);
        const exitTime = new Date(Date.now() - 10_000);
        const usedCount = status === VisitStatus.PENDING ? 0 : 1;
        seed(
          makeVisit({
            status,
            usedCount,
            entryTime: status === VisitStatus.PENDING ? null : entryTime,
            exitTime: status === VisitStatus.PENDING ? null : exitTime,
          }),
        );

        const updated = await service.update('visit-1', {
          visitorName: 'Nombre Nuevo',
          reason: 'Motivo nuevo',
          entryTime: new Date().toISOString(),
          exitTime: new Date().toISOString(),
        });

        const [criteria, patch] = visitRepository.update.mock.calls[0] as [
          Record<string, unknown>,
          Record<string, unknown>,
        ];
        expect(criteria).toEqual({
          id: 'visit-1',
          organizationId: ORG,
          status,
          usedCount,
        });
        expect(patch).toEqual({
          visitorName: 'Nombre Nuevo',
          reason: 'Motivo nuevo',
        });
        for (const key of [
          'status',
          'usedCount',
          'entryTime',
          'exitTime',
          'qrCode',
        ]) {
          expect(patch).not.toHaveProperty(key);
        }
        expect(updated).toEqual(
          expect.objectContaining({
            visitorName: 'Nombre Nuevo',
            status,
            usedCount,
            qrCode: 'qr-1',
          }),
        );
        expect(rows.get('visit-1')?.entryTime).toEqual(
          status === VisitStatus.PENDING ? null : entryTime,
        );
      },
    );

    it('en carrera: si la visita cambia entre la lectura y la escritura -> 409, sin pisar status ni usedCount', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));
      // Un check-in concurrente entra mientras se arma el patch (después de
      // leer la visita PENDING y antes del UPDATE).
      usersService.findOne.mockImplementationOnce(() => {
        const row = rows.get('visit-1');
        if (row) {
          Object.assign(row, {
            status: VisitStatus.ACTIVE,
            usedCount: 1,
            entryTime: new Date(),
          });
        }
        return Promise.resolve(HOST as unknown as User);
      });

      await expect(
        service.update('visit-1', { hostId: 'host-1', visitorName: 'Otro' }),
      ).rejects.toThrow(ConflictException);
      expect(rows.get('visit-1')).toEqual(
        expect.objectContaining({
          status: VisitStatus.ACTIVE,
          usedCount: 1,
          visitorName: 'Visitante Test',
        }),
      );
    });

    it('con patente nueva: findOrCreateVisitorVehicle crea un Vehicle temporal válido para el LPR', async () => {
      seed(
        makeVisit({ status: VisitStatus.PENDING, type: VisitType.VEHICULAR }),
      );

      await service.update('visit-1', {
        vehiclePlate: 'WXYZ12',
        vehicleBrand: 'Toyota',
      });

      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plate: 'WXYZ12',
          brand: 'Toyota',
          vehicleType: null,
          accessLevel: 'visitante',
          active: true,
          owner: null,
        }),
      );
      expect(rows.get('visit-1')?.vehicle).toEqual({ id: 'vehicle-WXYZ12' });
    });

    it('con una patente ya registrada: la asocia sin modificar ese Vehicle (puede ser de un residente)', async () => {
      vehicles.set('WXYZ12', {
        id: 'vehicle-residente',
        plate: 'WXYZ12',
        vehicleType: 'residente',
      } as Vehicle);
      seed(
        makeVisit({ status: VisitStatus.PENDING, type: VisitType.VEHICULAR }),
      );

      await service.update('visit-1', {
        vehiclePlate: 'WXYZ12',
        vehicleColor: 'Rojo',
      });

      expect(vehicleRepository.save).not.toHaveBeenCalled();
      expect(rows.get('visit-1')?.vehicle).toEqual({ id: 'vehicle-residente' });
    });

    it('patente vacía: desasocia el vehículo', async () => {
      seed(
        makeVisit({
          status: VisitStatus.PENDING,
          type: VisitType.VEHICULAR,
          vehicle: { id: 'vehicle-1', plate: 'ABCD12' } as Vehicle,
        }),
      );

      await service.update('visit-1', { vehiclePlate: '' });

      expect(rows.get('visit-1')?.vehicle).toBeNull();
    });

    it('en carrera ABA: un ingreso + salida que la deja otra vez READY_FOR_REENTRY -> 409 (condicionado también a usedCount)', async () => {
      seed(
        makeVisit({
          status: VisitStatus.READY_FOR_REENTRY,
          maxUses: 3,
          usedCount: 1,
        }),
      );
      // Mientras se arma el patch, la visita entra y vuelve a salir: mismo
      // estado, un uso más.
      usersService.findOne.mockImplementationOnce(() => {
        const row = rows.get('visit-1');
        if (row) row.usedCount = 2;
        return Promise.resolve(HOST as unknown as User);
      });

      await expect(
        service.update('visit-1', { hostId: 'host-1', maxUses: 1 }),
      ).rejects.toThrow(ConflictException);
      expect(rows.get('visit-1')?.maxUses).toBe(3);
    });

    describe('cambio a peatonal (QA N6)', () => {
      it('type -> peatonal deja vehicle = null (el LPR deja de reconocerla)', async () => {
        seed(
          makeVisit({
            status: VisitStatus.PENDING,
            type: VisitType.VEHICULAR,
            vehicle: { id: 'vehicle-1', plate: 'ABCD12' } as Vehicle,
          }),
        );

        await service.update('visit-1', { type: VisitType.PEDESTRIAN });

        const [, patch] = visitRepository.update.mock.calls[0] as [
          unknown,
          Record<string, unknown>,
        ];
        expect(patch).toEqual({ type: VisitType.PEDESTRIAN, vehicle: null });
        expect(rows.get('visit-1')?.vehicle).toBeNull();
      });

      it('una patente en el mismo PATCH se ignora: no crea ni asocia vehículo', async () => {
        seed(
          makeVisit({
            status: VisitStatus.PENDING,
            type: VisitType.VEHICULAR,
            vehicle: { id: 'vehicle-1', plate: 'ABCD12' } as Vehicle,
          }),
        );

        await service.update('visit-1', {
          type: VisitType.PEDESTRIAN,
          vehiclePlate: 'WXYZ12',
        });

        expect(vehicleRepository.findOne).not.toHaveBeenCalled();
        expect(vehicleRepository.save).not.toHaveBeenCalled();
        expect(rows.get('visit-1')?.vehicle).toBeNull();
      });

      it('una visita vehicular que sigue vehicular conserva su vehículo', async () => {
        const vehicle = { id: 'vehicle-1', plate: 'ABCD12' } as Vehicle;
        seed(
          makeVisit({
            status: VisitStatus.PENDING,
            type: VisitType.VEHICULAR,
            vehicle,
          }),
        );

        await service.update('visit-1', { visitorName: 'Otro' });

        expect(rows.get('visit-1')?.vehicle).toEqual(vehicle);
      });
    });

    describe('maxUses vs usos registrados (QA N6)', () => {
      it('maxUses < usedCount -> 400 sin escribir', async () => {
        seed(
          makeVisit({
            status: VisitStatus.READY_FOR_REENTRY,
            maxUses: 5,
            usedCount: 3,
          }),
        );

        await expect(service.update('visit-1', { maxUses: 2 })).rejects.toThrow(
          BadRequestException,
        );
        expect(visitRepository.update).not.toHaveBeenCalled();
        expect(rows.get('visit-1')?.maxUses).toBe(5);
      });

      it('maxUses == usedCount se acepta (no quedan usos)', async () => {
        seed(
          makeVisit({
            status: VisitStatus.READY_FOR_REENTRY,
            maxUses: 5,
            usedCount: 3,
          }),
        );

        await service.update('visit-1', { maxUses: 3 });

        expect(rows.get('visit-1')?.maxUses).toBe(3);
      });

      it('maxUses null (ilimitado) se acepta', async () => {
        seed(
          makeVisit({
            status: VisitStatus.READY_FOR_REENTRY,
            maxUses: 5,
            usedCount: 3,
          }),
        );

        await service.update('visit-1', {
          maxUses: null as unknown as number,
        });

        expect(rows.get('visit-1')?.maxUses).toBeNull();
      });
    });

    it('ventana resultante inválida (inicio >= fin) -> 400 sin escribir', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      await expect(
        service.update('visit-1', {
          validFrom: new Date(Date.now() + 7_200_000).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(visitRepository.update).not.toHaveBeenCalled();
    });

    it('solo entryTime/exitTime (ignorados): no escribe y devuelve la visita sin cambios', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      const visit = await service.update('visit-1', {
        entryTime: new Date().toISOString(),
      });

      expect(visitRepository.update).not.toHaveBeenCalled();
      expect(visit.entryTime).toBeNull();
      expect(visit.status).toBe(VisitStatus.PENDING);
    });

    it('la respuesta incluye requestedPlate (contrato con el frontend)', async () => {
      seed(
        makeVisit({ status: VisitStatus.PENDING, requestedPlate: 'ABCD12' }),
      );

      const visit = await service.update('visit-1', { reason: 'Otro motivo' });

      expect(visit.requestedPlate).toBe('ABCD12');
    });

    describe('super-admin cambia el anfitrión (residual de P3, Fase 4 · P4)', () => {
      const HOST_SAME_ORG = {
        id: 'host-2',
        name: 'Host Dos',
        family: { id: 'family-2', organizationId: ORG },
      };
      const HOST_OTHER_ORG = {
        id: 'host-b',
        name: 'Host Ajeno',
        family: { id: 'family-b', organizationId: 'org-B' },
      };

      beforeEach(() => {
        tenantContext.getContext.mockResolvedValue({
          organizationId: null,
          isSuperAdmin: true,
        });
      });

      it('anfitrión de OTRO condominio que la visita -> 403 sin escribir', async () => {
        seed(makeVisit({ status: VisitStatus.PENDING }));
        usersService.findOne.mockResolvedValue(
          HOST_OTHER_ORG as unknown as User,
        );

        await expect(
          service.update('visit-1', { hostId: 'host-b' }),
        ).rejects.toThrow(ForbiddenException);
        expect(visitRepository.update).not.toHaveBeenCalled();
        expect(rows.get('visit-1')?.host).toEqual(HOST);
      });

      it('anfitrión del MISMO condominio que la visita -> se reasigna host y familia', async () => {
        seed(makeVisit({ status: VisitStatus.PENDING }));
        usersService.findOne.mockResolvedValue(
          HOST_SAME_ORG as unknown as User,
        );

        await service.update('visit-1', { hostId: 'host-2' });

        const [, patch] = visitRepository.update.mock.calls[0] as [
          Record<string, unknown>,
          Record<string, unknown>,
        ];
        expect(patch).toEqual({
          host: { id: 'host-2' },
          family: { id: 'family-2' },
        });
        expect(rows.get('visit-1')?.organizationId).toBe(ORG);
      });

      it('visita sin condominio: no admite cambio de anfitrión (fail-closed)', async () => {
        seed(makeVisit({ status: VisitStatus.PENDING, organizationId: null }));
        usersService.findOne.mockResolvedValue(
          HOST_SAME_ORG as unknown as User,
        );

        await expect(
          service.update('visit-1', { hostId: 'host-2' }),
        ).rejects.toThrow(ForbiddenException);
        expect(visitRepository.update).not.toHaveBeenCalled();
      });

      it('sin cambio de anfitrión, el super-admin edita otros campos igual que antes', async () => {
        seed(makeVisit({ status: VisitStatus.PENDING }));

        await service.update('visit-1', { visitorName: 'Nombre Nuevo' });

        expect(usersService.findOne).not.toHaveBeenCalled();
        expect(rows.get('visit-1')?.visitorName).toBe('Nombre Nuevo');
      });
    });
  });

  describe('QR solo al aprobar (seguridad B1)', () => {
    const pedestrianDto: CreateVisitDto = {
      type: VisitType.PEDESTRIAN,
      visitorName: 'Visitante Test',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      hostId: 'host-1',
    };

    it('create con AWAITING_APPROVAL no genera qrCode', async () => {
      const visit = await service.create(pedestrianDto, {
        initialStatus: VisitStatus.AWAITING_APPROVAL,
      });

      expect(visit.qrCode).toBeNull();
    });

    it('create directo en PENDING sigue generando el qrCode', async () => {
      const visit = await service.create(pedestrianDto);

      expect(visit.qrCode).toMatch(/^[0-9a-f]{32}$/);
    });

    it('approve genera el QR dentro de su transacción, en el mismo UPDATE del claim', async () => {
      seed(makeVisit({ qrCode: null }));

      const approved = await service.approve('visit-1', SCOPE, RESPONDER);

      expect(approved.qrCode).toMatch(/^[0-9a-f]{32}$/);
      const claim = writes.find(
        (write) => write.patch.status === VisitStatus.PENDING,
      );
      expect(claim?.inTransaction).toBe(true);
      expect(claim?.patch.qrCode).toBe(approved.qrCode);
    });

    it('un approve que pierde el claim (409) no deja ningún QR', async () => {
      seed(makeVisit({ status: VisitStatus.DENIED, qrCode: null }));

      await expect(
        service.approve('visit-1', SCOPE, RESPONDER),
      ).rejects.toThrow(ConflictException);
      expect(rows.get('visit-1')?.qrCode).toBeNull();
    });
  });

  describe('approve: requestedPlate como fuente de verdad y anfitrión que respondió (seguridad M2 / M1)', () => {
    it('vehicular: usa requestedPlate aunque la visita tenga otro vehicle asociado', async () => {
      seed(
        makeVisit({
          type: VisitType.VEHICULAR,
          requestedPlate: 'ABCD12',
          vehicle: { id: 'vehicle-otro', plate: 'ZZZZ99' } as Vehicle,
        }),
      );

      await service.approve('visit-1', SCOPE, RESPONDER);

      expect(rows.get('visit-1')?.vehicle).toEqual({ id: 'vehicle-ABCD12' });
      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'ABCD12' }),
      );
    });

    it('vehicular sin requestedPlate: queda sin vehículo, nunca con el que ya tenía', async () => {
      seed(
        makeVisit({
          type: VisitType.VEHICULAR,
          requestedPlate: null,
          vehicle: { id: 'vehicle-otro', plate: 'ZZZZ99' } as Vehicle,
        }),
      );

      await service.approve('visit-1', SCOPE, RESPONDER);

      expect(rows.get('visit-1')?.vehicle).toBeNull();
      expect(vehicleRepository.save).not.toHaveBeenCalled();
    });

    it('asigna como anfitrión al residente que respondió, en el mismo UPDATE condicionado', async () => {
      seed(makeVisit());

      const approved = await service.approve('visit-1', SCOPE, {
        ...RESPONDER,
        hostId: 'resident-2',
      });

      expect(visitRepository.update).toHaveBeenCalledWith(
        {
          id: 'visit-1',
          organizationId: ORG,
          status: VisitStatus.AWAITING_APPROVAL,
        },
        expect.objectContaining({
          status: VisitStatus.PENDING,
          host: { id: 'resident-2' },
        }),
      );
      expect(approved.host).toEqual({ id: 'resident-2' });
    });

    it('si pierde el claim, no reasigna el anfitrión', async () => {
      seed(makeVisit({ status: VisitStatus.DENIED }));

      await expect(
        service.approve('visit-1', SCOPE, {
          ...RESPONDER,
          hostId: 'resident-2',
        }),
      ).rejects.toThrow(ConflictException);
      expect(rows.get('visit-1')?.host).toEqual(HOST);
    });

    it('deny también deja como anfitrión al residente que respondió', async () => {
      seed(makeVisit());

      await service.deny('visit-1', SCOPE, {
        ...RESPONDER,
        hostId: 'resident-2',
      });

      expect(statusOf('visit-1')).toBe(VisitStatus.DENIED);
      expect(rows.get('visit-1')?.host).toEqual({ id: 'resident-2' });
    });
  });

  describe('respondedById / respondedAt (Fase 4 · P4, D5)', () => {
    it('approve los escribe en el MISMO UPDATE condicionado del claim (dentro de la transacción)', async () => {
      seed(makeVisit());
      const before = Date.now();

      const approved = await service.approve('visit-1', SCOPE, {
        respondedById: 'conserje-9',
      });

      const claim = writes.find(
        (write) => write.patch.status === VisitStatus.PENDING,
      );
      expect(claim?.inTransaction).toBe(true);
      expect(claim?.criteria).toEqual(
        expect.objectContaining({ status: VisitStatus.AWAITING_APPROVAL }),
      );
      expect(claim?.patch.respondedById).toBe('conserje-9');
      expect(claim?.patch.respondedAt).toBeInstanceOf(Date);
      expect(
        (claim?.patch.respondedAt as Date).getTime(),
      ).toBeGreaterThanOrEqual(before);
      // Sin hostId (no es un residente notificado): el anfitrión no cambia.
      expect(claim?.patch).not.toHaveProperty('host');
      expect(approved.respondedById).toBe('conserje-9');
      expect(approved.host).toEqual(HOST);
    });

    it('deny los escribe en el mismo UPDATE que pasa la visita a DENIED', async () => {
      seed(makeVisit());

      const denied = await service.deny('visit-1', SCOPE, {
        respondedById: 'resident-1',
        hostId: 'resident-1',
      });

      expect(visitRepository.update).toHaveBeenCalledWith(
        {
          id: 'visit-1',
          organizationId: ORG,
          status: VisitStatus.AWAITING_APPROVAL,
        },
        {
          status: VisitStatus.DENIED,
          respondedById: 'resident-1',
          respondedAt: expect.any(Date) as Date,
          host: { id: 'resident-1' },
        },
      );
      expect(denied.respondedById).toBe('resident-1');
      expect(denied.respondedAt).toBeInstanceOf(Date);
    });

    it('M1: approve y deny devuelven la visita leída DENTRO de la transacción del claim', async () => {
      seed(makeVisit(), makeVisit({ id: 'visit-2' }));

      await service.approve('visit-1', SCOPE, RESPONDER);
      await service.deny('visit-2', SCOPE, RESPONDER);

      expect(visitRepository.manager.transaction).toHaveBeenCalledTimes(2);
      expect(relationReads).toEqual([
        { inTransaction: true },
        { inTransaction: true },
      ]);
    });

    it('M1: si la relectura falla, approve lanza dentro de la transacción (se revierte) y no notifica', async () => {
      seed(makeVisit());
      const storeFindOne = visitRepository.findOne.getMockImplementation() as (
        options: unknown,
      ) => Promise<Visit | null>;
      visitRepository.findOne.mockImplementation((options: unknown) => {
        if ((options as { relations?: unknown }).relations) {
          return Promise.reject(new Error('lectura falló'));
        }
        return storeFindOne(options);
      });
      let failedInTransaction = false;
      visitRepository.manager.transaction.mockImplementationOnce(
        async (
          work: (manager: {
            getRepository: (entity: unknown) => unknown;
          }) => Promise<unknown>,
        ) => {
          try {
            return await work({
              getRepository: (entity: unknown) =>
                entity === Vehicle ? vehicleRepository : visitRepository,
            });
          } catch (error) {
            failedInTransaction = true;
            throw error;
          }
        },
      );

      await expect(
        service.approve('visit-1', SCOPE, RESPONDER),
      ).rejects.toThrow('lectura falló');
      expect(failedInTransaction).toBe(true);
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('findResolution: estado y quién respondió, acotado al tenant', async () => {
      seed(
        makeVisit({
          status: VisitStatus.PENDING,
          respondedById: 'resident-1',
        }),
        makeVisit({ id: 'visit-b', organizationId: 'org-B' }),
      );

      await expect(service.findResolution('visit-1', SCOPE)).resolves.toEqual({
        status: VisitStatus.PENDING,
        respondedById: 'resident-1',
      });
      await expect(
        service.findResolution('visit-b', SCOPE),
      ).resolves.toBeNull();
    });

    it('una respuesta que pierde el claim (409) no escribe respondedById ni respondedAt', async () => {
      seed(makeVisit({ status: VisitStatus.DENIED }));

      await expect(
        service.approve('visit-1', SCOPE, { respondedById: 'intruso' }),
      ).rejects.toThrow(ConflictException);
      expect(rows.get('visit-1')?.respondedById).toBeUndefined();
      expect(rows.get('visit-1')?.respondedAt).toBeUndefined();
    });
  });

  describe('expireRequest (fin de la sesión del conserje, QA B4)', () => {
    it('AWAITING_APPROVAL -> EXPIRED, condicionado al estado y al tenant', async () => {
      seed(makeVisit());

      await expect(service.expireRequest('visit-1', SCOPE)).resolves.toBe(true);
      expect(statusOf('visit-1')).toBe(VisitStatus.EXPIRED);
      expect(visitRepository.update).toHaveBeenCalledWith(
        {
          id: 'visit-1',
          organizationId: ORG,
          status: VisitStatus.AWAITING_APPROVAL,
        },
        { status: VisitStatus.EXPIRED },
      );
    });

    it.each([VisitStatus.PENDING, VisitStatus.ACTIVE, VisitStatus.DENIED])(
      'ya respondida (%s): no la toca',
      async (status) => {
        seed(makeVisit({ status }));

        await expect(service.expireRequest('visit-1', SCOPE)).resolves.toBe(
          false,
        );
        expect(statusOf('visit-1')).toBe(status);
      },
    );

    it('de otro condominio: no la toca', async () => {
      seed(makeVisit({ organizationId: 'org-B' }));

      await expect(service.expireRequest('visit-1', SCOPE)).resolves.toBe(
        false,
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.AWAITING_APPROVAL);
    });
  });

  describe('notificaciones best-effort (QA M2 / seguridad B3)', () => {
    beforeEach(() => {
      notificationsService.create.mockRejectedValue(new Error('smtp caído'));
    });

    it('approve: la aprobación se confirma aunque falle la notificación', async () => {
      seed(makeVisit());

      await expect(
        service.approve('visit-1', SCOPE, RESPONDER),
      ).resolves.toEqual(
        expect.objectContaining({ status: VisitStatus.PENDING }),
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.PENDING);
    });

    it('checkIn: la entrada queda registrada aunque falle la notificación', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      await expect(service.checkIn('visit-1')).resolves.toEqual(
        expect.objectContaining({ status: VisitStatus.ACTIVE }),
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.ACTIVE);
    });

    it('checkOut: la salida queda registrada aunque falle la notificación', async () => {
      seed(
        makeVisit({ status: VisitStatus.ACTIVE, maxUses: null, usedCount: 1 }),
      );

      await expect(service.checkOut('visit-1')).resolves.toEqual(
        expect.objectContaining({ status: VisitStatus.READY_FOR_REENTRY }),
      );
    });

    it('create: la visita se crea aunque falle la notificación', async () => {
      await expect(
        service.create({
          type: VisitType.PEDESTRIAN,
          visitorName: 'Visitante Test',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 3_600_000).toISOString(),
          hostId: 'host-1',
        }),
      ).resolves.toEqual(
        expect.objectContaining({ status: VisitStatus.PENDING }),
      );
    });

    it('markExpired (validateAccess fuera de la ventana): queda EXPIRED y responde inválido aunque falle la notificación', async () => {
      seed(
        makeVisit({
          status: VisitStatus.PENDING,
          validFrom: new Date(Date.now() - 7_200_000),
          validUntil: new Date(Date.now() - 3_600_000),
        }),
      );

      await expect(service.validateAccess('qr-1', 'qr')).resolves.toEqual(
        expect.objectContaining({ valid: false, message: 'Visita expirada' }),
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.EXPIRED);
      expect(notificationsService.create).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Seguridad (bajo): con el anfitrión deshabilitado (`UsersService.disable`
   * es un soft-delete) el join deja `visit.host` en null. Antes `host.id`
   * lanzaba TypeError DESPUÉS del claim: la transición quedaba hecha pero el
   * caller recibía un error (el LPR no abría una entrada ya registrada).
   */
  describe('anfitrión deshabilitado (visit.host null)', () => {
    let warn: jest.SpyInstance;
    /** Lo que deja el join cuando el anfitrión está deshabilitado. */
    const disabledHost = null as unknown as User;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    function expectNotificationSkipped(): void {
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('sin anfitrión activo'),
      );
    }

    it('checkIn: la entrada queda registrada, sin excepción ni notificación', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING, host: disabledHost }));

      await expect(service.checkIn('visit-1')).resolves.toEqual(
        expect.objectContaining({ status: VisitStatus.ACTIVE }),
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.ACTIVE);
      expectNotificationSkipped();
    });

    it('checkOut: la salida queda registrada, sin excepción ni notificación', async () => {
      seed(
        makeVisit({
          status: VisitStatus.ACTIVE,
          maxUses: null,
          usedCount: 1,
          host: disabledHost,
        }),
      );

      await expect(service.checkOut('visit-1')).resolves.toEqual(
        expect.objectContaining({ status: VisitStatus.READY_FOR_REENTRY }),
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.READY_FOR_REENTRY);
      expectNotificationSkipped();
    });

    it('markExpired: queda EXPIRED, sin excepción ni notificación', async () => {
      seed(
        makeVisit({
          status: VisitStatus.PENDING,
          host: disabledHost,
          validFrom: new Date(Date.now() - 7_200_000),
          validUntil: new Date(Date.now() - 3_600_000),
        }),
      );

      await expect(service.validateAccess('qr-1', 'qr')).resolves.toEqual(
        expect.objectContaining({ valid: false, message: 'Visita expirada' }),
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.EXPIRED);
      expectNotificationSkipped();
    });

    it('approve: la aprobación queda hecha, sin excepción ni notificación', async () => {
      seed(makeVisit({ host: disabledHost }));

      await expect(
        service.approve('visit-1', SCOPE, RESPONDER),
      ).resolves.toEqual(
        expect.objectContaining({ status: VisitStatus.PENDING }),
      );
      expect(statusOf('visit-1')).toBe(VisitStatus.PENDING);
      expectNotificationSkipped();
    });
  });

  describe('findOrCreateVisitorVehicle por condominio (Fase 4 · P5.B)', () => {
    /** El store de vehículos respeta el condominio del `where`. */
    function vehiclesScopedByOrganization(): void {
      vehicleRepository.findOne.mockImplementation((options: unknown) => {
        const where = whereOf(options);
        const found = vehicles.get(where.plate as string);
        return Promise.resolve(
          found && found.organizationId === where.organizationId ? found : null,
        );
      });
    }

    it('busca la patente en el condominio de la visita y crea el temporal estampado con ese condominio', async () => {
      seed(
        makeVisit({ status: VisitStatus.PENDING, type: VisitType.VEHICULAR }),
      );

      await service.update('visit-1', { vehiclePlate: 'WXYZ12' });

      expect(vehicleRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { plate: 'WXYZ12', organizationId: ORG },
        }),
      );
      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plate: 'WXYZ12',
          organizationId: ORG,
          vehicleType: null,
          accessLevel: VehicleAccessLevel.VISITOR,
        }),
      );
    });

    it('la misma patente registrada en OTRO condominio no se asocia: crea la del condominio de la visita', async () => {
      vehicles.set('WXYZ12', {
        id: 'vehicle-de-b',
        plate: 'WXYZ12',
        organizationId: 'org-B',
        vehicleType: 'residente',
      } as Vehicle);
      vehiclesScopedByOrganization();
      seed(
        makeVisit({ status: VisitStatus.PENDING, type: VisitType.VEHICULAR }),
      );

      await service.update('visit-1', { vehiclePlate: 'WXYZ12' });

      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'WXYZ12', organizationId: ORG }),
      );
      expect(rows.get('visit-1')?.vehicle).not.toEqual({ id: 'vehicle-de-b' });
    });

    it('approve: el vehículo de requestedPlate queda en el condominio de la visita', async () => {
      seed(makeVisit({ type: VisitType.VEHICULAR, requestedPlate: 'ABCD12' }));

      await service.approve('visit-1', SCOPE, RESPONDER);

      expect(vehicleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'ABCD12', organizationId: ORG }),
      );
    });

    it('carrera: si otra request creó la patente (UNIQUE por condominio), reutiliza esa', async () => {
      seed(
        makeVisit({ status: VisitStatus.PENDING, type: VisitType.VEHICULAR }),
      );
      const created = {
        id: 'vehicle-concurrente',
        plate: 'WXYZ12',
        organizationId: ORG,
      } as Vehicle;
      vehicleRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(created);
      vehicleRepository.save.mockRejectedValueOnce(
        new QueryFailedError(
          'INSERT INTO "vehicles"',
          [],
          Object.assign(new Error('duplicate key'), { code: '23505' }),
        ),
      );

      await service.update('visit-1', { vehiclePlate: 'WXYZ12' });

      expect(rows.get('visit-1')?.vehicle).toEqual({
        id: 'vehicle-concurrente',
      });
    });
  });

  describe('usuario sin condominio (seguridad A1; P5.C: vacío, sin el "cajón nulo")', () => {
    beforeEach(() => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: false,
      });
    });

    function lastFindOneWhere(): Record<string, unknown> {
      const calls = visitRepository.findOne.mock.calls as unknown[][];
      return whereOf(calls[calls.length - 1]?.[0]);
    }

    it('findOne: no ve la visita de otro condominio (404) y filtra con In([])', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      await expect(service.findOne('visit-1')).rejects.toThrow(
        NotFoundException,
      );
      const organizationId = lastFindOneWhere().organizationId;
      expect(organizationId).toBeInstanceOf(FindOperator);
      expect((organizationId as FindOperator<unknown>).type).toBe('in');
    });

    it('findByQRCode: tampoco ve la visita de otro condominio', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      await expect(service.findByQRCode('qr-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('update: sin condominio no puede editar ninguna visita (403, ni siquiera la lee)', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING }));

      await expect(
        service.update('visit-1', { visitorName: 'Intruso' }),
      ).rejects.toThrow(ForbiddenException);
      expect(visitRepository.findOne).not.toHaveBeenCalled();
      expect(visitRepository.update).not.toHaveBeenCalled();
    });

    it('create: sin condominio -> 403 (antes estampaba el condominio del anfitrión)', async () => {
      await expect(
        service.create({
          type: VisitType.VEHICULAR,
          visitorName: 'Intruso',
          validFrom: new Date().toISOString(),
          validUntil: new Date(Date.now() + 3_600_000).toISOString(),
          hostId: 'host-1',
          vehiclePlate: 'BBCD12',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(rows.size).toBe(0);
    });

    it('P5.C: tampoco ve las visitas del "cajón nulo" (sin condominio)', async () => {
      seed(makeVisit({ status: VisitStatus.PENDING, organizationId: null }));

      await expect(service.findOne('visit-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

/**
 * D3: `status` salió de los DTO públicos. Se valida con un `ValidationPipe`
 * configurado igual que el global de `main.ts` (whitelist +
 * forbidNonWhitelisted + transform).
 */
describe('DTO de visitas sin status (Fase 4 · P3, D3)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const createBody = {
    type: VisitType.PEDESTRIAN,
    visitorName: 'Visitante Test',
    validFrom: '2026-10-08T10:00:00.000Z',
    validUntil: '2026-10-08T20:00:00.000Z',
    hostId: '123e4567-e89b-42d3-a456-426614174000',
  };

  const bodyOf = (
    metatype: ArgumentMetadata['metatype'],
  ): ArgumentMetadata => ({
    type: 'body',
    metatype,
  });

  it('CreateVisitDto acepta un body válido sin status', async () => {
    await expect(
      pipe.transform(createBody, bodyOf(CreateVisitDto)),
    ).resolves.toBeInstanceOf(CreateVisitDto);
  });

  it('CreateVisitDto rechaza status (400)', async () => {
    await expect(
      pipe.transform(
        { ...createBody, status: VisitStatus.ACTIVE },
        bodyOf(CreateVisitDto),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('UpdateVisitDto rechaza status (400)', async () => {
    await expect(
      pipe.transform({ status: VisitStatus.COMPLETED }, bodyOf(UpdateVisitDto)),
    ).rejects.toThrow(BadRequestException);
  });

  it('UpdateVisitDto sigue aceptando los campos editables', async () => {
    await expect(
      pipe.transform({ visitorName: 'Otro Nombre' }, bodyOf(UpdateVisitDto)),
    ).resolves.toBeInstanceOf(UpdateVisitDto);
  });
});
