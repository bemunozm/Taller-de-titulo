import type { DataSource, Repository } from 'typeorm';
import { FamiliesService } from './families.service';
import {
  activeFamilyOf,
  matchUnitByIdentifier,
  matchUnitByNumber,
  MAX_HOUSE_OPTIONS,
} from './house-resolution';
import type { Family } from './entities/family.entity';
import type { Unit } from '../units/entities/unit.entity';
import type { User } from '../users/entities/user.entity';
import type { NotificationsService } from '../notifications/notifications.service';
import type { UnitsService } from '../units/units.service';
import type { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';

const ORG_A = '11111111-1111-4111-8111-111111111111';

function family(id: string, overrides: Partial<Family> = {}): Family {
  return {
    id,
    name: `Familia ${id}`,
    organizationId: ORG_A,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    members: [],
    ...overrides,
  } as unknown as Family;
}

function unit(
  identifier: string,
  overrides: Partial<Unit> = {},
  families: Family[] = [family(`f-${identifier}`)],
): Unit {
  const dash = identifier.indexOf('-');
  return {
    id: `u-${identifier}`,
    organizationId: ORG_A,
    block: dash === -1 ? null : identifier.slice(0, dash),
    number: dash === -1 ? identifier : identifier.slice(dash + 1),
    identifier,
    active: true,
    families,
    ...overrides,
  } as unknown as Unit;
}

/**
 * Fase 4 · P6.R (decisión de Nova sobre la corrección P6): casa por
 * identificador exacto o, si no hay, por número de unidad único; varias ->
 * ambiguo con los identificadores. Nunca búsqueda difusa.
 */
describe('house-resolution (reglas puras)', () => {
  describe('matchUnitByIdentifier (a)', () => {
    it('"a-303" y " A-303 " encuentran la "A-303"', () => {
      const a303 = unit('A-303');
      expect(matchUnitByIdentifier([a303], 'a-303')).toEqual({
        kind: 'unit',
        unit: a303,
      });
      expect(matchUnitByIdentifier([a303], ' A-303 ')).toEqual({
        kind: 'unit',
        unit: a303,
      });
    });

    it('"10" no calza con la "101" aunque la consulta la devolviera', () => {
      expect(matchUnitByIdentifier([unit('101')], '10')).toEqual({
        kind: 'none',
      });
    });

    it('variantes de mayúsculas: gana la de las mismas mayúsculas; si no hay, ambiguo con ambas', () => {
      const lower = unit('A-5a');
      const upper = unit('A-5A');
      expect(matchUnitByIdentifier([lower, upper], 'A-5a')).toEqual({
        kind: 'unit',
        unit: lower,
      });
      expect(matchUnitByIdentifier([lower, upper], 'a-5a')).toEqual({
        kind: 'ambiguous',
        options: ['A-5a', 'A-5A'].sort((a, b) => a.localeCompare(b)),
      });
    });

    it('el mismo código en dos unidades (dos condominios, super-admin): preguntar no desambigua -> none', () => {
      expect(
        matchUnitByIdentifier(
          [unit('A-303'), unit('A-303', { id: 'u-otro-condominio' })],
          'A-303',
        ),
      ).toEqual({ kind: 'none' });
    });

    it('vacío o solo espacios: none', () => {
      expect(matchUnitByIdentifier([unit('A-303')], '   ')).toEqual({
        kind: 'none',
      });
    });
  });

  describe('matchUnitByNumber (b/c)', () => {
    it('"303" con UNA sola unidad 303 en el condominio: la encuentra', () => {
      const a303 = unit('A-303');
      expect(matchUnitByNumber([a303], '303')).toEqual({
        kind: 'unit',
        unit: a303,
      });
    });

    it('"303" con A-303 y B-303: ambiguo con los identificadores, sin datos de familias', () => {
      const match = matchUnitByNumber([unit('B-303'), unit('A-303')], '303');
      expect(match).toEqual({ kind: 'ambiguous', options: ['A-303', 'B-303'] });
      expect(JSON.stringify(match)).not.toContain('Familia');
    });

    it('"10" no calza con el número 101 (sin LIKE)', () => {
      expect(matchUnitByNumber([unit('101'), unit('A-101')], '10')).toEqual({
        kind: 'none',
      });
    });

    it('una unidad inactiva no cuenta (ni para encontrar ni para la ambigüedad)', () => {
      const a303 = unit('A-303');
      expect(
        matchUnitByNumber([a303, unit('B-303', { active: false })], '303'),
      ).toEqual({ kind: 'unit', unit: a303 });
    });

    it('la lista de opciones tiene tope', () => {
      const many = Array.from({ length: MAX_HOUSE_OPTIONS + 5 }, (_, i) =>
        unit(`${String.fromCharCode(65 + i)}-1`),
      );
      const match = matchUnitByNumber(many, '1');
      expect(match.kind).toBe('ambiguous');
      expect(match.kind === 'ambiguous' && match.options).toHaveLength(
        MAX_HOUSE_OPTIONS,
      );
    });
  });

  it('activeFamilyOf: la familia activa más antigua; sin activas, null', () => {
    const oldest = family('f-old', {
      createdAt: new Date('2025-01-01T00:00:00Z'),
    });
    expect(
      activeFamilyOf(
        unit('A-303', {}, [
          family('f-new'),
          family('f-inactive', {
            active: false,
            createdAt: new Date('2020-01-01T00:00:00Z'),
          }),
          oldest,
        ]),
      ),
    ).toBe(oldest);
    expect(activeFamilyOf(unit('A-303', {}, []))).toBeNull();
  });
});

describe('FamiliesService.resolveHouse / findByDepartment (consulta)', () => {
  let ctx: TenantContext;
  /** Unidades que devuelve la consulta, según la columna comparada. */
  let unitsBy: { identifier: Unit[]; number: Unit[] };
  let queries: Array<{
    where: [string, Record<string, unknown>];
    andWhere: unknown[][];
  }>;
  let familyFindOne: jest.Mock;
  let service: FamiliesService;

  /** Lo que usa `findUnitsMatching` de un `SelectQueryBuilder<Unit>`. */
  interface FakeUnitQueryBuilder {
    leftJoinAndSelect: () => FakeUnitQueryBuilder;
    where: (
      sql: string,
      params: Record<string, unknown>,
    ) => FakeUnitQueryBuilder;
    andWhere: (...args: unknown[]) => FakeUnitQueryBuilder;
    orderBy: () => FakeUnitQueryBuilder;
    addOrderBy: () => FakeUnitQueryBuilder;
    getMany: () => Promise<Unit[]>;
  }

  function fakeUnitQueryBuilder(): FakeUnitQueryBuilder {
    const state: { where?: [string, Record<string, unknown>] } = {};
    const andWhere: unknown[][] = [];
    const qb: FakeUnitQueryBuilder = {
      leftJoinAndSelect: () => qb,
      where: (sql, params) => {
        state.where = [sql, params];
        return qb;
      },
      andWhere: (...args) => {
        andWhere.push(args);
        return qb;
      },
      orderBy: () => qb,
      addOrderBy: () => qb,
      getMany: () => {
        if (!state.where) {
          throw new Error('sin where');
        }
        queries.push({ where: state.where, andWhere });
        return Promise.resolve(
          state.where[0].includes('unit.identifier')
            ? unitsBy.identifier
            : unitsBy.number,
        );
      },
    };
    return qb;
  }

  beforeEach(() => {
    ctx = { organizationId: ORG_A, isSuperAdmin: false };
    unitsBy = { identifier: [], number: [] };
    queries = [];
    familyFindOne = jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        id: where.id,
        name: `Familia ${where.id}`,
        members: [{ id: 'res-1', name: 'Residente' }],
      }),
    );
    service = new FamiliesService(
      { findOne: familyFindOne } as unknown as Repository<Family>,
      {} as Repository<User>,
      {} as NotificationsService,
      {} as UnitsService,
      {
        getContext: () => Promise.resolve(ctx),
      } as unknown as TenantContextService,
      {
        getRepository: () => ({
          createQueryBuilder: () => fakeUnitQueryBuilder(),
        }),
      } as unknown as DataSource,
    );
  });

  it('"a-303": calce exacto de identificador (igualdad con parámetro, sin LIKE), acotado al condominio', async () => {
    unitsBy.identifier = [unit('A-303')];

    const resolution = await service.resolveHouse('  a-303 ');

    expect(resolution).toEqual({
      status: 'found',
      family: expect.objectContaining({ id: 'f-A-303' }) as unknown,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].where).toEqual([
      'UPPER(TRIM(unit.identifier)) = UPPER(:term)',
      { term: 'A-303' },
    ]);
    expect(queries[0].andWhere).toEqual([
      ['unit."organizationId" = :tenantOrgId', { tenantOrgId: ORG_A }],
    ]);
    expect(JSON.stringify(queries)).not.toMatch(/LIKE/i);
  });

  it('"303" sin identificador exacto y una sola unidad 303: la encuentra por número', async () => {
    unitsBy.number = [unit('A-303')];

    await expect(service.resolveHouse('303')).resolves.toEqual({
      status: 'found',
      family: expect.objectContaining({ id: 'f-A-303' }) as unknown,
    });
    expect(queries.map((q) => q.where[0])).toEqual([
      'UPPER(TRIM(unit.identifier)) = UPPER(:term)',
      'UPPER(TRIM(unit.number)) = UPPER(:term)',
    ]);
  });

  it('"303" con A-303 y B-303: ambiguo con los identificadores; findByDepartment -> null', async () => {
    unitsBy.number = [unit('A-303'), unit('B-303')];

    await expect(service.resolveHouse('303')).resolves.toEqual({
      status: 'ambiguous',
      options: ['A-303', 'B-303'],
    });
    await expect(service.findByDepartment('303')).resolves.toBeNull();
    expect(familyFindOne).not.toHaveBeenCalled();
  });

  it('"10" con solo la "101": no encontrada (ni por identificador ni por número)', async () => {
    unitsBy.identifier = [unit('101')];
    unitsBy.number = [unit('101')];

    await expect(service.resolveHouse('10')).resolves.toEqual({
      status: 'not-found',
    });
    await expect(service.findByDepartment('10')).resolves.toBeNull();
  });

  it('el identificador exacto gana sobre el número (no consulta por número)', async () => {
    unitsBy.identifier = [unit('303')];
    unitsBy.number = [unit('303'), unit('A-303')];

    await expect(service.findByDepartment('303')).resolves.toEqual(
      expect.objectContaining({ id: 'f-303' }),
    );
    expect(queries).toHaveLength(1);
  });

  it('casa existente sin familia activa: no encontrada', async () => {
    unitsBy.identifier = [unit('A-303', {}, [])];

    await expect(service.resolveHouse('A-303')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('la familia ya no está al alcance del contexto (findOne 404): no encontrada', async () => {
    unitsBy.identifier = [unit('A-303')];
    familyFindOne.mockResolvedValue(null);

    await expect(service.resolveHouse('A-303')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('término vacío: no encontrada, sin consultar', async () => {
    await expect(service.resolveHouse('   ')).resolves.toEqual({
      status: 'not-found',
    });
    expect(queries).toHaveLength(0);
  });

  it('sin condominio (y sin ser super-admin): la consulta no devuelve filas (1 = 0)', async () => {
    ctx = { organizationId: null, isSuperAdmin: false };

    await service.resolveHouse('A-303');

    expect(queries[0].andWhere).toEqual([['1 = 0']]);
  });
});
