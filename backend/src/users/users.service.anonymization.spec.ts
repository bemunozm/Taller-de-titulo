import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { Repository } from 'typeorm';
import { CONDOMINIUM_VIEW_ALL_PERMISSION } from '../common/constants/default-permissions.constant';
import type { TenantActor } from '../common/tenant/tenant-actor';
import type { Family } from '../families/entities/family.entity';
import type { OrganizationMembershipService } from '../organization-membership/organization-membership.service';
import type { Role } from '../roles/entities/role.entity';
import { User } from './entities/user.entity';
import {
  ANONYMIZED_USER_CANNOT_BE_ENABLED,
  ONLY_DISABLED_USERS_CAN_BE_ANONYMIZED,
  STAFF_ACCOUNT_ANONYMIZATION_FORBIDDEN,
  UsersService,
} from './users.service';

const USER_ID = '2d7f8f57-4b8c-4b75-9f38-7dab5a5e2c03';
const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const DISABLED_AT = new Date('2026-08-01T00:00:00Z');

function role(name: string, permissions: string[]): Role {
  return {
    id: `role-${name}`,
    name,
    permissions: permissions.map((permissionName) => ({
      name: permissionName,
    })),
  } as Role;
}

const ADMIN: TenantActor = {
  userId: 'admin-a',
  organizationId: ORG_A,
  isSuperAdmin: false,
  permissionNames: new Set([
    'privacy.manage',
    'users.update',
    'visits.read',
    CONDOMINIUM_VIEW_ALL_PERMISSION,
  ]),
};

/**
 * Fase 4 · P7.R: anonimización de cuentas deshabilitadas (Ley 21.719) y su
 * efecto en `enable`.
 */
describe('UsersService — anonimización de cuentas deshabilitadas (Fase 4 · P7.R)', () => {
  let findOne: jest.Mock;
  let restore: jest.Mock;
  let managerQuery: jest.Mock<Promise<unknown>, [string, unknown[]?]>;
  let managerUpdate: jest.Mock;
  let rootQuery: jest.Mock;
  let deleteUserSessions: jest.Mock<Promise<void>, [string]>;
  let isMemberOfOrganization: jest.Mock;
  let service: UsersService;
  let lockedRow: Record<string, unknown> | undefined;

  beforeEach(() => {
    lockedRow = { deletedAt: DISABLED_AT, email: 'ana@example.com' };
    findOne = jest.fn();
    restore = jest.fn();
    managerQuery = jest.fn((sql: string) =>
      Promise.resolve(
        sql.startsWith('SELECT') ? [lockedRow].filter(Boolean) : [],
      ),
    );
    managerUpdate = jest.fn().mockResolvedValue({ affected: 1 });
    rootQuery = jest.fn().mockResolvedValue([]);
    deleteUserSessions = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined);
    isMemberOfOrganization = jest.fn().mockResolvedValue(true);

    const userRepository = {
      findOne,
      restore,
      manager: {
        query: rootQuery,
        transaction: jest.fn(
          (
            work: (manager: {
              query: typeof managerQuery;
              update: jest.Mock;
            }) => Promise<unknown>,
          ) => work({ query: managerQuery, update: managerUpdate }),
        ),
      },
    };
    service = new UsersService(
      userRepository as unknown as Repository<User>,
      {} as Repository<Role>,
      {} as Repository<Family>,
      { get: jest.fn() } as unknown as ConfigService,
      {
        instance: {
          $context: Promise.resolve({
            internalAdapter: { deleteUserSessions },
          }),
        },
      } as unknown as BetterAuthService,
      {
        isMemberOfOrganization,
      } as unknown as OrganizationMembershipService,
    );
  });

  describe('findAnonymizationTarget', () => {
    it('incluye cuentas deshabilitadas (withDeleted) y no carga relaciones', async () => {
      findOne.mockResolvedValueOnce({
        id: USER_ID,
        deletedAt: DISABLED_AT,
        anonymizedAt: null,
        profilePicture: 'https://res.cloudinary.com/x/image/upload/v1/p.jpg',
        image: null,
      });

      await expect(service.findAnonymizationTarget(USER_ID)).resolves.toEqual({
        id: USER_ID,
        disabled: true,
        anonymizedAt: null,
        profilePicture: 'https://res.cloudinary.com/x/image/upload/v1/p.jpg',
        image: null,
      });
      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          withDeleted: true,
          loadEagerRelations: false,
        }),
      );
    });

    it('404 si no existe', async () => {
      findOne.mockResolvedValueOnce(null);

      await expect(
        service.findAnonymizationTarget(USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('anonymizeDisabledUser', () => {
    beforeEach(() => {
      findOne.mockResolvedValue({
        id: USER_ID,
        deletedAt: DISABLED_AT,
        anonymizedAt: null,
        profilePicture: null,
        image: null,
      });
    });

    it('anonimiza: nombre, email no entregable y único, RUT/teléfono/edad/fotos a null y credenciales borradas', async () => {
      await service.anonymizeDisabledUser(USER_ID, { keepPictures: false });

      expect(managerUpdate).toHaveBeenCalledTimes(1);
      const [entity, criteria, values] = managerUpdate.mock.calls[0] as [
        unknown,
        unknown,
        Record<string, unknown>,
      ];
      expect(entity).toBe(User);
      expect(criteria).toEqual({ id: USER_ID });
      expect(values).toMatchObject({
        name: 'Usuario eliminado',
        email: `deleted+${USER_ID}@vigilia.invalid`,
        emailVerified: false,
        rut: null,
        phone: null,
        age: null,
        image: null,
        profilePicture: null,
      });
      expect(typeof values.anonymizedAt).toBe('function');
      expect((values.anonymizedAt as () => string)()).toBe(
        'COALESCE("anonymizedAt", now())',
      );

      const statements = managerQuery.mock.calls.map(([sql]) => sql);
      expect(statements[0]).toContain('FOR UPDATE');
      expect(statements).toEqual(
        expect.arrayContaining([
          'DELETE FROM "account" WHERE "userId" = $1',
          'DELETE FROM "session" WHERE "userId" = $1',
          'DELETE FROM "token" WHERE "userId" = $1',
          'DELETE FROM "verification" WHERE "value" = $1 OR "identifier" = $2',
          'DELETE FROM "notifications" WHERE "recipientId" = $1',
          // Corrección P7 (QA B1): sus vehículos (la patente lo identifica),
          // soltándolos antes de las visitas que los usan.
          'UPDATE "visits" SET "vehicleId" = NULL WHERE "vehicleId" IN (SELECT "id" FROM "vehicles" WHERE "ownerId" = $1)',
          'DELETE FROM "vehicles" WHERE "ownerId" = $1',
        ]),
      );
      const detach = statements.findIndex((sql) =>
        sql.startsWith('UPDATE "visits" SET "vehicleId" = NULL'),
      );
      const remove = statements.indexOf(
        'DELETE FROM "vehicles" WHERE "ownerId" = $1',
      );
      expect(detach).toBeLessThan(remove);
      const verification = managerQuery.mock.calls.find(([sql]) =>
        sql.includes('"verification"'),
      );
      expect(verification?.[1]).toEqual([USER_ID, 'ana@example.com']);
    });

    it('cierra las sesiones con better-auth ANTES de escribir (corta sus sockets)', async () => {
      await service.anonymizeDisabledUser(USER_ID, { keepPictures: false });

      expect(deleteUserSessions).toHaveBeenCalledWith(USER_ID);
      expect(deleteUserSessions.mock.invocationCallOrder[0]).toBeLessThan(
        managerUpdate.mock.invocationCallOrder[0],
      );
    });

    it('keepPictures: la foto se conserva (su archivo sigue en Cloudinary)', async () => {
      await service.anonymizeDisabledUser(USER_ID, { keepPictures: true });

      const [, , values] = managerUpdate.mock.calls[0] as [
        unknown,
        unknown,
        Record<string, unknown>,
      ];
      expect(values).not.toHaveProperty('profilePicture');
      expect(values).not.toHaveProperty('image');
      expect(values.rut).toBeNull();
    });

    it('cuenta activa: 409 sin cerrar sesiones ni escribir', async () => {
      findOne.mockResolvedValueOnce({
        id: USER_ID,
        deletedAt: null,
        anonymizedAt: null,
      });

      await expect(
        service.anonymizeDisabledUser(USER_ID, { keepPictures: false }),
      ).rejects.toThrow(
        new ConflictException(ONLY_DISABLED_USERS_CAN_BE_ANONYMIZED),
      );
      expect(deleteUserSessions).not.toHaveBeenCalled();
      expect(managerUpdate).not.toHaveBeenCalled();
    });

    it('si la habilitan en paralelo (revalidación bajo el lock): 409 sin escribir', async () => {
      lockedRow = { deletedAt: null, email: 'ana@example.com' };

      await expect(
        service.anonymizeDisabledUser(USER_ID, { keepPictures: false }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(managerUpdate).not.toHaveBeenCalled();
    });

    it('si no se pueden cerrar las sesiones: 500 y no anonimiza (se reintenta)', async () => {
      deleteUserSessions.mockRejectedValueOnce(new Error('adapter down'));
      rootQuery.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.anonymizeDisabledUser(USER_ID, { keepPictures: false }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(managerUpdate).not.toHaveBeenCalled();
    });
  });

  describe('enable', () => {
    it('una cuenta anonimizada no se vuelve a habilitar (409)', async () => {
      findOne.mockResolvedValueOnce({
        id: USER_ID,
        deletedAt: DISABLED_AT,
        anonymizedAt: new Date('2026-09-01T00:00:00Z'),
      });

      await expect(service.enable(USER_ID)).rejects.toThrow(
        new ConflictException(ANONYMIZED_USER_CANNOT_BE_ENABLED),
      );
      expect(restore).not.toHaveBeenCalled();
    });
  });

  describe('assertCanAnonymizeForActor', () => {
    it('no a sí mismo (403)', async () => {
      await expect(
        service.assertCanAnonymizeForActor('admin-a', ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('fuera de su condominio: 404 (no revela que existe)', async () => {
      isMemberOfOrganization.mockResolvedValueOnce(false);

      await expect(
        service.assertCanAnonymizeForActor(USER_ID, ADMIN),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a una cuenta de plataforma: 403', async () => {
      findOne.mockResolvedValueOnce({
        id: USER_ID,
        roles: [role('Super Administrador', ['platform.manage-hubs'])],
      });

      await expect(
        service.assertCanAnonymizeForActor(USER_ID, ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a quien tiene permisos que el actor no tiene (jerarquía): 403', async () => {
      findOne.mockResolvedValueOnce({
        id: USER_ID,
        roles: [role('Otro', ['cameras.delete'])],
      });

      await expect(
        service.assertCanAnonymizeForActor(USER_ID, ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a un residente deshabilitado de su condominio: permitido', async () => {
      findOne.mockResolvedValue({
        id: USER_ID,
        deletedAt: DISABLED_AT,
        roles: [role('Residente', ['visits.read'])],
      });

      await expect(
        service.assertCanAnonymizeForActor(USER_ID, ADMIN),
      ).resolves.toBeUndefined();
      expect(findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });

    it.each([
      ['Conserje', [CONDOMINIUM_VIEW_ALL_PERMISSION, 'visits.read']],
      ['Gestor de usuarios', ['users.update']],
    ])(
      'cuenta de personal (%s): solo el super-admin (403 para el Administrador)',
      async (_name, permissions) => {
        findOne.mockResolvedValue({
          id: USER_ID,
          deletedAt: DISABLED_AT,
          roles: [role('Personal', permissions)],
        });

        await expect(
          service.assertCanAnonymizeForActor(USER_ID, ADMIN),
        ).rejects.toThrow(
          new ForbiddenException(STAFF_ACCOUNT_ANONYMIZATION_FORBIDDEN),
        );
      },
    );

    it('el super-admin sí anonimiza una cuenta de personal', async () => {
      findOne.mockResolvedValue({
        id: USER_ID,
        deletedAt: DISABLED_AT,
        roles: [role('Conserje', [CONDOMINIUM_VIEW_ALL_PERMISSION])],
      });

      await expect(
        service.assertCanAnonymizeForActor(USER_ID, {
          userId: 'root',
          organizationId: null,
          isSuperAdmin: true,
          permissionNames: new Set(),
        }),
      ).resolves.toBeUndefined();
    });
  });
});
