import { ForbiddenException } from '@nestjs/common';
import {
  assertRoleAssignmentAllowed,
  evaluateRoleAssignment,
  evaluateTargetHierarchy,
  evaluateTargetUser,
  managesOrganization,
  type AssignableRole,
  type PolicyActor,
  type PolicyTarget,
  type RoleAssignmentDenialReason,
} from './role-assignment.policy';
import { DEFAULT_ROLES } from '../common/constants/default-roles.constant';
import { CONDOMINIUM_VIEW_ALL_PERMISSION } from '../common/constants/default-permissions.constant';

/**
 * Fase 4 · P5 (D10): matriz completa de `RoleAssignmentPolicy`.
 */
const ORG_A = 'org-a';
const ORG_B = 'org-b';

const ADMIN_A: PolicyActor = {
  userId: 'admin-a',
  isSuperAdmin: false,
  organizationId: ORG_A,
  permissionNames: new Set([
    'users.read',
    'users.create',
    'visits.read',
    'visits.create',
  ]),
};
const SUPER_ADMIN: PolicyActor = {
  userId: 'root',
  isSuperAdmin: true,
  organizationId: null,
  permissionNames: new Set(),
};

const RESIDENT: AssignableRole = {
  id: 'r-res',
  name: 'Residente',
  permissionNames: ['visits.read', 'visits.create'],
};
const SUPER_ADMIN_ROLE: AssignableRole = {
  id: 'r-super',
  name: 'Super Administrador',
  permissionNames: [],
};
const PLATFORM_ROLE: AssignableRole = {
  id: 'r-platform',
  name: 'Operador de hubs',
  permissionNames: ['platform.manage-hubs'],
};
const SUPERSET_ROLE: AssignableRole = {
  id: 'r-superset',
  name: 'Más que admin',
  permissionNames: ['visits.read', 'cameras.delete'],
};

const USER_OF_A: PolicyTarget = {
  userId: 'user-a',
  organizationId: ORG_A,
  isSuperAdmin: false,
};

function reasonOf(
  actor: PolicyActor,
  target: PolicyTarget,
  rolesToGrant: AssignableRole[],
  changesRoles = true,
): RoleAssignmentDenialReason | 'allowed' {
  const decision = evaluateRoleAssignment({
    actor,
    target,
    rolesToGrant,
    changesRoles,
  });
  return decision.allowed ? 'allowed' : decision.reason;
}

describe('RoleAssignmentPolicy (Fase 4 · P5, D10)', () => {
  it.each<
    [
      string,
      PolicyActor,
      PolicyTarget,
      AssignableRole[],
      boolean,
      RoleAssignmentDenialReason | 'allowed',
    ]
  >([
    [
      'super-admin: todo permitido (incluso Super Administrador a otro condominio)',
      SUPER_ADMIN,
      { userId: 'x', organizationId: ORG_B, isSuperAdmin: false },
      [SUPER_ADMIN_ROLE, PLATFORM_ROLE, SUPERSET_ROLE],
      true,
      'allowed',
    ],
    [
      'super-admin: puede cambiar sus propios roles',
      SUPER_ADMIN,
      { userId: 'root', organizationId: null, isSuperAdmin: true },
      [RESIDENT],
      true,
      'allowed',
    ],
    [
      'admin -> rol "Super Administrador"',
      ADMIN_A,
      USER_OF_A,
      [SUPER_ADMIN_ROLE],
      true,
      'super-admin-role',
    ],
    [
      'admin -> rol con permisos platform.*',
      ADMIN_A,
      USER_OF_A,
      [PLATFORM_ROLE],
      true,
      'platform-permission',
    ],
    [
      'admin -> rol con más permisos que él (superconjunto)',
      ADMIN_A,
      USER_OF_A,
      [SUPERSET_ROLE],
      true,
      'permissions-not-subset',
    ],
    [
      'admin -> sus propios roles',
      ADMIN_A,
      { userId: 'admin-a', organizationId: ORG_A, isSuperAdmin: false },
      [RESIDENT],
      true,
      'self-role-change',
    ],
    [
      'admin -> quitarse todos sus roles',
      ADMIN_A,
      { userId: 'admin-a', organizationId: ORG_A, isSuperAdmin: false },
      [],
      true,
      'self-role-change',
    ],
    [
      'admin -> usuario de otro condominio',
      ADMIN_A,
      { userId: 'user-b', organizationId: ORG_B, isSuperAdmin: false },
      [RESIDENT],
      true,
      'different-organization',
    ],
    [
      'admin -> usuario sin membresía',
      ADMIN_A,
      { userId: 'legacy', organizationId: null, isSuperAdmin: false },
      [RESIDENT],
      true,
      'target-without-membership',
    ],
    [
      'admin -> un super-admin',
      ADMIN_A,
      { userId: 'root-2', organizationId: ORG_A, isSuperAdmin: true },
      [RESIDENT],
      true,
      'target-is-super-admin',
    ],
    [
      'admin sin condominio',
      { ...ADMIN_A, organizationId: null },
      USER_OF_A,
      [RESIDENT],
      true,
      'actor-without-organization',
    ],
    [
      'admin -> Residente a un usuario de su condominio (OK)',
      ADMIN_A,
      USER_OF_A,
      [RESIDENT],
      true,
      'allowed',
    ],
    [
      'admin -> cuenta nueva en su condominio (OK)',
      ADMIN_A,
      { userId: null, organizationId: ORG_A, isSuperAdmin: false },
      [RESIDENT],
      true,
      'allowed',
    ],
    [
      'admin -> editar sus datos sin cambiar roles (OK)',
      ADMIN_A,
      { userId: 'admin-a', organizationId: ORG_A, isSuperAdmin: false },
      [],
      false,
      'allowed',
    ],
  ])('%s', (_label, actor, target, roles, changesRoles, expected) => {
    expect(reasonOf(actor, target, roles, changesRoles)).toBe(expected);
  });

  it('assertRoleAssignmentAllowed lanza 403 con el motivo', () => {
    expect(() =>
      assertRoleAssignmentAllowed({
        actor: ADMIN_A,
        target: USER_OF_A,
        rolesToGrant: [SUPER_ADMIN_ROLE],
        changesRoles: true,
      }),
    ).toThrow(
      new ForbiddenException('No puedes asignar el rol "Super Administrador"'),
    );
  });

  describe('managesOrganization (también la usa AuthService)', () => {
    it.each<
      [
        string,
        Pick<PolicyActor, 'isSuperAdmin' | 'organizationId'>,
        string | null,
        boolean,
      ]
    >([
      ['super-admin: cualquiera', SUPER_ADMIN, ORG_B, true],
      ['super-admin: incluso sin condominio', SUPER_ADMIN, null, true],
      ['su propio condominio', ADMIN_A, ORG_A, true],
      ['otro condominio', ADMIN_A, ORG_B, false],
      ['condominio nulo', ADMIN_A, null, false],
      [
        'actor sin condominio vs condominio nulo',
        { isSuperAdmin: false, organizationId: null },
        null,
        false,
      ],
    ])('%s', (_label, actor, organizationId, expected) => {
      expect(managesOrganization(actor, organizationId)).toBe(expected);
    });
  });

  it('evaluateTargetUser: el super-admin opera sobre cualquiera', () => {
    expect(
      evaluateTargetUser(SUPER_ADMIN, {
        organizationId: null,
        isSuperAdmin: true,
      }),
    ).toEqual({ allowed: true });
  });
});

/**
 * Corrección de la P5 (QA B1): con los `DEFAULT_ROLES` REALES, el
 * Administrador de un condominio puede asignar los roles de su condominio
 * (antes no podía asignar Conserje: le faltaban `detections.approve`,
 * `detections.list-pending` y `detections.check-status`).
 */
describe('RoleAssignmentPolicy con los DEFAULT_ROLES reales (corrección P5)', () => {
  const roleByName = new Map(
    DEFAULT_ROLES.map((role) => [role.name, role] as const),
  );

  function assignable(name: string): AssignableRole {
    const role = roleByName.get(name);
    if (!role) {
      throw new Error(`Rol de sistema inexistente: ${name}`);
    }
    return { id: `role-${name}`, name, permissionNames: role.permissions };
  }

  const administrador = roleByName.get('Administrador');
  const ADMIN_REAL: PolicyActor = {
    userId: 'admin-real',
    isSuperAdmin: false,
    organizationId: ORG_A,
    permissionNames: new Set(administrador?.permissions ?? []),
  };
  const NEW_ACCOUNT_IN_A: PolicyTarget = {
    userId: null,
    organizationId: ORG_A,
    isSuperAdmin: false,
  };

  function decisionFor(name: string) {
    return evaluateRoleAssignment({
      actor: ADMIN_REAL,
      target: NEW_ACCOUNT_IN_A,
      rolesToGrant: [assignable(name)],
      changesRoles: true,
    });
  }

  it.each(['Residente', 'Conserje', 'Seguridad', 'Administrador'])(
    'el Administrador puede asignar %s',
    (name) => {
      expect(decisionFor(name)).toEqual({ allowed: true });
    },
  );

  it.each([
    ['Super Administrador', 'super-admin-role'],
    ['Desarrollador', 'permissions-not-subset'],
  ] as const)('el Administrador NO puede asignar %s (%s)', (name, reason) => {
    expect(decisionFor(name)).toEqual(
      expect.objectContaining({ allowed: false, reason }),
    );
  });

  describe('evaluateTargetHierarchy (corrección P5, cyber N1)', () => {
    const developer = roleByName.get('Desarrollador');
    const DEVELOPER: PolicyActor = {
      userId: 'dev',
      isSuperAdmin: false,
      organizationId: ORG_A,
      permissionNames: new Set(developer?.permissions ?? []),
    };
    const target = (name: string) => ({
      userId: 'target',
      roles: [assignable(name)],
    });

    it.each(['Residente', 'Conserje', 'Seguridad', 'Administrador'])(
      'el Administrador opera sobre un %s',
      (name) => {
        expect(evaluateTargetHierarchy(ADMIN_REAL, target(name))).toEqual({
          allowed: true,
        });
      },
    );

    it('el Desarrollador NO opera sobre el Administrador (tiene permisos que él no tiene)', () => {
      expect(
        evaluateTargetHierarchy(DEVELOPER, target('Administrador')),
      ).toEqual(
        expect.objectContaining({
          allowed: false,
          reason: 'target-outranks-actor',
        }),
      );
    });

    it('nadie (salvo el super-admin) opera sobre un Super Administrador; sobre sí mismo no aplica', () => {
      expect(
        evaluateTargetHierarchy(ADMIN_REAL, target('Super Administrador')),
      ).toEqual(expect.objectContaining({ allowed: false }));
      expect(
        evaluateTargetHierarchy(
          { ...ADMIN_REAL, isSuperAdmin: true },
          target('Super Administrador'),
        ),
      ).toEqual({ allowed: true });
      expect(
        evaluateTargetHierarchy(DEVELOPER, {
          userId: 'dev',
          roles: [assignable('Desarrollador')],
        }),
      ).toEqual({ allowed: true });
    });
  });

  it('Desarrollador ve todo su condominio (condominium.view-all) y el Residente no', () => {
    expect(roleByName.get('Desarrollador')?.permissions).toContain(
      CONDOMINIUM_VIEW_ALL_PERMISSION,
    );
    expect(roleByName.get('Residente')?.permissions).not.toContain(
      CONDOMINIUM_VIEW_ALL_PERMISSION,
    );
  });
});
