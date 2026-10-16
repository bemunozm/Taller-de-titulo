import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  DataSource,
  In,
  IsNull,
  type FindOperator,
  type WhereExpressionBuilder,
} from 'typeorm';
import {
  EMPTY_TENANT_CONTEXT,
  PLATFORM_SUPER_ADMIN_ROLE,
  TenantContext,
  type TenantScope,
} from './tenant-context.types';

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
  } catch {
    // La tabla `member` la crea el CLI de better-auth
    // (npx @better-auth/cli migrate --config src/auth/better-auth.ts). Si aún
    // no corrió (o el plugin no está montado), no rompemos el request: se
    // trata como "usuario sin organización" en vez de 500.
    return null;
  }
}

/**
 * Indica si `userId` es miembro de `organizationId` (tabla `member`) y su
 * cuenta sigue activa (`user."deletedAt" IS NULL`: `UsersService.disable` es
 * un soft-delete). Misma fuente de membresía que `resolveOrganizationIdForUser`,
 * pero comprueba UNA organización concreta en vez de elegir la más antigua.
 *
 * Fail-closed: ante un error de BD responde `false` (el llamador niega el
 * acceso) en vez de propagar un 500.
 */
export async function isActiveMemberOfOrganization(
  userId: string,
  organizationId: string,
  dataSource: DataSource,
): Promise<boolean> {
  try {
    const rows = await dataSource.query<Array<{ ok: number }>>(
      `SELECT 1 AS ok
         FROM member m
         INNER JOIN "user" u ON u.id = m."userId"
        WHERE m."userId" = $1
          AND m."organizationId" = $2
          AND u."deletedAt" IS NULL
        LIMIT 1`,
      [userId, organizationId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * `true` si el usuario tiene el rol de plataforma (PLATFORM_SUPER_ADMIN_ROLE).
 * Única definición de "es super-admin" a partir de los roles (la usan
 * `resolveTenantContext`, `AuthService` y la política de asignación de roles).
 */
export function hasPlatformSuperAdminRole(
  user: { roles?: ReadonlyArray<{ name?: string }> | null } | null | undefined,
): boolean {
  return (
    user?.roles?.some((role) => role.name === PLATFORM_SUPER_ADMIN_ROLE) ??
    false
  );
}

/**
 * Fase 4 · P5 (D10): chequeo EXPLÍCITO de super-admin para las operaciones de
 * plataforma (mutar roles y permisos, leer los logs del sistema, crear
 * condominios). No depende solo del permiso de la ruta: un permiso se puede
 * asignar por error a otro rol; el rol de plataforma no.
 */
export function assertPlatformSuperAdmin(
  ctx: Pick<TenantContext, 'isSuperAdmin'>,
  message = 'Solo la plataforma (super-admin) puede realizar esta operación',
): void {
  if (!ctx.isSuperAdmin) {
    throw new ForbiddenException(message);
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

  const isSuperAdmin = hasPlatformSuperAdminRole(user);
  if (isSuperAdmin) {
    // Cross-tenant real: la plataforma no tiene condominio propio.
    return { organizationId: null, isSuperAdmin: true };
  }

  const organizationId = await resolveOrganizationIdForUser(
    user.id,
    dataSource,
  );
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
    throw new ForbiddenException(
      'Tu cuenta no pertenece a ningún condominio todavía.',
    );
  }
  return ctx.organizationId;
}

/**
 * Condición de DATOS sobre la columna `organizationId` para un `where` objeto
 * de TypeORM: igualdad, o `IS NULL` para buscar filas sin condominio. Sirve
 * para consultas internas cuyo condominio sale de un recurso ya cargado (p.
 * ej. el vehículo temporal de una visita), NO para acotar lo que ve un actor:
 * para eso está `scopeWhere`, donde un actor sin condominio no ve nada.
 *
 * Fase 4 · P3 (seguridad A1): `IS NULL` se expresa con `IsNull()`. En TypeORM
 * 0.3 un `organizationId: null` literal en un `where` objeto se DESCARTA
 * (`invalidWhereValuesBehavior.null = 'ignore'` por defecto), así que la
 * consulta quedaría sin filtro.
 */
export function tenantWhereCondition(organizationId: string | null): {
  organizationId: string | FindOperator<string>;
} {
  return { organizationId: organizationId ?? IsNull() };
}

/**
 * Condición de `where` objeto que no calza con ninguna fila: TypeORM traduce
 * `In([])` a `0=1`. La usa `scopeWhere` para un actor sin condominio.
 */
export function noTenantRowsCondition(): {
  organizationId: FindOperator<string>;
} {
  return { organizationId: In([] as string[]) as FindOperator<string> };
}

/**
 * Filtro de tenant de un ACTOR para un `where` objeto: super-admin, sin
 * filtro (`null`); con condominio, igualdad; sin condominio, ninguna fila
 * (Fase 4 · P5.C: antes era el "cajón nulo", `IS NULL`).
 */
function actorTenantCondition(ctx: TenantContext): {
  organizationId: string | FindOperator<string>;
} | null {
  if (ctx.isSuperAdmin) {
    return null;
  }
  return ctx.organizationId
    ? { organizationId: ctx.organizationId }
    : noTenantRowsCondition();
}

/**
 * ¿Un recurso del condominio `resourceOrganizationId` está al alcance del
 * contexto? Super-admin: siempre. Resto: solo si el actor TIENE condominio y
 * es el mismo (Fase 4 · P5.C: `null === null` ya no calza; un actor o
 * dispositivo sin condominio no alcanza a ningún recurso, tampoco a los que
 * no tienen condominio).
 */
export function isInTenant(
  resourceOrganizationId: string | null | undefined,
  ctx: Pick<TenantContext, 'organizationId' | 'isSuperAdmin'>,
): boolean {
  if (ctx.isSuperAdmin) {
    return true;
  }
  return (
    ctx.organizationId !== null && resourceOrganizationId === ctx.organizationId
  );
}

/** `isInTenant` con el vocabulario del agente / conserje digital (`TenantScope`). */
export function isInTenantScope(
  resourceOrganizationId: string | null | undefined,
  scope: TenantScope,
): boolean {
  return isInTenant(resourceOrganizationId, {
    organizationId: scope.tenantId,
    isSuperAdmin: scope.isSuperAdmin,
  });
}

/**
 * Aplica el filtro de tenant a un `where` de TypeORM (`repository.find({where})`),
 * soportando tanto la forma objeto como la forma array (condiciones OR).
 * Super-admin: sin filtro (bypass real). Resto: `organizationId` exacto.
 *
 * Fase 4 · P5.C: un contexto SIN condominio (humano sin membresía, hub sin
 * condominio asignado) no ve ninguna fila. Antes veía el "cajón nulo" (`IS
 * NULL`): filas sin condominio que no son de nadie.
 */
export function scopeWhere<T extends object>(
  where: T | T[] | undefined,
  ctx: TenantContext,
): T | T[] {
  const condition = actorTenantCondition(ctx);
  if (!condition) {
    return where ?? ({} as T);
  }

  const tenantCondition = condition as unknown as Partial<T>;

  if (Array.isArray(where)) {
    if (where.length === 0) {
      return [tenantCondition as T];
    }
    return where.map((clause): T => ({ ...clause, ...tenantCondition }));
  }

  return { ...(where ?? ({} as T)), ...tenantCondition };
}

/**
 * Igual que scopeWhere pero para QueryBuilder (`qb.andWhere(...)`), usado por
 * los servicios que arman queries manualmente (joins, agregaciones, etc).
 * Fase 4 · P5.C: sin condominio (y sin ser super-admin) no devuelve filas.
 */
export function applyTenantFilter<T extends WhereExpressionBuilder>(
  qb: T,
  alias: string,
  ctx: TenantContext,
): T {
  if (ctx.isSuperAdmin) {
    return qb;
  }
  if (!ctx.organizationId) {
    return qb.andWhere('1 = 0');
  }
  return qb.andWhere(`${alias}."organizationId" = :tenantOrgId`, {
    tenantOrgId: ctx.organizationId,
  });
}

/**
 * Condominio de un recurso NUEVO del condominio (cámara, unidad, familia,
 * vehículo), Fase 4 · P5.C (creación estricta):
 *  - super-admin: no tiene condominio propio, así que DEBE indicar
 *    `requestedOrganizationId` (si no, 400). Que exista lo valida
 *    `TenantContextService.resolveCreationOrganizationId`;
 *  - cualquier otro actor: el de su contexto. Si envía
 *    `requestedOrganizationId` → 403 (el campo es solo de la plataforma); si
 *    no tiene condominio → 403 (antes el recurso quedaba en el "cajón nulo").
 */
export function resolveCreationOrganizationId(
  ctx: TenantContext,
  requestedOrganizationId?: string | null,
): string {
  const requested = requestedOrganizationId ?? null;
  if (ctx.isSuperAdmin) {
    if (!requested) {
      throw new BadRequestException(
        'Indica el condominio (organizationId) del recurso',
      );
    }
    return requested;
  }
  if (requested !== null) {
    throw new ForbiddenException(
      'Solo la plataforma (super-admin) puede indicar el condominio (organizationId)',
    );
  }
  if (!ctx.organizationId) {
    throw new ForbiddenException(
      'Tu cuenta no pertenece a ningún condominio todavía.',
    );
  }
  return ctx.organizationId;
}

/**
 * Estampa `organizationId` en una entidad nueva antes de guardarla, con las
 * reglas ESTRICTAS de `resolveCreationOrganizationId` (Fase 4 · P5.C). Antes
 * era leniente: un actor sin condominio creaba el recurso en el "cajón nulo".
 * No valida que el condominio pedido por el super-admin exista: los servicios
 * usan `TenantContextService.resolveCreationOrganizationId`, que sí lo hace.
 */
export function stampOrganizationId<
  T extends { organizationId?: string | null },
>(entity: T, ctx: TenantContext, requestedOrganizationId?: string | null): T {
  entity.organizationId = resolveCreationOrganizationId(
    ctx,
    requestedOrganizationId,
  );
  return entity;
}

/**
 * ¿Existe el condominio (`organization` de better-auth)? Fail-closed: ante un
 * error de BD responde `false`.
 */
export async function organizationExists(
  organizationId: string,
  dataSource: DataSource,
): Promise<boolean> {
  try {
    const rows = await dataSource.query<Array<{ ok: number }>>(
      `SELECT 1 AS ok FROM organization WHERE id = $1 LIMIT 1`,
      [organizationId],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
