import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EMPTY_TENANT_CONTEXT, PLATFORM_SUPER_ADMIN_ROLE, TenantContext } from './tenant-context.types';

/**
 * Resuelve la organización (condominio) de un usuario desde su MEMBRESÍA
 * (tabla `member`, creada por el plugin `organization` de better-auth vía su
 * CLI — no tiene entidad TypeORM, mismo criterio que `session`/`account` en
 * src/auth/better-auth.ts). Se consulta con SQL directo sobre el mismo
 * `DataSource` de TypeORM (comparten el schema `public`, ver better-auth.ts).
 *
 * Se toma la membresía más antigua si hubiera más de una — hoy cada usuario de
 * dominio pertenece a EXACTAMENTE una organización (decisión cerrada, doc
 * §10.4); soportar múltiples organizaciones por usuario (cambio de
 * "organización activa") queda para una fase posterior.
 */
export async function resolveOrganizationIdForUser(
  userId: string,
  dataSource: DataSource,
): Promise<string | null> {
  try {
    const rows = await dataSource.query<Array<{ organizationId: string }>>(
      `SELECT "organizationId" FROM member WHERE "userId" = $1 ORDER BY "createdAt" ASC LIMIT 1`,
      [userId],
    );
    return rows[0]?.organizationId ?? null;
  } catch (error) {
    // La tabla `member` la crea el CLI de better-auth
    // (npx @better-auth/cli migrate --config src/auth/better-auth.ts). Si aún
    // no corrió (o el plugin no está montado), no rompemos el request: se
    // trata como "usuario sin organización" en vez de 500.
    return null;
  }
}

/**
 * DECISIÓN ARQUITECTÓNICA (ver prompt de la tarea #19): el tenant se resuelve
 * desde la MEMBRESÍA de organización del `request.user` (RBAC fino app-side +
 * tabla `member`), NO desde `session.activeOrganizationId` de better-auth. El
 * frontend aún usa JWT legacy (no cutea a cookies hasta #20), así que
 * `session.activeOrganizationId` no siempre existe; resolviendo desde
 * membresía, el scoping funciona igual con sesión better-auth O JWT legacy.
 *
 * `user.roles` debe venir poblado (AuthGuard ya carga `roles.permissions` +
 * `family` en `request.user` — ver src/auth/auth.guard.ts).
 */
export async function resolveTenantContext(
  user: { id: string; roles?: Array<{ name: string }> } | null | undefined,
  dataSource: DataSource,
): Promise<TenantContext> {
  if (!user) {
    // Rutas @Public / endpoints de worker (sin request.user) — ver
    // tenant.interceptor.ts.
    return { ...EMPTY_TENANT_CONTEXT };
  }

  const isSuperAdmin = user.roles?.some((role) => role.name === PLATFORM_SUPER_ADMIN_ROLE) ?? false;
  if (isSuperAdmin) {
    // Cross-tenant real: la plataforma no tiene condominio propio.
    return { organizationId: null, isSuperAdmin: true };
  }

  const organizationId = await resolveOrganizationIdForUser(user.id, dataSource);
  return { organizationId, isSuperAdmin: false };
}

/**
 * Exige que el contexto tenga una organización concreta (p.ej. endpoints de
 * onboarding donde el admin-de-condominio invita/crea usuarios EN su propia
 * organización). El super-admin no tiene una organización propia — para esos
 * flujos debe operar por un endpoint distinto que reciba el organizationId
 * explícito (ver OnboardingController).
 */
export function requireOrganizationId(ctx: TenantContext): string {
  if (ctx.isSuperAdmin) {
    throw new ForbiddenException(
      'La plataforma (super-admin) no pertenece a ningún condominio — especifica el organizationId de destino explícitamente.',
    );
  }
  if (!ctx.organizationId) {
    throw new ForbiddenException('Tu cuenta no pertenece a ningún condominio todavía.');
  }
  return ctx.organizationId;
}

/**
 * Aplica el filtro de tenant a un `where` de TypeORM (`repository.find({where})`),
 * soportando tanto la forma objeto como la forma array (condiciones OR).
 * Super-admin: sin filtro (bypass real). Resto: `organizationId` exacto
 * (incluye `null` — ver docstring de stampOrganizationId sobre el caso
 * transitorio "usuario sin organización").
 */
export function scopeWhere<T extends Record<string, any>>(
  where: T | T[] | undefined,
  ctx: TenantContext,
): T | T[] {
  if (ctx.isSuperAdmin) {
    return (where ?? ({} as T)) as T | T[];
  }

  const tenantCondition = { organizationId: ctx.organizationId } as unknown as Partial<T>;

  if (Array.isArray(where)) {
    if (where.length === 0) {
      return [tenantCondition as T];
    }
    return where.map((clause) => ({ ...clause, ...tenantCondition })) as T[];
  }

  return { ...(where ?? ({} as T)), ...tenantCondition } as T;
}

/**
 * Igual que scopeWhere pero para QueryBuilder (`qb.andWhere(...)`), usado por
 * los servicios que arman queries manualmente (joins, agregaciones, etc).
 */
export function applyTenantFilter<T extends { andWhere: Function }>(
  qb: T,
  alias: string,
  ctx: TenantContext,
): T {
  if (ctx.isSuperAdmin) {
    return qb;
  }
  if (ctx.organizationId === null) {
    return (qb as any).andWhere(`${alias}."organizationId" IS NULL`);
  }
  return (qb as any).andWhere(`${alias}."organizationId" = :tenantOrgId`, {
    tenantOrgId: ctx.organizationId,
  });
}

/**
 * Estampa `organizationId` en una entidad nueva antes de guardarla.
 *
 * Comportamiento deliberadamente LENIENTE (no lanza si `ctx.organizationId`
 * es `null`): con ~cero datos y usuarios legacy que todavía no tienen
 * membresía de organización (pre-#19), bloquear la creación rompería los
 * smoke tests de módulos existentes (requisito del prompt: "el scoping no
 * debe romper endpoints"). El resultado queda con `organizationId: null`
 * (mismo "cajón" visible únicamente por super-admin y por otros usuarios sin
 * organización — ver scopeWhere). Los flujos de onboarding (#19, más abajo)
 * SÍ deben pasar por `requireOrganizationId` antes de llegar acá cuando la
 * organización es obligatoria para la operación de negocio.
 *
 * Super-admin: NO se estampa (no tiene organización propia); si quiere crear
 * un recurso para un condominio específico, debe proveerlo explícitamente en
 * el DTO antes de llamar a este helper (no es el flujo típico de #19).
 */
export function stampOrganizationId<T extends { organizationId?: string | null }>(
  entity: T,
  ctx: TenantContext,
): T {
  if (!ctx.isSuperAdmin) {
    entity.organizationId = ctx.organizationId;
  }
  return entity;
}
