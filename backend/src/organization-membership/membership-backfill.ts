/**
 * Backfill de membresías (Fase 4 · P5, D11).
 *
 * Antes de la P5, `POST /users` y `POST /users/create-by-admin` creaban
 * usuarios SIN membresía (`member` de better-auth). Con el aislamiento por
 * condominio esos usuarios desaparecerían de su condominio, así que este
 * módulo deriva la membresía faltante de `user.family.organizationId`.
 *
 * Reglas (idempotente: correrlo dos veces no cambia nada la segunda vez):
 *  - Los super-admin no se tocan (la plataforma no tiene condominio).
 *  - Con exactamente una membresía coherente con su familia: ya está.
 *  - Sin membresía y con familia de un condominio existente: se crea la
 *    membresía (`role = 'member'`).
 *  - Sin membresía y sin familia: se REPORTA (no hay de dónde derivarla).
 *  - Casos ambiguos (se reportan, no se tocan): varias membresías, membresía
 *    en otro condominio que el de su familia, familia sin condominio, o
 *    familia de un condominio que ya no existe.
 *
 * Sin imports de Nest ni de TypeORM: lo carga también el script
 * `backend/scripts/backfill-memberships.js` (con un cliente `pg`), y la app lo
 * usa para el aviso al arrancar (`countUsersWithoutMembership`).
 */
import { PLATFORM_SUPER_ADMIN_ROLE } from '../common/tenant/tenant-context.types';

/** Lo mínimo que se necesita de una conexión: ejecutar SQL con parámetros. */
export interface SqlExecutor {
  query<T extends object>(
    sql: string,
    params: readonly unknown[],
  ): Promise<T[]>;
}

/** Un usuario, con lo necesario para decidir su membresía. */
export interface MembershipBackfillCandidate {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  familyId: string | null;
  familyOrganizationId: string | null;
  /** `false` si la familia apunta a un condominio que no existe. */
  familyOrganizationExists: boolean;
  /** Condominios de sus membresías actuales (de la más antigua a la más nueva). */
  membershipOrganizationIds: readonly string[];
}

export interface BackfillUserRef {
  userId: string;
  email: string;
}

export interface BackfillAddition extends BackfillUserRef {
  organizationId: string;
}

export type BackfillAmbiguityReason =
  | 'multiple-memberships'
  | 'membership-conflicts-with-family'
  | 'family-without-organization'
  | 'family-organization-not-found';

export interface BackfillAmbiguity extends BackfillUserRef {
  reason: BackfillAmbiguityReason;
  familyOrganizationId: string | null;
  membershipOrganizationIds: readonly string[];
}

export interface MembershipBackfillPlan {
  toAdd: BackfillAddition[];
  alreadyMembers: number;
  skippedSuperAdmins: number;
  /** Sin familia ni membresía: hay que resolverlos a mano. */
  withoutFamily: BackfillUserRef[];
  ambiguous: BackfillAmbiguity[];
}

export interface MembershipBackfillReport extends MembershipBackfillPlan {
  dryRun: boolean;
  /** Membresías creadas de verdad (0 en dry-run). */
  added: number;
}

/** Decide, sin efectos, qué hacer con cada usuario. */
export function planMembershipBackfill(
  candidates: readonly MembershipBackfillCandidate[],
): MembershipBackfillPlan {
  const plan: MembershipBackfillPlan = {
    toAdd: [],
    alreadyMembers: 0,
    skippedSuperAdmins: 0,
    withoutFamily: [],
    ambiguous: [],
  };

  for (const candidate of candidates) {
    const ref: BackfillUserRef = {
      userId: candidate.userId,
      email: candidate.email,
    };
    const ambiguity = (reason: BackfillAmbiguityReason): BackfillAmbiguity => ({
      ...ref,
      reason,
      familyOrganizationId: candidate.familyOrganizationId,
      membershipOrganizationIds: candidate.membershipOrganizationIds,
    });
    const memberships = candidate.membershipOrganizationIds;

    if (candidate.isSuperAdmin) {
      plan.skippedSuperAdmins += 1;
    } else if (memberships.length > 1) {
      plan.ambiguous.push(ambiguity('multiple-memberships'));
    } else if (memberships.length === 1) {
      if (
        candidate.familyOrganizationId !== null &&
        candidate.familyOrganizationId !== memberships[0]
      ) {
        plan.ambiguous.push(ambiguity('membership-conflicts-with-family'));
      } else {
        plan.alreadyMembers += 1;
      }
    } else if (candidate.familyId === null) {
      plan.withoutFamily.push(ref);
    } else if (candidate.familyOrganizationId === null) {
      plan.ambiguous.push(ambiguity('family-without-organization'));
    } else if (!candidate.familyOrganizationExists) {
      plan.ambiguous.push(ambiguity('family-organization-not-found'));
    } else {
      plan.toAdd.push({
        ...ref,
        organizationId: candidate.familyOrganizationId,
      });
    }
  }

  return plan;
}

const LOAD_CANDIDATES_SQL = `
  SELECT u.id AS "userId",
         u.email AS "email",
         u."familyId" AS "familyId",
         f."organizationId" AS "familyOrganizationId",
         (o.id IS NOT NULL) AS "familyOrganizationExists",
         EXISTS (
           SELECT 1
             FROM user_roles_role ur
             INNER JOIN role r ON r.id = ur."roleId"
            WHERE ur."userId" = u.id
              AND r.name = $1
         ) AS "isSuperAdmin",
         ARRAY(
           SELECT m."organizationId"::text
             FROM member m
            WHERE m."userId" = u.id
            ORDER BY m."createdAt" ASC
         ) AS "membershipOrganizationIds"
    FROM "user" u
    LEFT JOIN families f ON f.id = u."familyId"
    LEFT JOIN organization o ON o.id = f."organizationId"
   ORDER BY u."createdAt" ASC, u.id ASC`;

/**
 * Inserta la membresía solo si el usuario sigue sin ninguna y el condominio
 * existe: re-ejecutable y sin romper por una FK si algo cambió entre el plan
 * y la escritura.
 */
const INSERT_MEMBERSHIP_SQL = `
  INSERT INTO member ("organizationId", "userId", role, "createdAt")
  SELECT $1::uuid, $2::uuid, 'member', now()
   WHERE NOT EXISTS (SELECT 1 FROM member WHERE "userId" = $2::uuid)
     AND EXISTS (SELECT 1 FROM organization WHERE id = $1::uuid)
  RETURNING id`;

const COUNT_USERS_WITHOUT_MEMBERSHIP_SQL = `
  SELECT COUNT(*)::int AS "count"
    FROM "user" u
   WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m."userId" = u.id)
     AND NOT EXISTS (
       SELECT 1
         FROM user_roles_role ur
         INNER JOIN role r ON r.id = ur."roleId"
        WHERE ur."userId" = u.id
          AND r.name = $1
     )`;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Normaliza una fila de `LOAD_CANDIDATES_SQL` (driver `pg`). */
export function toBackfillCandidate(
  row: Record<string, unknown>,
): MembershipBackfillCandidate {
  return {
    userId: String(row.userId),
    email: asString(row.email) ?? '',
    isSuperAdmin: row.isSuperAdmin === true,
    familyId: asString(row.familyId),
    familyOrganizationId: asString(row.familyOrganizationId),
    familyOrganizationExists: row.familyOrganizationExists === true,
    membershipOrganizationIds: asStringArray(row.membershipOrganizationIds),
  };
}

export async function loadBackfillCandidates(
  db: SqlExecutor,
): Promise<MembershipBackfillCandidate[]> {
  const rows = await db.query<Record<string, unknown>>(LOAD_CANDIDATES_SQL, [
    PLATFORM_SUPER_ADMIN_ROLE,
  ]);
  return rows.map(toBackfillCandidate);
}

/**
 * Corre el backfill. Por defecto es dry-run (`apply: false`): solo planifica
 * y reporta. Con `apply: true` crea las membresías del plan.
 */
export async function runMembershipBackfill(
  db: SqlExecutor,
  options: { apply: boolean },
): Promise<MembershipBackfillReport> {
  const plan = planMembershipBackfill(await loadBackfillCandidates(db));
  let added = 0;

  if (options.apply) {
    for (const addition of plan.toAdd) {
      const inserted = await db.query<{ id: string }>(INSERT_MEMBERSHIP_SQL, [
        addition.organizationId,
        addition.userId,
      ]);
      added += inserted.length;
    }
  }

  return { ...plan, dryRun: !options.apply, added };
}

/** Usuarios que no son super-admin y no tienen ninguna membresía. */
export async function countUsersWithoutMembership(
  db: SqlExecutor,
): Promise<number> {
  const rows = await db.query<{ count: number | string }>(
    COUNT_USERS_WITHOUT_MEMBERSHIP_SQL,
    [PLATFORM_SUPER_ADMIN_ROLE],
  );
  return Number(rows[0]?.count ?? 0);
}
