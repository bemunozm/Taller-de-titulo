import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import {
  FindOperator,
  QueryFailedError,
  type DataSource,
  type Repository,
} from 'typeorm';
import { VehiclesService } from './vehicles.service';
import { Vehicle } from './entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import {
  VehicleAccessLevel,
  VehicleType,
  vehicleAccessRuleFor,
} from './vehicle-access';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { User } from '../users/entities/user.entity';
import type { FamilyScope } from '../common/tenant/tenant-actor';
import {
  createTenantContextDouble,
  type TenantContextDouble,
} from '../test-utils/tenant-context.double';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CTX_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };
const SUPER_ADMIN: TenantContext = { organizationId: null, isSuperAdmin: true };

type Where = Record<string, unknown>;

/** `true` si la fila cumple un `where` objeto de TypeORM (igualdad o IsNull). */
function matchesWhere(row: Partial<Vehicle>, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as Record<string, unknown>)[key];
    if (expected instanceof FindOperator) {
      return expected.type === 'isNull' ? actual === null : false;
    }
    return actual === expected;
  });
}

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "vehicles"',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505' }),
  );
}

/**
 * FIX cross-tenant (rama feature/cierre-fases-1-2): `findByPlate` con el
 * `organizationId` EXPLÍCITO de la cámara (camino LPR, sin actor) acota el
 * `where` a ESE condominio.
 */
describe('VehiclesService — findByPlate con condominio explícito (camino LPR)', () => {
  let service: VehiclesService;
  let repo: jest.Mocked<Pick<Repository<Vehicle>, 'findOne'>>;

  beforeEach(() => {
    repo = { findOne: jest.fn().mockResolvedValue(null) };

    service = new VehiclesService(
      repo as unknown as Repository<Vehicle>,
      {} as UsersService,
      {} as NotificationsService,
      {} as TenantContextService,
      {} as DataSource,
    );
  });

  it('con organizationId explícito acota el where a ESE condominio (sin consultar el actor)', async () => {
    await service.findByPlate('ABCD12', { organizationId: 'org-camara-A' });

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { plate: 'ABCD12', organizationId: 'org-camara-A' },
      relations: ['owner'],
    });
  });

  it('un vehículo de OTRO condominio (B) no matchea cuando se busca acotado a A', async () => {
    const vehicle = await service.findByPlate('ABCD12', {
      organizationId: 'org-A',
    });

    expect(repo.findOne).not.toHaveBeenCalledWith({
      where: { plate: 'ABCD12', organizationId: 'org-B' },
      relations: ['owner'],
    });
    expect(vehicle).toBeNull();
  });
});

/**
 * Fase 4 · P5.B: aislamiento por condominio de las rutas de vehículos,
 * propietario miembro del condominio, unicidad por condominio (409) y enum de
 * `vehicleType`/`accessLevel`. Fase 4 · P5.C: alcance por familia
 * (`condominium.view-all`), creación estricta y `GET /vehicles/:id`.
 */
describe('VehiclesService — aislamiento por condominio (P5.B) y por familia (P5.C)', () => {
  let rows: Vehicle[];
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let tenantContext: TenantContextDouble;
  let dataSource: { query: jest.Mock };
  let usersService: {
    findByFamily: jest.Mock;
    findOneWithFamily: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let service: VehiclesService;

  /** Residente de la familia 1 (sin `condominium.view-all`). */
  const RESIDENT: FamilyScope = { userId: 'res-1', familyId: 'fam-1' };
  /** Residente sin familia: solo lo propio. */
  const LONE_RESIDENT: FamilyScope = { userId: 'res-solo', familyId: null };
  const FAMILY_1 = [{ id: 'res-1' }, { id: 'res-2' }];

  function vehicle(overrides: Partial<Vehicle>): Vehicle {
    return {
      id: 'veh-x',
      organizationId: ORG_A,
      plate: 'AAAA11',
      brand: null,
      model: null,
      color: null,
      year: null,
      vehicleType: null,
      accessLevel: null,
      active: true,
      owner: null,
      ownerId: null,
      ...overrides,
    } as Vehicle;
  }

  beforeEach(() => {
    rows = [
      vehicle({ id: 'veh-a', organizationId: ORG_A, plate: 'ABCD12' }),
      vehicle({ id: 'veh-b', organizationId: ORG_B, plate: 'ABCD12' }),
      vehicle({
        id: 'veh-fam',
        organizationId: ORG_A,
        plate: 'FAMI11',
        ownerId: 'res-2',
        owner: { id: 'res-2' } as User,
      }),
      vehicle({
        id: 'veh-neighbor',
        organizationId: ORG_A,
        plate: 'VECI22',
        ownerId: 'neighbor',
        owner: { id: 'neighbor' } as User,
      }),
    ];
    repo = {
      findOne: jest.fn((options: { where: Where }) =>
        Promise.resolve(
          rows.find((row) => matchesWhere(row, options.where)) ?? null,
        ),
      ),
      create: jest.fn((data: Partial<Vehicle>) => ({ ...data }) as Vehicle),
      save: jest.fn((entity: Vehicle) =>
        Promise.resolve({ ...entity, id: entity.id ?? 'veh-new' }),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(),
    };
    tenantContext = createTenantContextDouble(CTX_A, [ORG_A, ORG_B]);
    // isActiveMemberOfOrganization: [] = no es miembro activo.
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    usersService = {
      findByFamily: jest.fn().mockResolvedValue(FAMILY_1),
      findOneWithFamily: jest
        .fn()
        .mockResolvedValue({ id: 'owner', name: 'Propietario', family: null }),
    };
    notificationsService = { create: jest.fn().mockResolvedValue({}) };

    service = new VehiclesService(
      repo as unknown as Repository<Vehicle>,
      usersService as unknown as UsersService,
      notificationsService as unknown as NotificationsService,
      tenantContext as unknown as TenantContextService,
      dataSource as unknown as DataSource,
    );
  });

  describe('findByPlate sin condominio explícito (GET /vehicles/plate/:plate, consultar_vehiculo)', () => {
    it('se acota al condominio del actor: con la misma patente en A y B, A ve SU vehículo', async () => {
      const found = await service.findByPlate('ABCD12');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { plate: 'ABCD12', organizationId: ORG_A },
        relations: ['owner'],
      });
      expect(found?.id).toBe('veh-a');
    });

    it('patente que solo existe en B -> 404 para un actor de A', async () => {
      rows = [vehicle({ id: 'veh-b', organizationId: ORG_B, plate: 'ZZZZ99' })];

      await expect(
        service.findByPlateForActorOrFail('ZZZZ99', null),
      ).rejects.toThrow(NotFoundException);
    });

    it('super-admin: sin filtro de condominio', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      await service.findByPlate('ABCD12');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { plate: 'ABCD12' },
        relations: ['owner'],
      });
    });

    it('P5.C: actor sin condominio -> ningún vehículo (antes el "cajón nulo")', async () => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: false,
      });
      rows.push(
        vehicle({ id: 'veh-null', organizationId: null, plate: 'NULO11' }),
      );

      await expect(service.findByPlate('NULO11')).resolves.toBeNull();
    });
  });

  describe('update / remove', () => {
    it('update de un vehículo de otro condominio -> 404 sin guardar', async () => {
      await expect(
        service.update('veh-b', { color: 'Rojo' }, null),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('remove de un vehículo de otro condominio -> 404 sin borrar', async () => {
      await expect(service.remove('veh-b', null)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('update del propio condominio: guarda', async () => {
      await service.update('veh-a', { color: 'Rojo' }, null);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'veh-a', color: 'Rojo' }),
      );
    });

    it('super-admin edita el vehículo de cualquier condominio', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      await service.update('veh-b', { color: 'Azul' }, null);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'veh-b', color: 'Azul' }),
      );
    });

    it('P5.C: un vehículo asociado a visitas (FK) -> 409, no 500', async () => {
      repo.remove.mockRejectedValueOnce(
        new QueryFailedError(
          'DELETE FROM "vehicles"',
          [],
          Object.assign(new Error('fk'), { code: '23503' }),
        ),
      );

      await expect(service.remove('veh-a', null)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('ownerId: miembro activo del condominio del vehículo', () => {
    it('create con un propietario que no es miembro activo de A -> 403 sin guardar', async () => {
      await expect(
        service.create({ plate: 'NEW123', ownerId: 'user-de-b' }, null),
      ).rejects.toThrow(ForbiddenException);
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
        'user-de-b',
        ORG_A,
      ]);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('update con un propietario ajeno -> 403 sin guardar', async () => {
      await expect(
        service.update('veh-a', { ownerId: 'user-de-b' }, null),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('propietario miembro activo de A: crea el vehículo de A con ese propietario', async () => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);

      await service.create({ plate: 'NEW123', ownerId: 'user-de-a' }, null);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          plate: 'NEW123',
          ownerId: 'user-de-a',
          organizationId: ORG_A,
        }),
      );
    });

    it('update con un propietario válido reemplaza la relación cargada (si no, TypeORM ignoraba el cambio)', async () => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);
      rows[0].owner = { id: 'owner-viejo' } as User;
      rows[0].ownerId = 'owner-viejo';

      await service.update('veh-a', { ownerId: 'owner-nuevo' }, null);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'owner-nuevo',
          owner: { id: 'owner-nuevo' },
        }),
      );
    });
  });

  describe('creación estricta (P5.C)', () => {
    it('actor sin condominio -> 403 sin guardar (antes quedaba en el cajón nulo)', async () => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: false,
      });

      await expect(service.create({ plate: 'NEW123' }, null)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('un actor que no es super-admin y envía organizationId -> 403', async () => {
      await expect(
        service.create({ plate: 'NEW123', organizationId: ORG_B }, null),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('super-admin sin organizationId -> 400', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      await expect(service.create({ plate: 'NEW123' }, null)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('super-admin con un organizationId inexistente -> 400', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      await expect(
        service.create(
          {
            plate: 'NEW123',
            organizationId: '99999999-9999-4999-8999-999999999999',
          },
          null,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('super-admin con organizationId: crea en ESE condominio, con propietario miembro de él', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);
      dataSource.query.mockResolvedValue([{ ok: 1 }]);

      await service.create(
        { plate: 'NEW123', organizationId: ORG_B, ownerId: 'user-de-b' },
        null,
      );

      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
        'user-de-b',
        ORG_B,
      ]);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'NEW123', organizationId: ORG_B }),
      );
    });
  });

  describe('alcance por familia (P5.C, sin condominium.view-all)', () => {
    it('GET /vehicles/:id: el de su familia sí; el de un vecino del mismo condominio -> 404', async () => {
      await expect(
        service.findOneForActorOrFail('veh-fam', RESIDENT),
      ).resolves.toMatchObject({ id: 'veh-fam' });
      await expect(
        service.findOneForActorOrFail('veh-neighbor', RESIDENT),
      ).rejects.toThrow(NotFoundException);
      // Con condominium.view-all (scope null) ve el del vecino.
      await expect(
        service.findOneForActorOrFail('veh-neighbor', null),
      ).resolves.toMatchObject({ id: 'veh-neighbor' });
    });

    it('GET /vehicles/:id: un vehículo sin propietario (visitante) no es de su familia -> 404', async () => {
      await expect(
        service.findOneForActorOrFail('veh-a', RESIDENT),
      ).rejects.toThrow(NotFoundException);
    });

    it('GET /vehicles/plate/:plate de un vecino -> 404', async () => {
      await expect(
        service.findByPlateForActorOrFail('VECI22', RESIDENT),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.findByPlateForActorOrFail('FAMI11', RESIDENT),
      ).resolves.toMatchObject({ id: 'veh-fam' });
    });

    it('update / remove del vehículo de un vecino -> 404 sin guardar ni borrar', async () => {
      await expect(
        service.update('veh-neighbor', { color: 'Rojo' }, RESIDENT),
      ).rejects.toThrow(NotFoundException);
      await expect(service.remove('veh-neighbor', RESIDENT)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it('update del vehículo de su familia: guarda; reasignarlo a un vecino -> 403', async () => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);

      await service.update('veh-fam', { color: 'Rojo' }, RESIDENT);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'veh-fam', color: 'Rojo' }),
      );

      repo.save.mockClear();
      await expect(
        service.update('veh-fam', { ownerId: 'neighbor' }, RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('create: ownerId de un vecino -> 403; de su familia -> crea; sin ownerId -> él es el propietario', async () => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);

      await expect(
        service.create({ plate: 'NEW123', ownerId: 'neighbor' }, RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();

      await service.create({ plate: 'NEW124', ownerId: 'res-2' }, RESIDENT);
      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ plate: 'NEW124', ownerId: 'res-2' }),
      );

      await service.create({ plate: 'NEW125' }, RESIDENT);
      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ plate: 'NEW125', ownerId: 'res-1' }),
      );
    });

    it('residente sin familia: solo él puede ser el propietario', async () => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);

      await expect(
        service.create({ plate: 'NEW123', ownerId: 'res-2' }, LONE_RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.findByFamily).not.toHaveBeenCalled();
    });
  });

  describe('corrección P5 (cyber M1): la familia no deshace la revocación del Administrador', () => {
    beforeEach(() => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);
    });

    it('reactivar un vehículo desactivado desde la familia -> 403 sin guardar', async () => {
      rows[2].active = false;

      await expect(
        service.update('veh-fam', { active: true }, RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it.each([
      ['visitante', 'residente'],
      [null, 'visitante'],
      ['servicio', 'residente'],
    ] as const)(
      'subir accessLevel %p -> %p desde la familia -> 403',
      async (current, next) => {
        rows[2].accessLevel = current;

        await expect(
          service.update(
            'veh-fam',
            { accessLevel: next as VehicleAccessLevel },
            RESIDENT,
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(repo.save).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['residente', 'visitante'],
      ['residente', null],
      ['visitante', 'servicio'],
      ['visitante', 'visitante'],
    ] as const)(
      'bajar (o mantener) accessLevel %p -> %p: permitido',
      async (current, next) => {
        rows[2].accessLevel = current;

        await service.update(
          'veh-fam',
          { accessLevel: next as VehicleAccessLevel | null },
          RESIDENT,
        );

        expect(repo.save).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'veh-fam', accessLevel: next }),
        );
      },
    );

    it('desactivar sí puede; con condominium.view-all (Administrador) reactiva y sube el nivel', async () => {
      await service.update('veh-fam', { active: false }, RESIDENT);
      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'veh-fam', active: false }),
      );

      rows[2].active = false;
      rows[2].accessLevel = 'visitante';
      await service.update(
        'veh-fam',
        { active: true, accessLevel: VehicleAccessLevel.RESIDENT },
        null,
      );
      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ active: true, accessLevel: 'residente' }),
      );
    });

    it('al CREAR, el residente sí puede usar accessLevel residente (decisión de Benjamin)', async () => {
      await service.create(
        { plate: 'NEW777', accessLevel: VehicleAccessLevel.RESIDENT },
        RESIDENT,
      );

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ accessLevel: 'residente', ownerId: 'res-1' }),
      );
    });
  });

  describe('corrección P5 (QA R1/R2): patente y borrado desde la familia', () => {
    beforeEach(() => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);
      // Lo que se guarda queda en el "store" (para encadenar operaciones).
      repo.save.mockImplementation((entity: Vehicle) => {
        const saved = { ...entity, id: entity.id ?? 'veh-new' };
        rows = rows.filter((row) => row.id !== saved.id).concat(saved);
        return Promise.resolve(saved);
      });
    });

    it('R1: crea residente -> la administración lo desactiva -> la familia no puede borrarlo (403)', async () => {
      const created = await service.create(
        { plate: 'DESV01', accessLevel: VehicleAccessLevel.RESIDENT },
        RESIDENT,
      );
      expect(created).toEqual(
        expect.objectContaining({ accessLevel: 'residente', ownerId: 'res-1' }),
      );

      // El Administrador (condominium.view-all) lo desactiva.
      await service.update(created.id, { active: false }, null);

      await expect(service.remove(created.id, RESIDENT)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
      // Y tampoco lo reactiva por la edición.
      await expect(
        service.update(created.id, { active: true }, RESIDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('R1: un vehículo ACTIVO de su familia sí lo borra; el Administrador borra uno inactivo', async () => {
      await service.remove('veh-fam', RESIDENT);
      expect(repo.remove).toHaveBeenCalledTimes(1);

      rows[0].active = false;
      await service.remove('veh-a', null);
      expect(repo.remove).toHaveBeenCalledTimes(2);
    });

    it('R2: cambiar la patente desde la familia -> 403 sin guardar; la misma patente o la administración, sí', async () => {
      await expect(
        service.update('veh-fam', { plate: 'OTRA99' }, RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();

      await service.update(
        'veh-fam',
        { plate: 'FAMI11', color: 'Rojo' },
        RESIDENT,
      );
      await service.update('veh-fam', { plate: 'OTRA99' }, null);
      expect(repo.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'veh-fam', plate: 'OTRA99' }),
      );
    });
  });

  describe('corrección P5 (QA): quitar el propietario con ownerId null', () => {
    it('con condominium.view-all: quita el propietario (columna y relación)', async () => {
      await service.update('veh-fam', { ownerId: null }, null);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'veh-fam', ownerId: null, owner: null }),
      );
    });

    it('desde la familia -> 403 sin guardar', async () => {
      await expect(
        service.update('veh-fam', { ownerId: null }, RESIDENT),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('unicidad por condominio', () => {
    it('misma patente que un vehículo de OTRO condominio: se crea en el propio (el índice es por condominio)', async () => {
      await service.create({ plate: 'ABCD12' }, null);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'ABCD12', organizationId: ORG_A }),
      );
    });

    it('sin `active` en el body: nace activo (la columna es NOT NULL; antes null -> 500)', async () => {
      await service.create({ plate: 'NEW123' }, null);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'NEW123', active: true }),
      );
    });

    it('patente duplicada en el mismo condominio (UNIQUE de la BD) -> 409, no 500', async () => {
      repo.save.mockRejectedValueOnce(uniqueViolation());

      await expect(service.create({ plate: 'ABCD12' }, null)).rejects.toThrow(
        ConflictException,
      );
    });

    it('update que choca con otra patente del condominio -> 409', async () => {
      repo.save.mockRejectedValueOnce(uniqueViolation());

      await expect(
        service.update('veh-a', { plate: 'OTRA12' }, null),
      ).rejects.toThrow(ConflictException);
    });

    it('otros errores de la BD no se disfrazan de 409', async () => {
      repo.save.mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.create({ plate: 'NEW123' }, null)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('listAll (P5.B: where -> andWhere; P5.C: alcance por familia)', () => {
    interface RecordingQb {
      whereCalls: string[];
      andWhereCalls: Array<[string, Record<string, unknown>?]>;
      [method: string]: unknown;
    }

    function recordingQb(): RecordingQb {
      const qb: RecordingQb = { whereCalls: [], andWhereCalls: [] };
      for (const method of ['leftJoinAndSelect', 'orderBy', 'take']) {
        qb[method] = jest.fn(() => qb);
      }
      qb.where = jest.fn((sql: string) => {
        qb.whereCalls.push(sql);
        return qb;
      });
      qb.andWhere = jest.fn((sql: string, params?: Record<string, unknown>) => {
        qb.andWhereCalls.push([sql, params]);
        return qb;
      });
      qb.getMany = jest.fn().mockResolvedValue([]);
      return qb;
    }

    it('residente: el filtro por familia se SUMA al de condominio (nunca lo reemplaza)', async () => {
      const qb = recordingQb();
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.listAll(RESIDENT);

      expect(usersService.findByFamily).toHaveBeenCalledWith('fam-1');
      expect(qb.whereCalls).toEqual([]);
      expect(qb.andWhereCalls).toEqual([
        ['vehicle."organizationId" = :tenantOrgId', { tenantOrgId: ORG_A }],
        [
          'vehicle.ownerId IN (:...familyOwnerIds)',
          { familyOwnerIds: ['res-1', 'res-2'] },
        ],
      ]);
    });

    it('residente sin familia: solo sus vehículos (antes el interceptor lo dejaba SIN filtro)', async () => {
      const qb = recordingQb();
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.listAll(LONE_RESIDENT);

      expect(qb.andWhereCalls).toContainEqual([
        'vehicle.ownerId IN (:...familyOwnerIds)',
        { familyOwnerIds: ['res-solo'] },
      ]);
    });

    it('con condominium.view-all (scope null): todo su condominio', async () => {
      const qb = recordingQb();
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.listAll(null);

      expect(qb.andWhereCalls).toEqual([
        ['vehicle."organizationId" = :tenantOrgId', { tenantOrgId: ORG_A }],
      ]);
    });

    it('actor sin condominio: 1 = 0 (vacío)', async () => {
      const qb = recordingQb();
      repo.createQueryBuilder.mockReturnValue(qb);
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: false,
      });

      await service.listAll(null);

      expect(qb.andWhereCalls).toEqual([['1 = 0', undefined]]);
    });
  });
});

describe('CreateVehicleDto / UpdateVehicleDto — vehicleType (carrocería) y accessLevel (P5.C)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  function validate(
    metatype: typeof CreateVehicleDto | typeof UpdateVehicleDto,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return pipe.transform(body, { type: 'body', metatype });
  }

  it('vehicleType fuera de la carrocería (incluido el modelo viejo "residente") -> 400', async () => {
    await expect(
      validate(CreateVehicleDto, { plate: 'ABCD12', vehicleType: 'residente' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate(CreateVehicleDto, { plate: 'ABCD12', vehicleType: 'Auto' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accessLevel fuera del enum (incluido el modelo viejo "permanente") -> 400', async () => {
    await expect(
      validate(CreateVehicleDto, {
        plate: 'ABCD12',
        accessLevel: 'permanente',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate(CreateVehicleDto, { plate: 'ABCD12', accessLevel: 'temporal' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('la edición (PUT) también valida y no acepta organizationId', async () => {
    await expect(
      validate(UpdateVehicleDto, { vehicleType: 'Residente' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate(UpdateVehicleDto, { campoExtra: true }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate(UpdateVehicleDto, { organizationId: ORG_B }),
    ).rejects.toThrow(BadRequestException);
  });

  it('valores válidos: cada carrocería y cada nivel de acceso', async () => {
    for (const vehicleType of Object.values(VehicleType)) {
      await expect(
        validate(CreateVehicleDto, { plate: 'abcd12', vehicleType }),
      ).resolves.toEqual(expect.objectContaining({ vehicleType }));
    }
    for (const accessLevel of Object.values(VehicleAccessLevel)) {
      await expect(
        validate(CreateVehicleDto, { plate: 'abcd12', accessLevel }),
      ).resolves.toEqual(expect.objectContaining({ accessLevel }));
    }
    await expect(
      validate(CreateVehicleDto, {
        plate: 'abcd12',
        vehicleType: VehicleType.PICKUP,
        accessLevel: VehicleAccessLevel.RESIDENT,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        plate: 'ABCD12',
        vehicleType: 'camioneta',
        accessLevel: 'residente',
      }),
    );
  });

  it('organizationId en el alta: debe ser UUID (el servicio decide quién puede enviarlo)', async () => {
    await expect(
      validate(CreateVehicleDto, {
        plate: 'ABCD12',
        organizationId: 'no-uuid',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      validate(CreateVehicleDto, { plate: 'ABCD12', organizationId: ORG_A }),
    ).resolves.toEqual(expect.objectContaining({ organizationId: ORG_A }));
  });

  it('corrección P5 (QA): en la edición ownerId null llega como null (quita el propietario); "" no cambia nada', async () => {
    await expect(
      validate(UpdateVehicleDto, { ownerId: null }),
    ).resolves.toEqual(expect.objectContaining({ ownerId: null }));
    await expect(
      validate(UpdateVehicleDto, { ownerId: '' }),
    ).resolves.not.toHaveProperty('ownerId', '');
    await expect(
      validate(UpdateVehicleDto, { ownerId: 'user-1' }),
    ).resolves.toEqual(expect.objectContaining({ ownerId: 'user-1' }));
  });

  it("'' (el 'Seleccionar' del formulario) se trata como null", async () => {
    await expect(
      validate(UpdateVehicleDto, { vehicleType: '', accessLevel: '' }),
    ).resolves.toEqual(
      expect.objectContaining({ vehicleType: null, accessLevel: null }),
    );
  });
});

describe('vehicleAccessRuleFor — la decisión del portón solo mira accessLevel (P5.C)', () => {
  it.each([
    ['residente', 'allow'],
    ['visitante', 'requires-visit'],
    ['servicio', 'concierge'],
    [null, 'concierge'],
    [undefined, 'concierge'],
    // Valores legacy o mal escritos: escalan (fail-closed).
    ['permanente', 'concierge'],
    ['temporal', 'concierge'],
    ['Residente', 'concierge'],
  ])('accessLevel %p -> %p', (accessLevel, expected) => {
    expect(vehicleAccessRuleFor(accessLevel)).toBe(expected);
  });
});
