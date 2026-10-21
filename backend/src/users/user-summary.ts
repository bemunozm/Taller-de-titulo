import type { TenantActor } from '../common/tenant/tenant-actor';
import type { User } from './entities/user.entity';

/**
 * Permiso que da acceso al DETALLE de otros usuarios (Fase 4 · P5.C): en
 * `GET /users`, `GET /users/:id` y en los usuarios embebidos en familias,
 * visitas, vehículos, unidades y detecciones. Sin él (Conserje, Seguridad,
 * Residente), el actor recibe solo un resumen.
 */
export const USERS_DETAIL_PERMISSION = 'users.update';

/** ¿El actor ve el detalle de otros usuarios? Super-admin o `users.update`. */
export function canSeeUserDetail(
  actor: Pick<TenantActor, 'isSuperAdmin' | 'permissionNames'>,
): boolean {
  return (
    actor.isSuperAdmin || actor.permissionNames.has(USERS_DETAIL_PERMISSION)
  );
}

/** Resumen de un usuario embebido en otro recurso: sin email, RUT, teléfono ni roles. */
export interface UserSummary {
  id: string;
  name: string;
}

export function toUserSummary(user: Pick<User, 'id' | 'name'>): UserSummary {
  return { id: user.id, name: user.name };
}

/**
 * Corrección P5 (cyber B3 / QA): un `User` embebido en la respuesta de otro
 * recurso (miembros de una familia, anfitrión de una visita, propietario de
 * un vehículo, residente de un intento de acceso), tal como lo ve el actor:
 * completo si ve el detalle de usuarios (`canSeeUserDetail`), si no
 * `{ id, name }`.
 *
 * Devuelve el resumen con el tipo de la relación (`User`) para no cambiar la
 * forma de la entidad que lo contiene: es SOLO para serializar la respuesta
 * (la entidad no se vuelve a guardar).
 */
export function embeddedUserFor(
  user: User,
  actor: Pick<TenantActor, 'isSuperAdmin' | 'permissionNames'>,
): User {
  return canSeeUserDetail(actor) ? user : (toUserSummary(user) as User);
}

/** `embeddedUserFor` para una relación opcional (`null`/`undefined` se mantiene). */
export function optionalEmbeddedUserFor<T extends User | null | undefined>(
  user: T,
  actor: Pick<TenantActor, 'isSuperAdmin' | 'permissionNames'>,
): T {
  if (user === null || user === undefined) {
    return user;
  }
  return embeddedUserFor(user, actor) as T;
}
