import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  canViewWholeCondominium,
  familyScopeOf,
  isSelfOrFamilyMember,
  tenantActorFromRequest,
  tenantContextFromRequest,
  type TenantActor,
} from './tenant-actor';
import {
  assertPlatformSuperAdmin,
  hasPlatformSuperAdminRole,
} from './tenant-context.util';

const ORG_A = 'org-a';

describe('TenantActor (Fase 4 · P5, D12)', () => {
  it('arma el actor con el usuario, sus permisos efectivos y el tenantContext', () => {
    const actor = tenantActorFromRequest({
      user: {
        id: 'admin-a',
        roles: [
          { name: 'Administrador', permissions: [{ name: 'users.read' }] },
          { name: 'Conserje', permissions: [{ name: 'condominium.view-all' }] },
        ],
      },
      tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
    });

    expect(actor).toEqual({
      userId: 'admin-a',
      organizationId: ORG_A,
      isSuperAdmin: false,
      permissionNames: new Set(['users.read', 'condominium.view-all']),
      familyId: null,
    });
    expect(canViewWholeCondominium(actor)).toBe(true);
  });

  it('sin tenantContext: ni super-admin ni condominio (fail-closed)', () => {
    const actor = tenantActorFromRequest({ user: { id: 'u', roles: [] } });

    expect(actor.isSuperAdmin).toBe(false);
    expect(actor.organizationId).toBeNull();
    expect(tenantContextFromRequest({})).toEqual({
      organizationId: null,
      isSuperAdmin: false,
    });
  });

  it('sin usuario autenticado -> 401', () => {
    expect(() => tenantActorFromRequest({})).toThrow(UnauthorizedException);
  });

  it('canViewWholeCondominium: super-admin sí; sin el permiso, no', () => {
    expect(
      canViewWholeCondominium({
        isSuperAdmin: true,
        permissionNames: new Set(),
      }),
    ).toBe(true);
    expect(
      canViewWholeCondominium({
        isSuperAdmin: false,
        permissionNames: new Set(['visits.read']),
      }),
    ).toBe(false);
  });
});

describe('Alcance por familia (Fase 4 · P5.C, condominium.view-all)', () => {
  const resident = (familyId: string | null | undefined): TenantActor => ({
    userId: 'res-1',
    organizationId: ORG_A,
    isSuperAdmin: false,
    permissionNames: new Set(['visits.read']),
    familyId,
  });

  it('la familia del actor sale de user.family (AuthGuard)', () => {
    const actor = tenantActorFromRequest({
      user: { id: 'res-1', roles: [], family: { id: 'fam-1' } },
      tenantContext: { organizationId: ORG_A, isSuperAdmin: false },
    });
    expect(actor.familyId).toBe('fam-1');
  });

  it('sin condominium.view-all: acotado a su familia; sin familia, solo él', () => {
    expect(familyScopeOf(resident('fam-1'))).toEqual({
      userId: 'res-1',
      familyId: 'fam-1',
    });
    expect(familyScopeOf(resident(null))).toEqual({
      userId: 'res-1',
      familyId: null,
    });
    // Ausente (actor armado a mano) = sin familia: fail-closed.
    expect(familyScopeOf(resident(undefined))).toEqual({
      userId: 'res-1',
      familyId: null,
    });
  });

  it('con condominium.view-all o super-admin: sin acotar (null)', () => {
    expect(
      familyScopeOf({
        ...resident('fam-1'),
        permissionNames: new Set(['condominium.view-all']),
      }),
    ).toBeNull();
    expect(familyScopeOf({ ...resident(null), isSuperAdmin: true })).toBeNull();
  });

  it('isSelfOrFamilyMember: él mismo o alguien de su familia; un vecino no', () => {
    const scope = { userId: 'res-1', familyId: 'fam-1' };
    expect(isSelfOrFamilyMember(scope, { id: 'res-1', familyId: null })).toBe(
      true,
    );
    expect(
      isSelfOrFamilyMember(scope, { id: 'res-2', familyId: 'fam-1' }),
    ).toBe(true);
    expect(
      isSelfOrFamilyMember(scope, { id: 'neighbor', familyId: 'fam-2' }),
    ).toBe(false);
    // Sin familia: dos usuarios sin familia NO son "la misma familia".
    expect(
      isSelfOrFamilyMember(
        { userId: 'res-1', familyId: null },
        { id: 'other', familyId: null },
      ),
    ).toBe(false);
  });
});

describe('tenant-context.util — super-admin (Fase 4 · P5)', () => {
  it('hasPlatformSuperAdminRole compara el nombre exacto del rol', () => {
    expect(
      hasPlatformSuperAdminRole({ roles: [{ name: 'Super Administrador' }] }),
    ).toBe(true);
    expect(
      hasPlatformSuperAdminRole({ roles: [{ name: 'Administrador' }] }),
    ).toBe(false);
    expect(hasPlatformSuperAdminRole(null)).toBe(false);
  });

  it('assertPlatformSuperAdmin: 403 si no es super-admin', () => {
    expect(() => assertPlatformSuperAdmin({ isSuperAdmin: false })).toThrow(
      ForbiddenException,
    );
    expect(() =>
      assertPlatformSuperAdmin({ isSuperAdmin: true }),
    ).not.toThrow();
  });
});
