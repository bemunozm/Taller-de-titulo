import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  Column,
  DataSource,
  Entity,
  FindOperator,
  type FindOptionsWhere,
  PrimaryColumn,
} from 'typeorm';
import {
  applyTenantFilter,
  isInTenant,
  isInTenantScope,
  organizationExists,
  resolveCreationOrganizationId,
  scopeWhere,
  stampOrganizationId,
  tenantWhereCondition,
} from './tenant-context.util';
import type { TenantContext } from './tenant-context.types';

/**
 * Fase 4 · P3 (seguridad A1): `scopeWhere` con un contexto sin condominio.
 * En TypeORM 0.3 un `organizationId: null` literal en un `where` objeto se
 * descarta (la consulta quedaba SIN filtro de tenant); ahora se usa
 * `IsNull()`. Se verifica el SQL que arma TypeORM de verdad, con una entidad
 * mínima y un `DataSource` que no se conecta (solo construye metadata).
 */
@Entity({ name: 'tenant_rows' })
class TenantRow {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  organizationId: string | null;
}

const NO_ORG: TenantContext = { organizationId: null, isSuperAdmin: false };
const ORG_A: TenantContext = { organizationId: 'org-A', isSuperAdmin: false };
const SUPER_ADMIN: TenantContext = { organizationId: null, isSuperAdmin: true };

describe('tenant-context.util — scopeWhere (Fase 4 · P3, seguridad A1)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({ type: 'postgres', entities: [TenantRow] });
    // Construye la metadata sin abrir conexión (no hay BD en los unit tests).
    await (
      dataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
  });

  /** Cláusula WHERE del SQL que arma TypeORM para `find({ where })`. */
  function whereSqlFor(
    where: FindOptionsWhere<TenantRow> | FindOptionsWhere<TenantRow>[],
  ): string {
    const sql = dataSource
      .getRepository(TenantRow)
      .createQueryBuilder('row')
      .setFindOptions({ where })
      .getQuery();
    const index = sql.indexOf(' WHERE ');
    return index >= 0 ? sql.slice(index) : '';
  }

  it('Fase 4 · P5.C: contexto sin condominio -> In([]) (ninguna fila), nunca IS NULL ni un null literal', () => {
    const where = scopeWhere<FindOptionsWhere<TenantRow>>(
      { id: 'row-1' },
      NO_ORG,
    ) as FindOptionsWhere<TenantRow>;

    expect(where.organizationId).toBeInstanceOf(FindOperator);
    const operator = where.organizationId as FindOperator<string>;
    expect(operator.type).toBe('in');
    expect(operator.value).toEqual([]);
  });

  it('SQL generado: el contexto sin condominio no devuelve filas (0=1), sin el "cajón nulo"', () => {
    const sql = whereSqlFor(
      scopeWhere<FindOptionsWhere<TenantRow>>({ id: 'row-1' }, NO_ORG),
    );

    expect(sql).toMatch(/0=1/);
    expect(sql).not.toMatch(/IS NULL/);
    expect(sql).toMatch(/"row"\."id" = :orm_param_0/);
  });

  it('regresión documentada: un null literal (el bug) desaparece del SQL', () => {
    const sql = whereSqlFor({
      id: 'row-1',
      organizationId: null,
    } as unknown as FindOptionsWhere<TenantRow>);

    expect(sql).toMatch(/"row"\."id" = :orm_param_0/);
    expect(sql).not.toMatch(/organizationId/);
  });

  it('con condominio -> igualdad exacta en el SQL', () => {
    const where = scopeWhere<FindOptionsWhere<TenantRow>>(
      { id: 'row-1' },
      ORG_A,
    );

    expect(where).toEqual({ id: 'row-1', organizationId: 'org-A' });
    expect(whereSqlFor(where)).toMatch(
      /"row"\."organizationId" = :orm_param_1/,
    );
  });

  it('forma array (OR): cada cláusula lleva el filtro de tenant', () => {
    const where = scopeWhere<FindOptionsWhere<TenantRow>>(
      [{ id: 'row-1' }, { id: 'row-2' }],
      NO_ORG,
    ) as FindOptionsWhere<TenantRow>[];

    expect(where).toHaveLength(2);
    for (const clause of where) {
      expect((clause.organizationId as FindOperator<string>).type).toBe('in');
    }
    expect(whereSqlFor(where).match(/0=1/g)).toHaveLength(2);

    const withOrg = scopeWhere<FindOptionsWhere<TenantRow>>(
      [{ id: 'row-1' }, { id: 'row-2' }],
      ORG_A,
    );
    expect(withOrg).toEqual([
      { id: 'row-1', organizationId: 'org-A' },
      { id: 'row-2', organizationId: 'org-A' },
    ]);
  });

  it('where vacío o array vacío: solo el filtro de tenant', () => {
    expect(scopeWhere({}, ORG_A)).toEqual({ organizationId: 'org-A' });
    expect(scopeWhere([], ORG_A)).toEqual([{ organizationId: 'org-A' }]);
  });

  it('super-admin: sin filtro de tenant (bypass real)', () => {
    expect(scopeWhere({ id: 'row-1' }, SUPER_ADMIN)).toEqual({ id: 'row-1' });
    expect(
      whereSqlFor(
        scopeWhere<FindOptionsWhere<TenantRow>>({ id: 'row-1' }, SUPER_ADMIN),
      ),
    ).not.toMatch(/organizationId/);
  });

  it('tenantWhereCondition: string -> igualdad; null -> IsNull()', () => {
    expect(tenantWhereCondition('org-A')).toEqual({ organizationId: 'org-A' });
    const condition = tenantWhereCondition(null);
    expect((condition.organizationId as FindOperator<string>).type).toBe(
      'isNull',
    );
  });
});

describe('tenant-context.util — Fase 4 · P5.C (sin condominio → vacío; creación estricta)', () => {
  function recordingQb() {
    const clauses: Array<{ sql: string; params?: Record<string, unknown> }> =
      [];
    const qb = {
      andWhere(sql: string, params?: Record<string, unknown>) {
        clauses.push({ sql, params });
        return qb;
      },
    };
    return { qb, clauses };
  }

  it('applyTenantFilter: sin condominio -> 1 = 0 (antes IS NULL); con condominio -> igualdad; super-admin -> nada', () => {
    const none = recordingQb();
    applyTenantFilter(none.qb as never, 'visit', NO_ORG);
    expect(none.clauses).toEqual([{ sql: '1 = 0', params: undefined }]);

    const orgA = recordingQb();
    applyTenantFilter(orgA.qb as never, 'visit', ORG_A);
    expect(orgA.clauses).toEqual([
      {
        sql: 'visit."organizationId" = :tenantOrgId',
        params: { tenantOrgId: 'org-A' },
      },
    ]);

    const platform = recordingQb();
    applyTenantFilter(platform.qb as never, 'visit', SUPER_ADMIN);
    expect(platform.clauses).toEqual([]);
  });

  it('isInTenant: null === null ya no calza; super-admin alcanza todo', () => {
    expect(isInTenant(null, NO_ORG)).toBe(false);
    expect(isInTenant('org-A', NO_ORG)).toBe(false);
    expect(isInTenant('org-A', ORG_A)).toBe(true);
    expect(isInTenant('org-B', ORG_A)).toBe(false);
    expect(isInTenant(null, ORG_A)).toBe(false);
    expect(isInTenant(null, SUPER_ADMIN)).toBe(true);
    expect(isInTenantScope(null, { tenantId: null, isSuperAdmin: false })).toBe(
      false,
    );
    expect(
      isInTenantScope('org-A', { tenantId: 'org-A', isSuperAdmin: false }),
    ).toBe(true);
  });

  describe('resolveCreationOrganizationId / stampOrganizationId', () => {
    it('actor con condominio: el suyo', () => {
      expect(resolveCreationOrganizationId(ORG_A)).toBe('org-A');
      expect(stampOrganizationId({ organizationId: null }, ORG_A)).toEqual({
        organizationId: 'org-A',
      });
    });

    it('actor sin condominio -> 403 (antes quedaba en el cajón nulo)', () => {
      expect(() => resolveCreationOrganizationId(NO_ORG)).toThrow(
        ForbiddenException,
      );
      expect(() =>
        stampOrganizationId({ organizationId: null }, NO_ORG),
      ).toThrow(ForbiddenException);
    });

    it('un actor que no es super-admin y envía organizationId -> 403', () => {
      expect(() => resolveCreationOrganizationId(ORG_A, 'org-B')).toThrow(
        ForbiddenException,
      );
      expect(() => resolveCreationOrganizationId(ORG_A, 'org-A')).toThrow(
        ForbiddenException,
      );
    });

    it('super-admin sin organizationId -> 400; con él -> ese', () => {
      expect(() => resolveCreationOrganizationId(SUPER_ADMIN)).toThrow(
        BadRequestException,
      );
      expect(resolveCreationOrganizationId(SUPER_ADMIN, 'org-B')).toBe('org-B');
    });
  });

  it('organizationExists: consulta organization y es fail-closed ante errores', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ ok: 1 }]);
    const ds = { query } as unknown as DataSource;
    await expect(organizationExists('org-A', ds)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM organization WHERE id = $1'),
      ['org-A'],
    );

    query.mockResolvedValueOnce([]);
    await expect(organizationExists('org-X', ds)).resolves.toBe(false);

    query.mockRejectedValueOnce(new Error('db down'));
    await expect(organizationExists('org-A', ds)).resolves.toBe(false);
  });
});
