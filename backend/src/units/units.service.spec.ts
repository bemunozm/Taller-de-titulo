import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { FindOperator, QueryFailedError, type Repository } from 'typeorm';
import { UnitsService } from './units.service';
import { UnitsController } from './units.controller';
import { Unit } from './entities/unit.entity';
import type { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { DEFAULT_PERMISSIONS } from '../common/constants/default-permissions.constant';
import type { Family } from '../families/entities/family.entity';
import { HubType } from '../hub/entities/hub.entity';
import { classMetadata, handlerMetadata } from '../test-utils/handler-metadata';
import {
  createTenantContextDouble,
  type TenantContextDouble,
} from '../test-utils/tenant-context.double';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CTX_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };

type Where = Record<string, unknown>;

function matchesWhere(row: Unit, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected instanceof FindOperator) {
      return expected.type === 'isNull' ? actual === null : false;
    }
    return actual === expected;
  });
}

function unit(overrides: Partial<Unit>): Unit {
  const entity = Object.assign(new Unit(), {
    id: 'unit-x',
    organizationId: ORG_A,
    block: 'A',
    number: '101',
    identifier: 'A-101',
    floor: null,
    type: null,
    active: true,
    families: [] as Family[],
    ...overrides,
  });
  return entity;
}

function uniqueViolation(): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO "units"',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505' }),
  );
}

/**
 * Fase 4 · P5.B: estadísticas y lista del hub acotadas al condominio, e
 * identificador único POR condominio (409 si choca, no 500).
 */
describe('UnitsService — aislamiento y unicidad por condominio (P5.B)', () => {
  let rows: Unit[];
  let repo: {
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: UnitsService;
  let tenantContext: TenantContextDouble;

  beforeEach(() => {
    rows = [
      unit({ id: 'unit-a', organizationId: ORG_A, identifier: 'A-101' }),
      unit({
        id: 'unit-b',
        organizationId: ORG_B,
        identifier: 'A-101',
        families: [
          {
            id: 'fam-b',
            active: true,
            digitalConciergeEnabled: true,
          } as Family,
        ],
      }),
    ];
    repo = {
      findOne: jest.fn((options: { where: Where }) =>
        Promise.resolve(
          rows.find((row) => matchesWhere(row, options.where)) ?? null,
        ),
      ),
      find: jest.fn((options: { where: Where }) =>
        Promise.resolve(rows.filter((row) => matchesWhere(row, options.where))),
      ),
      count: jest.fn((options?: { where?: Where }) =>
        Promise.resolve(
          rows.filter((row) => matchesWhere(row, options?.where ?? {})).length,
        ),
      ),
      // Como `Repository.create`: no corre los hooks (sin identifier).
      create: jest.fn((data: Partial<Unit>) => Object.assign(new Unit(), data)),
      save: jest.fn((entity: Unit) => {
        entity.generateIdentifier();
        return Promise.resolve(entity);
      }),
    };
    tenantContext = createTenantContextDouble(CTX_A, [ORG_A, ORG_B]);
    service = new UnitsService(
      repo as unknown as Repository<Unit>,
      tenantContext as unknown as TenantContextService,
    );
  });

  it('GET /units/stats cuenta solo las unidades del condominio del actor', async () => {
    await expect(service.getStats()).resolves.toEqual({
      total: 1,
      occupied: 0,
      available: 1,
      inactive: 0,
    });
    for (const [options] of repo.count.mock.calls as Array<
      [{ where: Where }]
    >) {
      expect(options.where).toEqual(
        expect.objectContaining({ organizationId: ORG_A }),
      );
    }
  });

  describe('GET /units/ai-enabled (hub)', () => {
    it('solo las unidades del condominio del hub', async () => {
      await expect(service.findWithAIEnabled(ORG_A)).resolves.toEqual([]);
      await expect(service.findWithAIEnabled(ORG_B)).resolves.toEqual([
        { houseNumber: 'A-101', hasAI: true, familyId: 'fam-b' },
      ]);
    });

    it('hub sin condominio -> lista vacía, sin consultar', async () => {
      await expect(service.findWithAIEnabled(null)).resolves.toEqual([]);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('identificador único por condominio', () => {
    it('el mismo identificador que una unidad de OTRO condominio: se crea', async () => {
      rows = [
        unit({ id: 'unit-b', organizationId: ORG_B, identifier: 'B-202' }),
      ];

      await expect(
        service.create({ block: 'B', number: '202' }),
      ).resolves.toEqual(
        expect.objectContaining({ identifier: 'B-202', organizationId: ORG_A }),
      );
    });

    it('otra unidad del mismo condominio con OTRO identificador: se crea (antes el chequeo buscaba identifier undefined y daba 409)', async () => {
      await expect(
        service.create({ block: 'C', number: '303' }),
      ).resolves.toEqual(expect.objectContaining({ identifier: 'C-303' }));
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { identifier: 'C-303', organizationId: ORG_A },
      });
    });

    it('duplicado en el mismo condominio (chequeo previo) -> 409', async () => {
      await expect(
        service.create({ block: 'A', number: '101' }),
      ).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('duplicado que llega a la BD (carrera, UNIQUE) -> 409, no 500', async () => {
      repo.save.mockRejectedValueOnce(uniqueViolation());

      await expect(
        service.create({ block: 'C', number: '303' }),
      ).rejects.toThrow(ConflictException);
    });

    it('update que choca en la BD -> 409', async () => {
      repo.save.mockRejectedValueOnce(uniqueViolation());

      await expect(service.update('unit-a', { number: '102' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('carga masiva: un duplicado en la BD se omite (skipped), nunca 500', async () => {
      repo.save.mockRejectedValueOnce(uniqueViolation());

      const result = await service.createBulk({
        block: 'D',
        numberFrom: 1,
        numberTo: 2,
      });

      expect(result.skipped).toEqual(['D-1']);
      expect(result.created.map((u) => u.identifier)).toEqual(['D-2']);
    });
  });

  describe('corrección P5 (cyber M2): miembros de las familias de una unidad', () => {
    it('includeMembers false: no carga families.members (datos de vecinos)', async () => {
      await service.findOne('unit-a', { includeMembers: false });
      await service.findByIdentifier('a-101', { includeMembers: false });

      for (const [options] of repo.findOne.mock.calls as Array<
        [{ relations: string[] }]
      >) {
        expect(options.relations).toEqual(['families']);
      }
    });

    it('por defecto (callers internos) sigue cargándolos', async () => {
      await service.findOne('unit-a');

      const [[options]] = repo.findOne.mock.calls as Array<
        [{ relations: string[] }]
      >;
      expect(options.relations).toEqual(['families', 'families.members']);
    });
  });

  describe('creación estricta (P5.C)', () => {
    const NO_ORG: TenantContext = { organizationId: null, isSuperAdmin: false };
    const SUPER_ADMIN: TenantContext = {
      organizationId: null,
      isSuperAdmin: true,
    };

    it('actor sin condominio -> 403 en create y en la carga masiva, sin guardar', async () => {
      tenantContext.getContext.mockResolvedValue(NO_ORG);

      await expect(
        service.create({ block: 'C', number: '303' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.createBulk({ block: 'D', numberFrom: 1, numberTo: 2 }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('actor que no es super-admin y envía organizationId -> 403', async () => {
      await expect(
        service.create({ block: 'C', number: '303', organizationId: ORG_B }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('super-admin sin organizationId -> 400', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      await expect(
        service.create({ block: 'C', number: '303' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createBulk({ block: 'D', numberFrom: 1, numberTo: 1 }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('super-admin con organizationId: crea en ese condominio y el duplicado se busca SOLO ahí', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      // "A-101" existe en A y en B: en un condominio nuevo para esa unidad
      // no es duplicado; en B sí.
      rows = rows.filter((row) => row.organizationId === ORG_A);
      await expect(
        service.create({ block: 'A', number: '101', organizationId: ORG_B }),
      ).resolves.toEqual(
        expect.objectContaining({ identifier: 'A-101', organizationId: ORG_B }),
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { identifier: 'A-101', organizationId: ORG_B },
      });

      await expect(
        service.create({ block: 'A', number: '101', organizationId: ORG_A }),
      ).rejects.toThrow(ConflictException);
    });

    it('super-admin: la carga masiva también va al condominio indicado', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      const result = await service.createBulk({
        block: 'E',
        numberFrom: 1,
        numberTo: 1,
        organizationId: ORG_B,
      });

      expect(result.created).toEqual([
        expect.objectContaining({ identifier: 'E-1', organizationId: ORG_B }),
      ]);
    });

    it('update del super-admin: el duplicado se busca en el condominio DE LA UNIDAD', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);
      rows.push(
        unit({ id: 'unit-a2', organizationId: ORG_A, identifier: 'A-102' }),
      );

      // unit-b (de B) pasa a "A-102", que solo existe en A: no es conflicto.
      await expect(
        service.update('unit-b', { number: '102' }),
      ).resolves.toEqual(expect.objectContaining({ identifier: 'A-102' }));
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { identifier: 'A-102', organizationId: ORG_B },
      });
    });
  });
});

/**
 * Fase 4 · P5.B: antes la clase solo tenía `AuthGuard`, así que los
 * `@RequirePermissions` no se evaluaban, y nombraban permisos inexistentes
 * (`manage_units`/`view_units`).
 */
describe('UnitsController — guard y permisos reales (P5.B)', () => {
  const realPermissions = new Set(DEFAULT_PERMISSIONS.map((p) => p.name));

  it('la clase corre AuthGuard y AuthorizationGuard', () => {
    expect(classMetadata(UnitsController, GUARDS_METADATA)).toEqual([
      AuthGuard,
      AuthorizationGuard,
    ]);
  });

  it.each([
    ['create', 'units.create'],
    ['createBulk', 'units.create'],
    ['findAll', 'units.read'],
    ['findAvailable', 'units.view-available'],
    ['getStats', 'units.view-stats'],
    ['search', 'units.search'],
    ['findByBlock', 'units.read'],
    ['findByFloor', 'units.read'],
    ['findByIdentifier', 'units.read'],
    ['findOne', 'units.read'],
    ['update', 'units.update'],
    ['remove', 'units.delete'],
  ] as const)('%s exige %s (un permiso que existe)', (method, permission) => {
    expect(handlerMetadata(UnitsController, method, PERMISSIONS_KEY)).toEqual([
      permission,
    ]);
    expect(realPermissions.has(permission)).toBe(true);
  });

  it.each(['findOne', 'update', 'remove'] as const)(
    'P5.C: %s valida el id con ParseUUIDPipe (un id no UUID -> 400, antes 500)',
    (method) => {
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        UnitsController,
        method,
      ) as Record<string, { data?: string; pipes?: unknown[] }>;
      const idArg = Object.values(args).find((arg) => arg.data === 'id');
      expect(idArg?.pipes).toEqual([ParseUUIDPipe]);
    },
  );

  it('ai-enabled: sin permiso humano (hub) y acotado al condominio del hub', async () => {
    const findWithAIEnabled = jest.fn().mockResolvedValue([]);
    const controller = new UnitsController({
      findWithAIEnabled,
    } as unknown as UnitsService);

    await controller.getAIEnabledUnits({
      hub: {
        hubId: 'hub-1',
        type: HubType.PHYSICAL_HUB,
        organizationId: ORG_B,
      },
    });
    await controller.getAIEnabledUnits({
      hub: { hubId: 'hub-2', type: HubType.PHYSICAL_HUB, organizationId: null },
    });

    expect(findWithAIEnabled).toHaveBeenNthCalledWith(1, ORG_B);
    expect(findWithAIEnabled).toHaveBeenNthCalledWith(2, null);
    expect(
      handlerMetadata(UnitsController, 'getAIEnabledUnits', PERMISSIONS_KEY),
    ).toBeUndefined();
  });
});
