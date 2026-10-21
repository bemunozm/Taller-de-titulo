import { join } from 'path';
import { DataSource, type Repository, SelectQueryBuilder } from 'typeorm';
import { auditReaderOf } from './audit.controller';
import { AuditService, type AuditReader } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Fase 4 · P5.A: auditoría por condominio. El super-admin lee todo; el
 * Administrador solo su condominio (incluidos LOGIN/LOGOUT de su condominio,
 * que en la P4 se le ocultaban); las filas sin condominio solo el super-admin.
 */
const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const SUPER_ADMIN: AuditReader = { isSuperAdmin: true, organizationId: null };
const ADMIN_A: AuditReader = { isSuperAdmin: false, organizationId: ORG_A };
const NO_ORG: AuditReader = { isSuperAdmin: false, organizationId: null };

describe('AuditService — alcance por condominio (Fase 4 · P5.A)', () => {
  let repository: {
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let queryBuilderWheres: unknown[];
  let service: AuditService;

  beforeEach(() => {
    queryBuilderWheres = [];
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn(function (this: unknown, where: unknown) {
        queryBuilderWheres.push(where);
        return this;
      }),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    repository = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    service = new AuditService(repository as unknown as Repository<AuditLog>);
  });

  interface FindAndCountOptions {
    where: unknown;
    select: { user: unknown };
    relations: unknown;
    loadEagerRelations: unknown;
  }

  function findAndCountOptions(): FindAndCountOptions {
    const [[options]] = repository.findAndCount.mock.calls as Array<
      [FindAndCountOptions]
    >;
    return options;
  }

  describe('findAll', () => {
    it('Administrador: solo su condominio (incluidos sus LOGIN/LOGOUT)', async () => {
      await service.findAll({}, ADMIN_A);

      expect(findAndCountOptions().where).toEqual({ organizationId: ORG_A });
    });

    it('Administrador: un filtro del query no puede pisar el alcance', async () => {
      await service.findAll({ userId: 'user-1', entityType: 'User' }, ADMIN_A);

      expect(findAndCountOptions().where).toEqual({
        userId: 'user-1',
        entityType: 'User',
        organizationId: ORG_A,
      });
    });

    it('super-admin: sin filtro de condominio (ve también las filas sin condominio)', async () => {
      await service.findAll({}, SUPER_ADMIN);

      expect(findAndCountOptions().where).toEqual({});
    });

    it('sin condominio y sin super-admin: página vacía sin consultar', async () => {
      await expect(
        service.findAll({ page: 1, limit: 20 }, NO_ORG),
      ).resolves.toEqual({
        data: [],
        meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      });
      expect(repository.findAndCount).not.toHaveBeenCalled();
    });

    it('del usuario solo devuelve id, name y email', async () => {
      await service.findAll({}, ADMIN_A);

      const options = findAndCountOptions();
      expect(options.select.user).toEqual({
        id: true,
        name: true,
        email: true,
      });
      expect(options.relations).toEqual({ user: true });
      expect(options.loadEagerRelations).toBe(false);
    });
  });

  it('findOne: Administrador acotado a su condominio; super-admin sin filtro; sin condominio null sin consultar', async () => {
    await service.findOne('log-1', ADMIN_A);
    await service.findOne('log-1', SUPER_ADMIN);
    await expect(service.findOne('log-1', NO_ORG)).resolves.toBeNull();

    expect(
      (repository.findOne.mock.calls as Array<[{ where: unknown }]>).map(
        ([options]) => options.where,
      ),
    ).toEqual([{ id: 'log-1', organizationId: ORG_A }, { id: 'log-1' }]);
  });

  it('getEntityHistory: acotado al condominio del lector', async () => {
    await service.getEntityHistory('User', 'user-1', ADMIN_A);
    await expect(
      service.getEntityHistory('User', 'user-1', NO_ORG),
    ).resolves.toEqual([]);

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entityType: 'User',
          entityId: 'user-1',
          organizationId: ORG_A,
        },
      }),
    );
  });

  it('getStats: el total y los tres agregados quedan acotados al condominio', async () => {
    await service.getStats(ADMIN_A);

    expect(repository.count).toHaveBeenCalledWith({
      where: { organizationId: ORG_A },
    });
    expect(queryBuilderWheres).toHaveLength(3);
    for (const where of queryBuilderWheres) {
      expect(where).toEqual(expect.objectContaining({ organizationId: ORG_A }));
    }
  });

  it('getStats sin condominio: todo en cero, sin consultar', async () => {
    await expect(service.getStats(NO_ORG)).resolves.toEqual({
      totalLogs: 0,
      actionStats: [],
      moduleStats: [],
      topUsers: [],
    });
    expect(repository.count).not.toHaveBeenCalled();
  });

  describe('auditReaderOf (controller)', () => {
    it('toma isSuperAdmin y organizationId del tenantContext de la request', () => {
      expect(
        auditReaderOf({
          tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
        } as Parameters<typeof auditReaderOf>[0]),
      ).toEqual(ADMIN_A);
    });

    it('sin tenantContext: ni super-admin ni condominio (fail-closed)', () => {
      expect(auditReaderOf({} as Parameters<typeof auditReaderOf>[0])).toEqual(
        NO_ORG,
      );
    });
  });
});

/**
 * El SQL que arma TypeORM de verdad, con la metadata de todas las entidades y
 * un `DataSource` que no se conecta: se intercepta la ejecución.
 */
describe('AuditService — SQL real de TypeORM (sin BD)', () => {
  let dataSource: DataSource;
  let service: AuditService;

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
    service = new AuditService(dataSource.getRepository(AuditLog));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('findAll del Administrador: filtra por organizationId y del usuario solo trae id, name y email', async () => {
    let sql = '';
    jest
      .spyOn(SelectQueryBuilder.prototype, 'getManyAndCount')
      .mockImplementation(function (this: SelectQueryBuilder<AuditLog>) {
        sql = this.getQuery();
        return Promise.resolve([[], 0] as [AuditLog[], number]);
      });

    await service.findAll({}, ADMIN_A);

    expect(sql).toMatch(/"organizationId" = :/);
    expect(sql).toMatch(/_user"\."name"/);
    expect(sql).toMatch(/_user"\."email"/);
    expect(sql).not.toContain('"rut"');
    expect(sql).not.toContain('"phone"');
    // Sin la relación eager `user.roles`.
    expect(sql).not.toContain('"role"');
  });
});
