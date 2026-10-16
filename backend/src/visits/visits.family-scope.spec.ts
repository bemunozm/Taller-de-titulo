import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { join } from 'path';
import {
  DataSource,
  FindOperator,
  SelectQueryBuilder,
  type Repository,
} from 'typeorm';
import { VisitsService } from './visits.service';
import { Visit, VisitStatus, VisitType } from './entities/visit.entity';
import type { CreateVisitDto } from './dto/create-visit.dto';
import type { UsersService } from '../users/users.service';
import type { FamiliesService } from '../families/families.service';
import type { VehiclesService } from '../vehicles/vehicles.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { TenantActor } from '../common/tenant/tenant-actor';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import type { User } from '../users/entities/user.entity';

const ORG = 'org-A';
const OWN_FAMILY = 'family-own';
const NEIGHBOR_FAMILY = 'family-neighbor';
const CTX: TenantContext = { organizationId: ORG, isSuperAdmin: false };

function actor(
  userId: string,
  familyId: string | null,
  permissions: string[],
): TenantActor {
  return {
    userId,
    organizationId: ORG,
    isSuperAdmin: false,
    permissionNames: new Set(permissions),
    familyId,
  };
}

/** Residente de la familia propia (sin `condominium.view-all`). */
const RESIDENT = actor('res-1', OWN_FAMILY, ['visits.read', 'visits.create']);
/** Otro miembro de la misma familia. */
const RELATIVE = actor('res-2', OWN_FAMILY, ['visits.read']);
/** Residente sin familia: solo lo propio. */
const LONE_RESIDENT = actor('res-solo', null, ['visits.read', 'visits.create']);
/** Conserje y Administrador: ven todo el condominio (`condominium.view-all`). */
const CONCIERGE = actor('conserje', null, [
  'visits.read',
  'condominium.view-all',
]);
const ADMIN = actor('admin', null, [
  'visits.read',
  'visits.update',
  'condominium.view-all',
]);
/** Administrador con `users.update`: ve el detalle de los usuarios embebidos. */
const ADMIN_WITH_USERS = actor('admin', null, [
  'visits.read',
  'users.update',
  'condominium.view-all',
]);

const users: Record<string, User> = {
  'res-1': {
    id: 'res-1',
    name: 'Residente',
    family: { id: OWN_FAMILY, organizationId: ORG },
  } as unknown as User,
  'res-2': {
    id: 'res-2',
    name: 'Pariente',
    family: { id: OWN_FAMILY, organizationId: ORG },
  } as unknown as User,
  neighbor: {
    id: 'neighbor',
    name: 'Vecino',
    family: { id: NEIGHBOR_FAMILY, organizationId: ORG },
  } as unknown as User,
  'res-solo': {
    id: 'res-solo',
    name: 'Sin familia',
    family: null,
  } as unknown as User,
};

/**
 * Fase 4 · P5.C — alcance por familia de las visitas (`condominium.view-all`)
 * y `qrCode` solo para la familia del anfitrión. Reemplaza al
 * `UserFilterInterceptor` (por nombre de rol; un no-admin sin familia quedaba
 * SIN filtro).
 */
describe('VisitsService — alcance por familia y qrCode (P5.C)', () => {
  let rows: Map<string, Visit>;
  let visitRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let usersService: {
    findOne: jest.Mock;
    isActiveMemberOfOrganization: jest.Mock;
    findByFamily: jest.Mock;
  };
  /** Vehículos registrados (por patente) que reutiliza `findOrCreateVisitorVehicle`. */
  let vehicleRows: Map<string, Vehicle>;
  let vehicleRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let tenantContext: { getContext: jest.Mock<Promise<TenantContext>, []> };
  let service: VisitsService;

  function matches(row: object, criteria: Record<string, unknown>): boolean {
    const record = row as Record<string, unknown>;
    return Object.entries(criteria).every(([key, expected]) => {
      if (expected instanceof FindOperator) {
        if (expected.type === 'in') {
          return (expected.value as unknown[]).includes(record[key]);
        }
        throw new Error(`Operador no soportado: ${expected.type}`);
      }
      return record[key] === expected;
    });
  }

  function makeVisit(
    id: string,
    host: User,
    overrides: Partial<Visit> = {},
  ): Visit {
    const now = Date.now();
    return {
      id,
      organizationId: ORG,
      type: VisitType.PEDESTRIAN,
      status: VisitStatus.PENDING,
      visitorName: `Visita ${id}`,
      qrCode: `qr-${id}`,
      maxUses: 1,
      usedCount: 0,
      validFrom: new Date(now - 60_000),
      validUntil: new Date(now + 3_600_000),
      entryTime: null,
      exitTime: null,
      host,
      family: host.family,
      vehicle: null,
      ...overrides,
    } as unknown as Visit;
  }

  beforeEach(() => {
    rows = new Map(
      [
        makeVisit('own', users['res-1']),
        makeVisit('relative', users['res-2']),
        makeVisit('neighbor', users.neighbor),
        makeVisit('lone', users['res-solo']),
      ].map((visit) => [visit.id, visit]),
    );
    visitRepository = {
      findOne: jest.fn((options: { where: Record<string, unknown> }) => {
        const row = [...rows.values()].find((r) => matches(r, options.where));
        return Promise.resolve(row ? { ...row } : null);
      }),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(
        (criteria: Record<string, unknown>, patch: Partial<Visit>) => {
          let affected = 0;
          for (const row of rows.values()) {
            if (matches(row, criteria)) {
              Object.assign(row, patch);
              affected++;
            }
          }
          return Promise.resolve({ affected });
        },
      ),
      create: jest.fn((data: Partial<Visit>) => ({ ...data }) as Visit),
      save: jest.fn((visit: Visit) =>
        Promise.resolve({ ...visit, id: visit.id ?? 'visit-new' }),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    usersService = {
      findOne: jest.fn((id: string) => Promise.resolve(users[id] ?? null)),
      isActiveMemberOfOrganization: jest.fn().mockResolvedValue(true),
      findByFamily: jest.fn((familyId: string) =>
        Promise.resolve(
          Object.values(users).filter((user) => user.family?.id === familyId),
        ),
      ),
    };
    // El auto del vecino (con su PII completa: `Vehicle.owner` es eager).
    vehicleRows = new Map([
      [
        'VECI22',
        {
          id: 'veh-neighbor',
          organizationId: ORG,
          plate: 'VECI22',
          accessLevel: 'residente',
          ownerId: 'neighbor',
          owner: {
            id: 'neighbor',
            name: 'Vecino',
            email: 'vecino@x.cl',
            rut: '22222222-2',
            phone: '+56922222222',
          },
        } as unknown as Vehicle,
      ],
    ]);
    vehicleRepository = {
      findOne: jest.fn((options: { where: { plate: string } }) => {
        const vehicle = vehicleRows.get(options.where.plate);
        return Promise.resolve(
          vehicle ? { ...vehicle, owner: { ...vehicle.owner } } : null,
        );
      }),
      create: jest.fn((data: Partial<Vehicle>) => ({ ...data }) as Vehicle),
      save: jest.fn((vehicle: Vehicle) =>
        Promise.resolve({ ...vehicle, id: 'veh-new' }),
      ),
    };
    tenantContext = {
      getContext: jest.fn<Promise<TenantContext>, []>().mockResolvedValue(CTX),
    };
    service = new VisitsService(
      visitRepository as unknown as Repository<Visit>,
      vehicleRepository as unknown as Repository<Vehicle>,
      usersService as unknown as UsersService,
      {} as FamiliesService,
      {} as VehiclesService,
      {
        create: jest.fn().mockResolvedValue({}),
      } as unknown as NotificationsService,
      tenantContext as unknown as TenantContextService,
    );
  });

  describe('GET /visits/:id', () => {
    it('residente: la de su familia sí (con qrCode); la de un vecino del mismo condominio -> 404', async () => {
      await expect(
        service.findOneForActor('relative', RESIDENT),
      ).resolves.toEqual(
        expect.objectContaining({ id: 'relative', qrCode: 'qr-relative' }),
      );
      await expect(
        service.findOneForActor('neighbor', RESIDENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('residente sin familia: solo las suyas (anfitrión = él)', async () => {
      await expect(
        service.findOneForActor('lone', LONE_RESIDENT),
      ).resolves.toEqual(
        expect.objectContaining({ id: 'lone', qrCode: 'qr-lone' }),
      );
      await expect(
        service.findOneForActor('own', LONE_RESIDENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('Conserje y Administrador ven la visita, pero con qrCode null (no son de la familia del anfitrión)', async () => {
      for (const viewer of [CONCIERGE, ADMIN]) {
        await expect(service.findOneForActor('own', viewer)).resolves.toEqual(
          expect.objectContaining({ id: 'own', qrCode: null }),
        );
      }
    });

    it('corrección P5 (cyber B3): sin users.update el anfitrión va como { id, name }', async () => {
      const visit = await service.findOneForActor('own', CONCIERGE);
      expect(visit.host).toEqual({ id: 'res-1', name: 'Residente' });
    });

    it('el anfitrión ve su qrCode aunque la visita no tenga familia', async () => {
      await expect(
        service.findOneForActor('lone', LONE_RESIDENT),
      ).resolves.toEqual(expect.objectContaining({ qrCode: 'qr-lone' }));
    });
  });

  it('GET /visits/qr/:qrCode de un vecino -> 404; de su familia -> con qrCode', async () => {
    await expect(
      service.findByQRCodeForActor('qr-neighbor', RESIDENT),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.findByQRCodeForActor('qr-own', RELATIVE),
    ).resolves.toEqual(expect.objectContaining({ qrCode: 'qr-own' }));
    // El conserje que escanea el QR no lo recibe de vuelta.
    await expect(
      service.findByQRCodeForActor('qr-own', CONCIERGE),
    ).resolves.toEqual(expect.objectContaining({ qrCode: null }));
  });

  describe('escrituras sobre la visita de un vecino -> 404 sin tocarla', () => {
    it('PATCH', async () => {
      await expect(
        service.updateForActor('neighbor', { visitorName: 'Otro' }, RESIDENT),
      ).rejects.toThrow(NotFoundException);
      expect(visitRepository.update).not.toHaveBeenCalled();
    });

    it('cancel', async () => {
      await expect(
        service.cancelForActor('neighbor', RESIDENT),
      ).rejects.toThrow(NotFoundException);
      expect(visitRepository.update).not.toHaveBeenCalled();
    });

    it('DELETE', async () => {
      await expect(
        service.removeForActor('neighbor', RESIDENT),
      ).rejects.toThrow(NotFoundException);
      expect(visitRepository.remove).not.toHaveBeenCalled();
    });
  });

  it('PATCH de su visita: edita; reasignar el anfitrión a un vecino -> 403', async () => {
    await expect(
      service.updateForActor('own', { visitorName: 'Nuevo nombre' }, RESIDENT),
    ).resolves.toEqual(
      expect.objectContaining({ visitorName: 'Nuevo nombre' }),
    );

    visitRepository.update.mockClear();
    await expect(
      service.updateForActor('own', { hostId: 'neighbor' }, RESIDENT),
    ).rejects.toThrow(ForbiddenException);
    expect(visitRepository.update).not.toHaveBeenCalled();
  });

  it('cancel de una visita de su familia: la cancela y la respuesta trae el qrCode', async () => {
    await expect(service.cancelForActor('relative', RESIDENT)).resolves.toEqual(
      expect.objectContaining({
        status: VisitStatus.CANCELLED,
        qrCode: 'qr-relative',
      }),
    );
  });

  describe('POST /visits (anfitrión del alcance por familia)', () => {
    const dto = (hostId: string): CreateVisitDto => ({
      type: VisitType.PEDESTRIAN,
      visitorName: 'Visitante',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      hostId,
    });

    it('residente: para un vecino -> 403 sin crear nada', async () => {
      await expect(
        service.createForActor(dto('neighbor'), RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(visitRepository.save).not.toHaveBeenCalled();
    });

    it('residente: para sí mismo o un miembro de su familia -> crea', async () => {
      await expect(
        service.createForActor(dto('res-1'), RESIDENT),
      ).resolves.toEqual(expect.objectContaining({ organizationId: ORG }));
      await expect(
        service.createForActor(dto('res-2'), RESIDENT),
      ).resolves.toEqual(expect.objectContaining({ organizationId: ORG }));
    });

    it('residente sin familia: solo para sí mismo (validado por su membresía en el condominio)', async () => {
      await expect(
        service.createForActor(dto('res-solo'), LONE_RESIDENT),
      ).resolves.toEqual(expect.objectContaining({ organizationId: ORG }));
      expect(usersService.isActiveMemberOfOrganization).toHaveBeenCalledWith(
        'res-solo',
        ORG,
      );
      await expect(
        service.createForActor(dto('res-1'), LONE_RESIDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('anfitrión sin familia que NO es miembro activo del condominio -> 403', async () => {
      usersService.isActiveMemberOfOrganization.mockResolvedValue(false);

      await expect(
        service.createForActor(dto('res-solo'), LONE_RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(visitRepository.save).not.toHaveBeenCalled();
    });

    it('con condominium.view-all (Conserje): para cualquier residente del condominio', async () => {
      await expect(
        service.createForActor(dto('neighbor'), CONCIERGE),
      ).resolves.toEqual(expect.objectContaining({ organizationId: ORG }));
    });

    it('corrección P5 (QA A1): el Conserje que crea la visita de otro recibe qrCode null', async () => {
      const created = await service.createForActor(dto('neighbor'), CONCIERGE);
      expect(created.qrCode).toBeNull();
      // El QR se generó igual (lo recibe la familia del anfitrión).
      const [saved] = visitRepository.save.mock.calls[0] as [Visit];
      expect(saved.qrCode).toEqual(expect.any(String));
    });

    it('corrección P5 (QA A1): el residente que crea su propia visita (o la de su familia) recibe el QR', async () => {
      const own = await service.createForActor(dto('res-1'), RESIDENT);
      expect(own.qrCode).toEqual(expect.any(String));
      const relative = await service.createForActor(dto('res-2'), RESIDENT);
      expect(relative.qrCode).toEqual(expect.any(String));
    });

    it('corrección P5 (cyber B3): el anfitrión embebido va como { id, name } para quien no tiene users.update', async () => {
      const created = await service.createForActor(dto('neighbor'), CONCIERGE);
      expect(created.host).toEqual({ id: 'neighbor', name: 'Vecino' });

      const forAdmin = await service.createForActor(
        dto('neighbor'),
        ADMIN_WITH_USERS,
      );
      // Con users.update el anfitrión va completo (incluida su familia).
      expect(forAdmin.host).toBe(users.neighbor);
    });

    it('super-admin con un anfitrión sin familia de un condominio -> 400 (antes la visita quedaba sin condominio)', async () => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: true,
      });

      await expect(
        service.createForActor(dto('res-solo'), {
          ...ADMIN,
          organizationId: null,
          isSuperAdmin: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(visitRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('corrección P5 (cyber N2): propietario del vehículo de una visita', () => {
    const vehicularDto = (hostId: string, plate: string): CreateVisitDto => ({
      type: VisitType.VEHICULAR,
      visitorName: 'Visitante en auto',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
      hostId,
      vehiclePlate: plate,
    });

    it('ResA1 crea una visita con la patente del auto de un vecino: no recibe su email, RUT ni teléfono', async () => {
      const created = await service.createForActor(
        vehicularDto('res-1', 'VECI22'),
        RESIDENT,
      );

      expect(created.vehicle?.id).toBe('veh-neighbor');
      expect(created.vehicle?.owner).toBeNull();
      expect(created.vehicle?.ownerId).toBeNull();
      expect(JSON.stringify(created)).not.toMatch(
        /vecino@x\.cl|22222222-2|\+56922222222/,
      );
    });

    it('el Conserje (sin users.update) recibe el propietario resumido { id, name }', async () => {
      const created = await service.createForActor(
        vehicularDto('neighbor', 'VECI22'),
        CONCIERGE,
      );

      expect(created.vehicle?.owner).toEqual({
        id: 'neighbor',
        name: 'Vecino',
      });
    });

    it('si el auto es de su familia, el residente ve el propietario (resumido)', async () => {
      vehicleRows.set('FAMI11', {
        ...vehicleRows.get('VECI22'),
        id: 'veh-relative',
        plate: 'FAMI11',
        ownerId: 'res-2',
        owner: { id: 'res-2', name: 'Pariente', email: 'p@x.cl' },
      } as unknown as Vehicle);

      const created = await service.createForActor(
        vehicularDto('res-1', 'FAMI11'),
        RESIDENT,
      );

      expect(usersService.findByFamily).toHaveBeenCalledWith(OWN_FAMILY);
      expect(created.vehicle?.owner).toEqual({ id: 'res-2', name: 'Pariente' });
    });

    /**
     * Fase 4 · P6.R: `GET /visits` y `/visits/plate` arman la consulta con
     * QueryBuilder, que NO carga la relación eager `vehicle.owner`: la
     * visita llega con `ownerId` pero sin `owner`, y antes el `ownerId`
     * del vecino salía tal cual.
     */
    describe('QueryBuilder (vehicle.owner sin cargar, solo ownerId)', () => {
      /** Visita vehicular de la familia propia con el auto (sin owner) de `ownerId`. */
      function visitWithVehicleOf(ownerId: string): Visit {
        return {
          ...rows.get('own'),
          type: VisitType.VEHICULAR,
          vehicle: {
            id: 'veh-qb',
            plate: 'QBQB11',
            ownerId,
          } as unknown as Vehicle,
        } as Visit;
      }

      function queryBuilderReturning(visit: Visit) {
        const qb: Record<string, jest.Mock> = {};
        for (const method of [
          'leftJoinAndSelect',
          'orderBy',
          'where',
          'andWhere',
        ]) {
          qb[method] = jest.fn(() => qb);
        }
        qb.getMany = jest.fn(() => Promise.resolve([visit]));
        qb.getOne = jest.fn(() => Promise.resolve(visit));
        (
          visitRepository as unknown as { createQueryBuilder: jest.Mock }
        ).createQueryBuilder = jest.fn(() => qb);
        return qb;
      }

      it('GET /visits: el residente no recibe el ownerId del vecino', async () => {
        queryBuilderReturning(visitWithVehicleOf('neighbor'));

        const [visit] = await service.findAllForActor({}, RESIDENT);

        expect(visit.vehicle?.ownerId).toBeNull();
        expect(visit.vehicle?.owner).toBeNull();
        expect(JSON.stringify(visit)).not.toContain('neighbor');
      });

      it('GET /visits/plate/:plate: tampoco', async () => {
        queryBuilderReturning(visitWithVehicleOf('neighbor'));

        const visit = await service.findByPlateForActor('QBQB11', RESIDENT);

        expect(visit.vehicle?.ownerId).toBeNull();
        expect(JSON.stringify(visit)).not.toContain('neighbor');
      });

      it('si el auto es de su familia, el residente conserva el ownerId', async () => {
        queryBuilderReturning(visitWithVehicleOf('res-2'));

        const [visit] = await service.findAllForActor({}, RESIDENT);

        expect(usersService.findByFamily).toHaveBeenCalledWith(OWN_FAMILY);
        expect(visit.vehicle?.ownerId).toBe('res-2');
      });

      it('residente sin familia: solo conserva el ownerId si el auto es suyo', async () => {
        queryBuilderReturning(visitWithVehicleOf('res-1'));
        const [foreign] = await service.findAllForActor({}, LONE_RESIDENT);
        expect(foreign.vehicle?.ownerId).toBeNull();

        queryBuilderReturning(visitWithVehicleOf('res-solo'));
        const [own] = await service.findAllForActor({}, LONE_RESIDENT);
        expect(own.vehicle?.ownerId).toBe('res-solo');
      });

      it('Conserje (condominium.view-all): conserva el ownerId', async () => {
        queryBuilderReturning(visitWithVehicleOf('neighbor'));

        const [visit] = await service.findAllForActor({}, CONCIERGE);

        expect(visit.vehicle?.ownerId).toBe('neighbor');
      });

      it('camino LPR (findByPlate con organizationId, sin actor): no cambia, devuelve la entidad tal cual', async () => {
        const qb = queryBuilderReturning(visitWithVehicleOf('neighbor'));

        const visit = await service.findByPlate('QBQB11', {
          organizationId: ORG,
        });

        expect(visit?.vehicle?.ownerId).toBe('neighbor');
        // Sin join extra al propietario.
        const joins = qb.leftJoinAndSelect.mock.calls.map(
          (call: unknown[]) => call[0],
        );
        expect(joins).toEqual(['visit.vehicle', 'visit.host', 'visit.family']);
      });
    });

    it('también en las lecturas (GET /visits/:id) y en la validación', async () => {
      rows.set('own', {
        ...rows.get('own'),
        type: VisitType.VEHICULAR,
        vehicle: vehicleRows.get('VECI22'),
      } as Visit);

      const visit = await service.findOneForActor('own', RESIDENT);
      expect(visit.vehicle?.owner).toBeNull();

      const validation = await service.validateAccessForActor(
        'qr-own',
        'qr',
        RESIDENT,
      );
      expect(validation.visit?.vehicle?.owner).toBeNull();
    });
  });

  it('GET /visits/pending de un residente: forma OR (anfitrión él o su familia), con el condominio en cada cláusula', async () => {
    await service.findPendingForActor(RESIDENT);

    const [{ where }] = visitRepository.find.mock.calls[0] as [
      { where: Array<Record<string, unknown>> },
    ];
    expect(where).toHaveLength(2);
    expect(where[0]).toEqual(
      expect.objectContaining({ host: { id: 'res-1' }, organizationId: ORG }),
    );
    expect(where[1]).toEqual(
      expect.objectContaining({
        family: { id: OWN_FAMILY },
        organizationId: ORG,
      }),
    );
  });

  it('GET /visits/pending con condominium.view-all: sin cláusula de familia', async () => {
    await service.findPendingForActor(CONCIERGE);

    const [{ where }] = visitRepository.find.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(where).not.toHaveProperty('host');
    expect(where).not.toHaveProperty('family');
    expect(where).toEqual(expect.objectContaining({ organizationId: ORG }));
  });

  it('POST /visits/validate: la visita va sin qrCode si quien valida no es de la familia', async () => {
    const result = await service.validateAccessForActor(
      'qr-own',
      'qr',
      CONCIERGE,
    );
    expect(result.valid).toBe(true);
    expect(result.visit?.qrCode).toBeNull();
  });
});

/**
 * El SQL REAL del alcance por familia en `GET /visits` y `/plate/:plate`
 * (TypeORM sin BD): `visit.familyId`/`visit.hostId` llegan a Postgres con
 * comillas (si no, Postgres las pasa a minúsculas y la consulta falla).
 */
describe('VisitsService — SQL del alcance por familia (P5.C)', () => {
  let dataSource: DataSource;
  let service: VisitsService;
  let sql: string[];
  let params: Array<Record<string, unknown>>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      entities: [join(__dirname, '..', '**', '*.entity.ts')],
    });
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
  });

  beforeEach(() => {
    sql = [];
    params = [];
    const capture = function (this: SelectQueryBuilder<Visit>) {
      sql.push(this.getQuery());
      params.push(this.getParameters());
    };
    jest
      .spyOn(SelectQueryBuilder.prototype, 'getMany')
      .mockImplementation(function (this: SelectQueryBuilder<Visit>) {
        capture.call(this);
        return Promise.resolve([]);
      });
    jest
      .spyOn(SelectQueryBuilder.prototype, 'getOne')
      .mockImplementation(function (this: SelectQueryBuilder<Visit>) {
        capture.call(this);
        return Promise.resolve(null);
      });
    service = new VisitsService(
      dataSource.getRepository(Visit),
      {} as Repository<Vehicle>,
      {} as UsersService,
      {} as FamiliesService,
      {} as VehiclesService,
      {} as NotificationsService,
      {
        getContext: () => Promise.resolve(CTX),
      } as unknown as TenantContextService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('residente con familia: condominio AND (familia de la visita OR anfitrión él)', async () => {
    await service.findAllForActor({}, RESIDENT);

    expect(sql[0]).toContain('visit."organizationId" = :tenantOrgId');
    expect(sql[0]).toContain(
      '("visit"."familyId" = :scopeFamilyId OR "visit"."hostId" = :scopeUserId)',
    );
    expect(params[0]).toEqual(
      expect.objectContaining({
        tenantOrgId: ORG,
        scopeFamilyId: OWN_FAMILY,
        scopeUserId: 'res-1',
      }),
    );
  });

  it('residente sin familia: solo anfitrión él (antes el interceptor no filtraba nada)', async () => {
    await service.findAllForActor({}, LONE_RESIDENT);

    expect(sql[0]).toContain('"visit"."hostId" = :scopeUserId');
    expect(sql[0]).not.toContain('scopeFamilyId');
  });

  it('con condominium.view-all: solo el condominio', async () => {
    await service.findAllForActor({}, CONCIERGE);

    expect(sql[0]).toContain('visit."organizationId" = :tenantOrgId');
    expect(sql[0]).not.toContain('scopeUserId');
  });

  it('GET /visits/plate/:plate de un residente: también acotada por familia; sin resultado -> 404', async () => {
    await expect(
      service.findByPlateForActor('ABCD12', RESIDENT),
    ).rejects.toThrow(NotFoundException);
    expect(sql[0]).toContain(
      '("visit"."familyId" = :scopeFamilyId OR "visit"."hostId" = :scopeUserId)',
    );
  });
});
