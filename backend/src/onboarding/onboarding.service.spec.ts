import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { OnboardingService } from './onboarding.service';
import type { UsersService } from '../users/users.service';
import type { Role } from '../roles/entities/role.entity';
import type { OrganizationMembershipService } from '../organization-membership/organization-membership.service';
import type { TenantActor } from '../common/tenant/tenant-actor';

const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const ADMIN_ROLE = { id: 'role-admin', name: 'Administrador' } as Role;

const ADMIN_A: TenantActor = {
  userId: 'admin-a',
  organizationId: ORG_A,
  isSuperAdmin: false,
  permissionNames: new Set(['users.create']),
};
const SUPER_ADMIN: TenantActor = {
  userId: 'root',
  organizationId: null,
  isSuperAdmin: true,
  permissionNames: new Set(['platform.manage-organizations']),
};

const PERSON = {
  rut: '11222333-4',
  name: 'María',
  email: 'maria@condominio.cl',
  phone: '+56912345678',
};

/**
 * Fase 4 · P5 (D11): los dos caminos del onboarding crean la membresía con
 * `OrganizationMembershipService` y compensan si falla.
 */
describe('OnboardingService (Fase 4 · P5)', () => {
  let usersService: {
    createAccountByAdmin: jest.Mock;
    provisionAccount: jest.Mock;
    discardProvisionedAccount: jest.Mock;
    sendActivationEmail: jest.Mock;
  };
  let membership: {
    isSlugTaken: jest.Mock<Promise<boolean>, [string]>;
    createOrganization: jest.Mock;
    listOrganizations: jest.Mock;
  };
  let service: OnboardingService;

  beforeEach(() => {
    usersService = {
      createAccountByAdmin: jest
        .fn()
        .mockResolvedValue({ id: 'new-user', ...PERSON, roles: [] }),
      provisionAccount: jest
        .fn()
        .mockResolvedValue({ id: 'admin-user', ...PERSON }),
      discardProvisionedAccount: jest.fn().mockResolvedValue(undefined),
      sendActivationEmail: jest.fn().mockResolvedValue(undefined),
    };
    membership = {
      isSlugTaken: jest
        .fn<Promise<boolean>, [string]>()
        .mockResolvedValue(false),
      createOrganization: jest.fn().mockResolvedValue({ id: 'org-new' }),
      listOrganizations: jest
        .fn()
        .mockResolvedValue([
          { id: ORG_A, name: 'Condominio A', slug: 'condominio-a' },
        ]),
    };
    service = new OnboardingService(
      usersService as unknown as UsersService,
      {
        findOne: jest.fn().mockResolvedValue(ADMIN_ROLE),
      } as unknown as Repository<Role>,
      membership as unknown as OrganizationMembershipService,
    );
  });

  describe('POST /onboarding/members', () => {
    it('pasa por createAccountByAdmin con el actor (política + membresía + compensación)', async () => {
      const result = await service.createCondominiumMember(
        { ...PERSON, roleIds: ['role-res'], familyId: 'family-a' },
        ADMIN_A,
      );

      expect(usersService.createAccountByAdmin).toHaveBeenCalledWith(
        {
          ...PERSON,
          age: undefined,
          roleIds: ['role-res'],
          familyId: 'family-a',
        },
        ADMIN_A,
      );
      // La respuesta no reexpone roles ni familia.
      expect(result).toEqual({ id: 'new-user', ...PERSON });
    });

    it('el super-admin (sin condominio propio) -> 403', async () => {
      await expect(
        service.createCondominiumMember(
          { ...PERSON, roleIds: [] },
          SUPER_ADMIN,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(usersService.createAccountByAdmin).not.toHaveBeenCalled();
    });

    it('un actor sin condominio -> 403', async () => {
      await expect(
        service.createCondominiumMember(
          { ...PERSON, roleIds: [] },
          { ...ADMIN_A, organizationId: null },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('POST /onboarding/condominiums', () => {
    const DTO = { name: 'Los Alerces', admin: PERSON };

    it('solo el super-admin (chequeo explícito) -> 403 para el resto', async () => {
      await expect(service.createCondominium(DTO, ADMIN_A)).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersService.provisionAccount).not.toHaveBeenCalled();
    });

    it('crea el admin, el condominio (owner = admin) y recién entonces el email', async () => {
      const result = await service.createCondominium(DTO, SUPER_ADMIN);

      expect(usersService.provisionAccount).toHaveBeenCalledWith(
        { ...PERSON, age: undefined },
        [ADMIN_ROLE],
        null,
      );
      expect(membership.createOrganization).toHaveBeenCalledWith({
        name: 'Los Alerces',
        slug: 'los-alerces',
        ownerUserId: 'admin-user',
      });
      expect(
        membership.createOrganization.mock.invocationCallOrder[0],
      ).toBeLessThan(
        usersService.sendActivationEmail.mock.invocationCallOrder[0],
      );
      expect(result.organization).toEqual({ id: 'org-new' });
    });

    it('slug ya usado -> 409 antes de crear la cuenta', async () => {
      membership.isSlugTaken.mockResolvedValue(true);

      await expect(service.createCondominium(DTO, SUPER_ADMIN)).rejects.toThrow(
        ConflictException,
      );
      expect(usersService.provisionAccount).not.toHaveBeenCalled();
    });

    it('si crear el condominio falla: borra la cuenta del admin (compensación), 400 y sin email', async () => {
      membership.createOrganization.mockRejectedValue(new Error('slug taken'));

      await expect(service.createCondominium(DTO, SUPER_ADMIN)).rejects.toThrow(
        BadRequestException,
      );
      expect(usersService.discardProvisionedAccount).toHaveBeenCalledWith(
        'admin-user',
      );
      expect(usersService.sendActivationEmail).not.toHaveBeenCalled();
    });
  });

  describe('GET /onboarding/condominiums (P5.C, selector del super-admin)', () => {
    it('super-admin: { id, name, slug }[] de todos los condominios', async () => {
      await expect(service.listCondominiums(SUPER_ADMIN)).resolves.toEqual([
        { id: ORG_A, name: 'Condominio A', slug: 'condominio-a' },
      ]);
    });

    it('cualquier otro actor (aunque tuviera el permiso) -> 403 sin consultar', async () => {
      await expect(service.listCondominiums(ADMIN_A)).rejects.toThrow(
        ForbiddenException,
      );
      expect(membership.listOrganizations).not.toHaveBeenCalled();
    });
  });
});
