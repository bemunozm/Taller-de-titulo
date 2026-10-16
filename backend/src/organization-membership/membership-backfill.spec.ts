import {
  countUsersWithoutMembership,
  planMembershipBackfill,
  runMembershipBackfill,
  toBackfillCandidate,
  type MembershipBackfillCandidate,
  type SqlExecutor,
} from './membership-backfill';

/**
 * Fase 4 · P5 (D11): backfill de membresías desde `user.family.organizationId`.
 * Se prueba el plan (puro) y la ejecución contra una "BD" en memoria que
 * entiende las tres consultas del módulo.
 */
const ORG_A = 'org-a';
const ORG_B = 'org-b';

function candidate(
  overrides: Partial<MembershipBackfillCandidate> & { userId: string },
): MembershipBackfillCandidate {
  return {
    email: `${overrides.userId}@x.cl`,
    isSuperAdmin: false,
    familyId: null,
    familyOrganizationId: null,
    familyOrganizationExists: false,
    membershipOrganizationIds: [],
    ...overrides,
  };
}

const WITH_FAMILY_A = {
  familyId: 'family-a',
  familyOrganizationId: ORG_A,
  familyOrganizationExists: true,
};

describe('planMembershipBackfill (puro)', () => {
  const plan = planMembershipBackfill([
    candidate({ userId: 'root', isSuperAdmin: true }),
    candidate({ userId: 'add', ...WITH_FAMILY_A }),
    candidate({
      userId: 'ok',
      ...WITH_FAMILY_A,
      membershipOrganizationIds: [ORG_A],
    }),
    candidate({ userId: 'ok-sin-familia', membershipOrganizationIds: [ORG_B] }),
    candidate({ userId: 'nofam' }),
    candidate({ userId: 'famnull', familyId: 'family-null' }),
    candidate({
      userId: 'ghost',
      familyId: 'family-ghost',
      familyOrganizationId: 'org-borrado',
      familyOrganizationExists: false,
    }),
    candidate({
      userId: 'conflict',
      ...WITH_FAMILY_A,
      membershipOrganizationIds: [ORG_B],
    }),
    candidate({ userId: 'multi', membershipOrganizationIds: [ORG_A, ORG_B] }),
  ]);

  it('crea la membresía solo para quien tiene familia de un condominio y ninguna membresía', () => {
    expect(plan.toAdd).toEqual([
      { userId: 'add', email: 'add@x.cl', organizationId: ORG_A },
    ]);
  });

  it('no toca a los super-admin (aunque no tengan membresía)', () => {
    expect(plan.skippedSuperAdmins).toBe(1);
    expect(plan.toAdd.map((a) => a.userId)).not.toContain('root');
  });

  it('cuenta a los que ya tienen una membresía coherente', () => {
    expect(plan.alreadyMembers).toBe(2);
  });

  it('reporta a los usuarios sin familia ni membresía', () => {
    expect(plan.withoutFamily).toEqual([
      { userId: 'nofam', email: 'nofam@x.cl' },
    ]);
  });

  it('reporta los casos ambiguos sin tocarlos', () => {
    expect(
      Object.fromEntries(plan.ambiguous.map((a) => [a.userId, a.reason])),
    ).toEqual({
      famnull: 'family-without-organization',
      ghost: 'family-organization-not-found',
      conflict: 'membership-conflicts-with-family',
      multi: 'multiple-memberships',
    });
  });
});

describe('toBackfillCandidate', () => {
  it('normaliza la fila del driver pg', () => {
    expect(
      toBackfillCandidate({
        userId: 'u1',
        email: 'u1@x.cl',
        familyId: null,
        familyOrganizationId: null,
        familyOrganizationExists: false,
        isSuperAdmin: true,
        membershipOrganizationIds: [ORG_A],
      }),
    ).toEqual({
      userId: 'u1',
      email: 'u1@x.cl',
      familyId: null,
      familyOrganizationId: null,
      familyOrganizationExists: false,
      isSuperAdmin: true,
      membershipOrganizationIds: [ORG_A],
    });
  });
});

/** "BD" en memoria: usuarios (con familia) y membresías. */
class FakeDatabase implements SqlExecutor {
  readonly members: Array<{ userId: string; organizationId: string }> = [];
  readonly organizations = new Set([ORG_A, ORG_B]);
  readonly inserts: unknown[][] = [];

  constructor(private readonly users: MembershipBackfillCandidate[]) {}

  query<T extends object>(
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]> {
    if (sql.includes('INSERT INTO member')) {
      const [organizationId, userId] = params as [string, string];
      this.inserts.push([...params]);
      const exists = this.members.some((m) => m.userId === userId);
      if (exists || !this.organizations.has(organizationId)) {
        return Promise.resolve([]);
      }
      this.members.push({ userId, organizationId });
      return Promise.resolve([
        { id: `m-${this.members.length}` },
      ] as unknown as T[]);
    }
    if (sql.includes('COUNT(*)')) {
      const count = this.rows().filter(
        (row) =>
          !row.isSuperAdmin && row.membershipOrganizationIds.length === 0,
      ).length;
      return Promise.resolve([{ count }] as unknown as T[]);
    }
    return Promise.resolve(
      this.rows().map((row) => ({ ...row })) as unknown as T[],
    );
  }

  private rows(): MembershipBackfillCandidate[] {
    return this.users.map((user) => ({
      ...user,
      membershipOrganizationIds: [
        ...user.membershipOrganizationIds,
        ...this.members
          .filter((m) => m.userId === user.userId)
          .map((m) => m.organizationId),
      ],
    }));
  }
}

describe('runMembershipBackfill', () => {
  function seed(): FakeDatabase {
    return new FakeDatabase([
      candidate({ userId: 'root', isSuperAdmin: true }),
      candidate({ userId: 'add', ...WITH_FAMILY_A }),
      candidate({ userId: 'nofam' }),
      candidate({ userId: 'multi', membershipOrganizationIds: [ORG_A, ORG_B] }),
    ]);
  }

  it('dry-run (por defecto en el script): planifica pero no escribe nada', async () => {
    const db = seed();

    const report = await runMembershipBackfill(db, { apply: false });

    expect(report.dryRun).toBe(true);
    expect(report.added).toBe(0);
    expect(report.toAdd.map((a) => a.userId)).toEqual(['add']);
    expect(db.inserts).toEqual([]);
  });

  it('apply crea las membresías; una segunda corrida no cambia nada (idempotente)', async () => {
    const db = seed();

    const first = await runMembershipBackfill(db, { apply: true });
    const second = await runMembershipBackfill(db, { apply: true });

    expect(first.added).toBe(1);
    expect(db.members).toEqual([{ userId: 'add', organizationId: ORG_A }]);
    expect(second.added).toBe(0);
    expect(second.toAdd).toEqual([]);
    expect(second.alreadyMembers).toBe(1);
    expect(second.ambiguous.map((a) => a.userId)).toEqual(['multi']);
    expect(second.withoutFamily.map((u) => u.userId)).toEqual(['nofam']);
  });

  it('el INSERT es condicional: si la membresía ya existe al escribir, no duplica', async () => {
    const db = seed();
    db.members.push({ userId: 'add', organizationId: ORG_A });
    const report = await runMembershipBackfill(db, { apply: false });
    expect(report.toAdd).toEqual([]);
  });

  it('countUsersWithoutMembership: no cuenta super-admin', async () => {
    const db = seed();
    await expect(countUsersWithoutMembership(db)).resolves.toBe(2);

    await runMembershipBackfill(db, { apply: true });
    await expect(countUsersWithoutMembership(db)).resolves.toBe(1);
  });
});
