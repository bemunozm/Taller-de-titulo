import { ForbiddenException } from '@nestjs/common';
import { PLATFORM_PERMISSION_PREFIX } from '../common/constants/default-permissions.constant';
import { PLATFORM_SUPER_ADMIN_ROLE } from '../common/tenant/tenant-context.types';

/**
 * `RoleAssignmentPolicy` (Fase 4 · P5, D10): quién puede asignar qué roles a
 * qué usuario. Funciones PURAS: el llamador resuelve antes (con BD) la
 * membresía del actor y del destino y los permisos de cada rol; acá solo se
 * decide. Se aplica en `POST /users/create-by-admin`, `PATCH /users/:id`
 * (solo si cambian los roles) y `POST /onboarding/members`. La regla de
 * "mismo condominio" (`managesOrganization`, `evaluateTargetUser`) también la
 * usa `AuthService` para las API keys de servicio.
 *
 * Super-admin: todo permitido. Para el resto:
 *  (a) no asigna "Super Administrador" ni roles con permisos `platform.*`;
 *  (b) cada rol asignado tiene un subconjunto de los permisos del actor;
 *  (c) no cambia sus propios roles;
 *  (d) el destino es de su mismo condominio (por membresía; sin membresía →
 *      denegado), y nunca es un super-admin.
 */

/** Quién asigna. `organizationId`: su condominio por membresía. */
export interface PolicyActor {
  userId: string;
  isSuperAdmin: boolean;
  organizationId: string | null;
  permissionNames: ReadonlySet<string>;
}

/**
 * A quién se asigna. `userId: null` = cuenta nueva (todavía no existe);
 * `organizationId`: el condominio del destino por membresía (para una cuenta
 * nueva, el condominio donde se va a crear su membresía).
 */
export interface PolicyTarget {
  userId: string | null;
  organizationId: string | null;
  isSuperAdmin: boolean;
}

/** Un rol que se asigna, con los nombres de sus permisos. */
export interface AssignableRole {
  id: string;
  name: string;
  permissionNames: readonly string[];
}

export type RoleAssignmentDenialReason =
  | 'actor-without-organization'
  | 'target-is-super-admin'
  | 'target-without-membership'
  | 'different-organization'
  | 'self-role-change'
  | 'super-admin-role'
  | 'platform-permission'
  | 'permissions-not-subset'
  | 'target-outranks-actor';

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: RoleAssignmentDenialReason; message: string };

export interface RoleAssignmentInput {
  actor: PolicyActor;
  target: PolicyTarget;
  /** Roles que la operación OTORGA (para una cuenta nueva, todos). */
  rolesToGrant: readonly AssignableRole[];
  /** `true` si la operación cambia el conjunto de roles del destino. */
  changesRoles: boolean;
}

const ALLOWED: PolicyDecision = { allowed: true };

function deny(
  reason: RoleAssignmentDenialReason,
  message: string,
): PolicyDecision {
  return { allowed: false, reason, message };
}

/**
 * `true` si el actor administra el condominio `organizationId`: un
 * super-admin, todos; el resto, solo el suyo (por membresía). Un
 * `organizationId` nulo no lo administra nadie salvo el super-admin.
 */
export function managesOrganization(
  actor: Pick<PolicyActor, 'isSuperAdmin' | 'organizationId'>,
  organizationId: string | null,
): boolean {
  if (actor.isSuperAdmin) {
    return true;
  }
  return (
    organizationId !== null &&
    actor.organizationId !== null &&
    actor.organizationId === organizationId
  );
}

/**
 * Regla (d): ¿el actor puede operar sobre este usuario destino? Mismo
 * condominio por membresía y destino que no sea super-admin.
 */
export function evaluateTargetUser(
  actor: Pick<PolicyActor, 'isSuperAdmin' | 'organizationId'>,
  target: Pick<PolicyTarget, 'organizationId' | 'isSuperAdmin'>,
): PolicyDecision {
  if (actor.isSuperAdmin) {
    return ALLOWED;
  }
  if (actor.organizationId === null) {
    return deny(
      'actor-without-organization',
      'Tu cuenta no pertenece a ningún condominio',
    );
  }
  if (target.isSuperAdmin) {
    return deny(
      'target-is-super-admin',
      'No puedes modificar una cuenta de la plataforma (super-administrador)',
    );
  }
  if (target.organizationId === null) {
    return deny(
      'target-without-membership',
      'El usuario no pertenece a ningún condominio',
    );
  }
  if (!managesOrganization(actor, target.organizationId)) {
    return deny(
      'different-organization',
      'El usuario no pertenece a tu condominio',
    );
  }
  return ALLOWED;
}

/** Reglas (a) y (b) sobre un rol: ¿el actor (no super-admin) puede otorgarlo? */
function evaluateGrantableRole(
  actor: PolicyActor,
  role: AssignableRole,
): PolicyDecision {
  if (role.name === PLATFORM_SUPER_ADMIN_ROLE) {
    return deny(
      'super-admin-role',
      `No puedes asignar el rol "${PLATFORM_SUPER_ADMIN_ROLE}"`,
    );
  }
  if (
    role.permissionNames.some((name) =>
      name.startsWith(PLATFORM_PERMISSION_PREFIX),
    )
  ) {
    return deny(
      'platform-permission',
      `No puedes asignar el rol "${role.name}": tiene permisos de plataforma`,
    );
  }
  if (role.permissionNames.some((name) => !actor.permissionNames.has(name))) {
    return deny(
      'permissions-not-subset',
      `No puedes asignar el rol "${role.name}": tiene permisos que tú no tienes`,
    );
  }
  return ALLOWED;
}

/**
 * Corrección P5 (cyber N1): jerarquía en TODA escritura sobre OTRO usuario
 * (`PATCH`, `disable`, `enable`, `DELETE`). Para quien no es super-admin,
 * los permisos efectivos de los roles ACTUALES del destino deben ser un
 * subconjunto de los suyos: un Desarrollador con `users.update` no edita ni
 * deshabilita al Administrador; el Administrador sí opera sobre Conserjes,
 * Residentes y otros Administradores. Sobre sí mismo no aplica (lo propio lo
 * cubren otras reglas: no cambia sus roles, no se borra ni se deshabilita).
 */
export function evaluateTargetHierarchy(
  actor: PolicyActor,
  target: { userId: string; roles: readonly AssignableRole[] },
): PolicyDecision {
  if (actor.isSuperAdmin || target.userId === actor.userId) {
    return ALLOWED;
  }
  for (const role of target.roles) {
    const outranks =
      role.name === PLATFORM_SUPER_ADMIN_ROLE ||
      role.permissionNames.some(
        (name) =>
          name.startsWith(PLATFORM_PERMISSION_PREFIX) ||
          !actor.permissionNames.has(name),
      );
    if (outranks) {
      return deny(
        'target-outranks-actor',
        `No puedes modificar a este usuario: su rol "${role.name}" tiene permisos que tú no tienes`,
      );
    }
  }
  return ALLOWED;
}

/** Decide si el actor puede otorgar `rolesToGrant` al destino. */
export function evaluateRoleAssignment(
  input: RoleAssignmentInput,
): PolicyDecision {
  const { actor, target, rolesToGrant, changesRoles } = input;
  if (actor.isSuperAdmin) {
    return ALLOWED;
  }

  const targetDecision = evaluateTargetUser(actor, target);
  if (!targetDecision.allowed) {
    return targetDecision;
  }

  if (
    changesRoles &&
    target.userId !== null &&
    target.userId === actor.userId
  ) {
    return deny('self-role-change', 'No puedes cambiar tus propios roles');
  }

  for (const role of rolesToGrant) {
    const roleDecision = evaluateGrantableRole(actor, role);
    if (!roleDecision.allowed) {
      return roleDecision;
    }
  }
  return ALLOWED;
}

/** Lanza 403 con el motivo si la decisión niega. */
export function assertPolicyAllowed(decision: PolicyDecision): void {
  if (!decision.allowed) {
    throw new ForbiddenException(decision.message);
  }
}

/** `evaluateRoleAssignment` + 403 si niega. */
export function assertRoleAssignmentAllowed(input: RoleAssignmentInput): void {
  assertPolicyAllowed(evaluateRoleAssignment(input));
}
