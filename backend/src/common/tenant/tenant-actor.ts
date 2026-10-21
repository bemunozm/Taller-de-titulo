import {
  createParamDecorator,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import {
  getUserPermissionNames,
  type UserWithPermissions,
} from '../../auth/utils/permissions.util';
import { CONDOMINIUM_VIEW_ALL_PERMISSION } from '../constants/default-permissions.constant';
import {
  EMPTY_TENANT_CONTEXT,
  type TenantContext,
} from './tenant-context.types';

/**
 * Quién actúa en una operación administrativa (Fase 4 · P5, D12): el usuario
 * humano autenticado + su `TenantContext`. Lo arma el controller (decorador
 * `@CurrentActor()`) y se pasa a los métodos `*ForActor` de los servicios:
 * así los servicios siguen siendo singletons y no hace falta volverlos
 * request-scoped con `TenantContextService`.
 */
export interface TenantActor extends TenantContext {
  userId: string;
  /** Permisos efectivos (unión de los permisos de sus roles). */
  permissionNames: ReadonlySet<string>;
  /**
   * Familia del actor (`user.family`, que `AuthGuard` carga), o `null` si no
   * tiene. Fase 4 · P5.C: acota lo que ve un actor sin
   * `condominium.view-all` (ver `familyScopeOf`). Opcional para los callers
   * que arman un actor a mano: ausente equivale a "sin familia" (solo lo
   * propio, fail-closed).
   */
  familyId?: string | null;
}

/** Request tal como la dejan `AuthGuard` (user) y `TenantInterceptor` (tenantContext). */
export interface TenantActorRequest {
  user?:
    | (UserWithPermissions & {
        id?: string;
        family?: { id?: string | null } | null;
      })
    | null;
  tenantContext?: TenantContext;
}

/**
 * Arma el actor desde la request. Sin `request.user` → 401 (la ruta debería
 * estar detrás de `AuthGuard`). Sin `tenantContext` → contexto vacío: ni
 * super-admin ni condominio (fail-closed).
 */
export function tenantActorFromRequest(
  request: TenantActorRequest,
): TenantActor {
  const user = request.user;
  if (!user?.id) {
    throw new UnauthorizedException();
  }
  const context = request.tenantContext ?? EMPTY_TENANT_CONTEXT;
  return {
    userId: user.id,
    organizationId: context.organizationId,
    isSuperAdmin: context.isSuperAdmin,
    permissionNames: new Set(getUserPermissionNames(user)),
    familyId: user.family?.id ?? null,
  };
}

/** `TenantContext` de la request (vacío si no se resolvió: fail-closed). */
export function tenantContextFromRequest(
  request: TenantActorRequest,
): TenantContext {
  const context = request.tenantContext ?? EMPTY_TENANT_CONTEXT;
  return {
    organizationId: context.organizationId,
    isSuperAdmin: context.isSuperAdmin,
  };
}

/**
 * `@CurrentActor()`: el `TenantActor` de la request. Los parámetros se
 * resuelven después de los interceptores, así que `TenantInterceptor` ya dejó
 * `request.tenantContext`.
 */
export const CurrentActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantActor =>
    tenantActorFromRequest(ctx.switchToHttp().getRequest<TenantActorRequest>()),
);

/** `@CurrentTenant()`: el `TenantContext` de la request. */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext =>
    tenantContextFromRequest(
      ctx.switchToHttp().getRequest<TenantActorRequest>(),
    ),
);

/**
 * ¿El actor ve los datos de todo su condominio? Super-admin (todo) o permiso
 * `condominium.view-all`. Sin él, el actor solo ve lo propio.
 */
export function canViewWholeCondominium(
  actor: Pick<TenantActor, 'isSuperAdmin' | 'permissionNames'>,
): boolean {
  return (
    actor.isSuperAdmin ||
    actor.permissionNames.has(CONDOMINIUM_VIEW_ALL_PERMISSION)
  );
}

/**
 * Alcance por familia de un actor SIN `condominium.view-all` (Fase 4 · P5.C,
 * reemplaza al `UserFilterInterceptor`, que decidía por nombre de rol): solo
 * ve y opera lo suyo y lo de su familia. Sin familia, solo lo propio.
 */
export interface FamilyScope {
  userId: string;
  /** Familia del actor, o `null` (solo lo propio). */
  familyId: string | null;
}

/**
 * Alcance por familia del actor, o `null` si ve todo su condominio
 * (super-admin o `condominium.view-all`). El acotamiento por CONDOMINIO es
 * aparte (`TenantContext`) y siempre aplica.
 */
export function familyScopeOf(actor: TenantActor): FamilyScope | null {
  if (canViewWholeCondominium(actor)) {
    return null;
  }
  return { userId: actor.userId, familyId: actor.familyId ?? null };
}

/** ¿`user` es el actor o un miembro de su familia? */
export function isSelfOrFamilyMember(
  scope: FamilyScope,
  user: { id: string; familyId: string | null },
): boolean {
  return (
    user.id === scope.userId ||
    (scope.familyId !== null && user.familyId === scope.familyId)
  );
}
