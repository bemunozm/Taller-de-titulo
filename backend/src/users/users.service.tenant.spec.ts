import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { QueryFailedError, type FindOperator, type Repository } from 'typeorm';
import { ValidationPipe } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import {
  addSessionEndedListener,
  notifySessionDeleted,
  type SessionEndedEvent,
} from '../auth/session-ended-events';
import type { User } from './entities/user.entity';
import type { Role } from '../roles/entities/role.entity';
import type { Family } from '../families/entities/family.entity';
import type { OrganizationMembershipService } from '../organization-membership/organization-membership.service';
import type { TenantActor } from '../common/tenant/tenant-actor';
import { CONDOMINIUM_VIEW_ALL_PERMISSION } from '../common/constants/default-permissions.constant';
import { DEFAULT_ROLES } from '../common/constants/default-roles.constant';
import {
  createMockRepository,
  type MockRepository,
} from '../test-utils/mock-repository';

/**
 * Fase 4 · P5.A: alta con membresía (D11), `RoleAssignmentPolicy` (D10) y
 * usuarios acotados por condominio (`*ForActor`, D12).
 */
const ORG_A = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0a01';
const ORG_B = '0b5d6d35-2f6a-4f53-9d16-5b8f3e3c0b02';

const ADMIN_PERMISSIONS = [
  'users.create',
  'users.read',
  'users.update',
  'users.delete',
  'visits.read',
  'visits.create',
  CONDOMINIUM_VIEW_ALL_PERMISSION,
];

function makeRole(id: string, name: string, permissions: string[]): Role {
  return {
    id,
    name,
    permissions: permissions.map((permissionName) => ({
      name: permissionName,
    })),
  } as Role;
}

const RESIDENT_ROLE = makeRole('role-residente', 'Residente', ['visits.read']);
const SUPER_ADMIN_ROLE = makeRole('role-super', 'Super Administrador', [
  'platform.manage-organizations',
  'users.create',
]);
const PLATFORM_ROLE = makeRole('role-platform', 'Plataforma custom', [
  'platform.manage-hubs',
]);
const SUPERSET_ROLE = makeRole('role-superset', 'Superset', [
  'visits.read',
  'cameras.delete',
]);
const ALL_ROLES = [
  RESIDENT_ROLE,
  SUPER_ADMIN_ROLE,
  PLATFORM_ROLE,
  SUPERSET_ROLE,
];

function adminOf(
  organizationId: string | null,
  overrides: Partial<TenantActor> = {},
): TenantActor {
  return {
    userId: 'admin-a',
    organizationId,
    isSuperAdmin: false,
    permissionNames: new Set(ADMIN_PERMISSIONS),
    ...overrides,
  };
}

const ADMIN_A = adminOf(ORG_A);
const SUPER_ADMIN: TenantActor = {
  userId: 'root',
  organizationId: null,
  isSuperAdmin: true,
  permissionNames: new Set(),
};

const NEW_ACCOUNT = {
  rut: '11222333-4',
  name: 'Pedro',
  email: 'pedro@correo.cl',
  phone: '+56911111111',
};

describe('UsersService — condominio y RoleAssignmentPolicy (Fase 4 · P5.A)', () => {
  let userRepository: MockRepository<User> & { restore: jest.Mock };
  let roleRepository: MockRepository<Role>;
  let familyRepository: MockRepository<Family>;
  let membership: {
    addMember: jest.Mock<Promise<void>, [string, string]>;
    organizationExists: jest.Mock<Promise<boolean>, [string]>;
    getOrganizationIdForUser: jest.Mock<Promise<string | null>, [string]>;
    isMemberOfOrganization: jest.Mock<Promise<boolean>, [string, string]>;
    isActiveMember: jest.Mock<Promise<boolean>, [string, string]>;
  };
  let requestPasswordReset: jest.Mock;
  /** Cierre de sesiones server-side de better-auth (corrección P5, cyber B2). */
  let deleteUserSessions: jest.Mock<Promise<void>, [string]>;
  let authContext: Promise<unknown>;
  let managerQuery: jest.Mock;
  let service: UsersService;
  /** Pertenencia simulada: userId -> condominio. */
  let memberships: Record<string, string>;

  function byIds(where: unknown): Role[] {
    const ids = (where as { id: FindOperator<string[]> }).id.value;
    return ALL_ROLES.filter((role) => ids.includes(role.id));
  }

  beforeEach(() => {
    memberships = {};
    managerQuery = jest.fn().mockResolvedValue([]);
    userRepository = Object.assign(createMockRepository<User>(), {
      restore: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: { query: managerQuery },
    });
    userRepository.create.mockImplementation((data: Partial<User>) => ({
      ...data,
    }));
    userRepository.save.mockImplementation((user: Partial<User>) =>
      Promise.resolve({ id: user.id ?? 'new-user', ...user }),
    );
    userRepository.findOne.mockResolvedValue(null);
    userRepository.delete.mockResolvedValue({ affected: 1 });
    userRepository.softDelete.mockResolvedValue({ affected: 1 });

    roleRepository = createMockRepository<Role>();
    roleRepository.find.mockImplementation((options: { where: unknown }) =>
      Promise.resolve(byIds(options.where)),
    );
    roleRepository.findBy.mockImplementation((where: unknown) =>
      Promise.resolve(byIds(where)),
    );

    familyRepository = createMockRepository<Family>();
    familyRepository.findOne.mockResolvedValue(null);

    membership = {
      addMember: jest
        .fn<Promise<void>, [string, string]>()
        .mockResolvedValue(undefined),
      organizationExists: jest
        .fn<Promise<boolean>, [string]>()
        .mockResolvedValue(true),
      getOrganizationIdForUser: jest.fn((userId: string) =>
        Promise.resolve(memberships[userId] ?? null),
      ),
      isMemberOfOrganization: jest.fn((userId: string, orgId: string) =>
        Promise.resolve(memberships[userId] === orgId),
      ),
      isActiveMember: jest
        .fn<Promise<boolean>, [string, string]>()
        .mockResolvedValue(true),
    };
    requestPasswordReset = jest.fn().mockResolvedValue({ status: true });
    deleteUserSessions = jest
      .fn<Promise<void>, [string]>()
      .mockResolvedValue(undefined);
    authContext = Promise.resolve({ internalAdapter: { deleteUserSessions } });

    service = new UsersService(
      userRepository as unknown as Repository<User>,
      roleRepository as unknown as Repository<Role>,
      familyRepository as unknown as Repository<Family>,
      { get: jest.fn() } as unknown as ConfigService,
      {
        api: { requestPasswordReset },
        get instance() {
          return { $context: authContext };
        },
      } as unknown as BetterAuthService,
      membership as unknown as OrganizationMembershipService,
    );
  });

  /** Usuario existente con membresía en `organizationId`. */
  function existingUser(
    id: string,
    organizationId: string | null,
    roles: Role[] = [RESIDENT_ROLE],
  ): User {
    if (organizationId) {
      memberships[id] = organizationId;
    }
    const user = { id, name: id, email: `${id}@x.cl`, roles } as User;
    userRepository.findOne.mockImplementation(
      (options: { where: { id?: string } }) =>
        Promise.resolve(options.where.id === id ? user : null),
    );
    return user;
  }

  describe('createAccountByAdmin (membresía, D11)', () => {
    it('crea la cuenta en el condominio del actor y envía el email DESPUÉS de la membresía', async () => {
      const user = await service.createAccountByAdmin(
        { ...NEW_ACCOUNT, roleIds: [RESIDENT_ROLE.id] },
        ADMIN_A,
      );

      expect(user.roles).toEqual([RESIDENT_ROLE]);
      expect(membership.addMember).toHaveBeenCalledWith('new-user', ORG_A);
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
      expect(membership.addMember.mock.invocationCallOrder[0]).toBeLessThan(
        requestPasswordReset.mock.invocationCallOrder[0],
      );
    });

    it('si la membresía falla: borra la cuenta recién creada (compensación), 500 y sin email', async () => {
      membership.addMember.mockRejectedValue(new Error('member insert failed'));

      await expect(
        service.createAccountByAdmin(
          { ...NEW_ACCOUNT, roleIds: [RESIDENT_ROLE.id] },
          ADMIN_A,
        ),
      ).rejects.toThrow(InternalServerErrorException);
      expect(userRepository.delete).toHaveBeenCalledWith('new-user');
      expect(requestPasswordReset).not.toHaveBeenCalled();
    });

    it('si además falla la compensación, igual responde 500 (no otro error)', async () => {
      membership.addMember.mockRejectedValue(new Error('member insert failed'));
      userRepository.delete.mockRejectedValue(new Error('delete failed'));

      await expect(
        service.createAccountByAdmin({ ...NEW_ACCOUNT }, ADMIN_A),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('un actor que no es super-admin y envía organizationId -> 403 sin crear nada', async () => {
      await expect(
        service.createAccountByAdmin(
          { ...NEW_ACCOUNT, organizationId: ORG_A },
          ADMIN_A,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('actor sin condominio -> 403', async () => {
      await expect(
        service.createAccountByAdmin({ ...NEW_ACCOUNT }, adminOf(null)),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('super-admin con organizationId existente: la membresía va a ese condominio', async () => {
      await service.createAccountByAdmin(
        { ...NEW_ACCOUNT, roleIds: [RESIDENT_ROLE.id], organizationId: ORG_B },
        SUPER_ADMIN,
      );

      expect(membership.organizationExists).toHaveBeenCalledWith(ORG_B);
      expect(membership.addMember).toHaveBeenCalledWith('new-user', ORG_B);
    });

    it('super-admin con un organizationId que no existe -> 400', async () => {
      membership.organizationExists.mockResolvedValue(false);

      await expect(
        service.createAccountByAdmin(
          { ...NEW_ACCOUNT, organizationId: ORG_B },
          SUPER_ADMIN,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('super-admin sin organizationId -> 400, salvo una cuenta de plataforma (Super Administrador, sin membresía)', async () => {
      await expect(
        service.createAccountByAdmin(
          { ...NEW_ACCOUNT, roleIds: [RESIDENT_ROLE.id] },
          SUPER_ADMIN,
        ),
      ).rejects.toThrow(BadRequestException);

      await service.createAccountByAdmin(
        { ...NEW_ACCOUNT, roleIds: [SUPER_ADMIN_ROLE.id] },
        SUPER_ADMIN,
      );
      expect(membership.addMember).not.toHaveBeenCalled();
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['el rol "Super Administrador"', SUPER_ADMIN_ROLE],
      ['un rol con permisos platform.*', PLATFORM_ROLE],
      ['un rol con permisos que el actor no tiene', SUPERSET_ROLE],
    ])(
      'el admin no puede asignar %s -> 403 sin crear nada',
      async (_label, role) => {
        await expect(
          service.createAccountByAdmin(
            { ...NEW_ACCOUNT, roleIds: [role.id] },
            ADMIN_A,
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(userRepository.save).not.toHaveBeenCalled();
        expect(membership.addMember).not.toHaveBeenCalled();
      },
    );

    it('un rol inexistente -> 400', async () => {
      await expect(
        service.createAccountByAdmin(
          { ...NEW_ACCOUNT, roleIds: ['role-fantasma'] },
          ADMIN_A,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('familyId de una familia de OTRO condominio -> 403 sin crear nada', async () => {
      familyRepository.findOne.mockResolvedValue({
        id: 'family-b',
        organizationId: ORG_B,
      });

      await expect(
        service.createAccountByAdmin(
          { ...NEW_ACCOUNT, familyId: 'family-b' },
          ADMIN_A,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('familyId de una familia del condominio: se asigna', async () => {
      const family = { id: 'family-a', organizationId: ORG_A } as Family;
      familyRepository.findOne.mockResolvedValue(family);

      const user = await service.createAccountByAdmin(
        { ...NEW_ACCOUNT, familyId: 'family-a' },
        ADMIN_A,
      );
      expect(user.family).toBe(family);
    });

    it('familyId inexistente -> 400', async () => {
      await expect(
        service.createAccountByAdmin(
          { ...NEW_ACCOUNT, familyId: 'family-x' },
          ADMIN_A,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAllForActor (GET /users)', () => {
    it('super-admin: todos los usuarios (sin filtro)', async () => {
      userRepository.find.mockResolvedValue([]);

      await service.findAllForActor(SUPER_ADMIN);

      expect(userRepository.find).toHaveBeenCalledWith({
        relations: ['roles', 'family'],
        withDeleted: true,
      });
    });

    it('admin del condominio A: solo usuarios con membresía en A (subconsulta a member)', async () => {
      userRepository.find.mockResolvedValue([]);

      await service.findAllForActor(ADMIN_A);

      const [[options]] = userRepository.find.mock.calls as Array<
        [{ where: { id: FindOperator<string> } }]
      >;
      const idCondition = options.where.id;
      expect(idCondition.type).toBe('raw');
      expect(idCondition.objectLiteralParameters).toEqual({
        memberOrganizationId: ORG_A,
      });
      const sql = (idCondition.getSql as (alias: string) => string)('u.id');
      expect(sql).toContain('FROM member m');
      expect(sql).toContain(':memberOrganizationId');
    });

    it('sin condominium.view-all: solo él mismo', async () => {
      const self = existingUser('admin-a', ORG_A);

      const result = await service.findAllForActor(
        adminOf(ORG_A, { permissionNames: new Set(['users.read']) }),
      );

      expect(result).toEqual([self]);
      expect(userRepository.find).not.toHaveBeenCalled();
    });

    it('con view-all pero sin condominio: vacío, sin consultar', async () => {
      await expect(service.findAllForActor(adminOf(null))).resolves.toEqual([]);
      expect(userRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('findOneForActor (GET /users/:id)', () => {
    it('admin de A no lee un usuario de B -> 404 (sin cargarlo)', async () => {
      existingUser('user-b', ORG_B);

      await expect(service.findOneForActor('user-b', ADMIN_A)).rejects.toThrow(
        NotFoundException,
      );
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('admin de A lee un usuario de A', async () => {
      const user = existingUser('user-a', ORG_A);

      await expect(service.findOneForActor('user-a', ADMIN_A)).resolves.toBe(
        user,
      );
    });

    it('super-admin lee cualquiera sin consultar membresías', async () => {
      const user = existingUser('user-b', ORG_B);

      await expect(
        service.findOneForActor('user-b', SUPER_ADMIN),
      ).resolves.toBe(user);
      expect(membership.isMemberOfOrganization).not.toHaveBeenCalled();
    });

    it('sin condominium.view-all: solo a sí mismo', async () => {
      existingUser('user-a', ORG_A);
      const reader = adminOf(ORG_A, {
        permissionNames: new Set(['users.read']),
      });

      await expect(service.findOneForActor('user-a', reader)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateForActor (PATCH /users/:id)', () => {
    it('admin de A no edita un usuario de B -> 404 sin guardar', async () => {
      existingUser('user-b', ORG_B);

      await expect(
        service.updateForActor('user-b', { name: 'X' }, ADMIN_A),
      ).rejects.toThrow(NotFoundException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('no puede cambiar sus propios roles -> 403', async () => {
      existingUser('admin-a', ORG_A, [RESIDENT_ROLE]);

      await expect(
        service.updateForActor('admin-a', { roleIds: [] }, ADMIN_A),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('editar sus propios datos reenviando los MISMOS roles no pasa por la política', async () => {
      existingUser('admin-a', ORG_A, [RESIDENT_ROLE]);

      await service.updateForActor(
        'admin-a',
        { name: 'Nuevo nombre', roleIds: [RESIDENT_ROLE.id] },
        ADMIN_A,
      );
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Nuevo nombre' }),
      );
    });

    it('asignar a un usuario de A un rol con más permisos que el actor -> 403', async () => {
      existingUser('user-a', ORG_A, []);

      await expect(
        service.updateForActor(
          'user-a',
          { roleIds: [SUPERSET_ROLE.id] },
          ADMIN_A,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('asignar a un usuario de A un rol dentro de sus permisos: OK', async () => {
      existingUser('user-a', ORG_A, []);

      await service.updateForActor(
        'user-a',
        { roleIds: [RESIDENT_ROLE.id] },
        ADMIN_A,
      );
      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ roles: [RESIDENT_ROLE] }),
      );
    });

    it('un super-admin con membresía en A no lo edita el admin de A -> 403', async () => {
      existingUser('root-member', ORG_A, [SUPER_ADMIN_ROLE]);

      await expect(
        service.updateForActor('root-member', { name: 'X' }, ADMIN_A),
      ).rejects.toThrow(ForbiddenException);
    });

    it('familyId de otro condominio -> 403 sin guardar', async () => {
      existingUser('user-a', ORG_A);
      familyRepository.findOne.mockResolvedValue({
        id: 'family-b',
        organizationId: ORG_B,
      });

      await expect(
        service.updateForActor('user-a', { familyId: 'family-b' }, ADMIN_A),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('el super-admin puede asignar "Super Administrador"', async () => {
      existingUser('user-b', ORG_B, []);

      await service.updateForActor(
        'user-b',
        { roleIds: [SUPER_ADMIN_ROLE.id] },
        SUPER_ADMIN,
      );
      expect(userRepository.save).toHaveBeenCalled();
    });
  });

  describe('removeForActor / disableForActor / enableForActor', () => {
    it('admin de A no borra un usuario de B -> 404', async () => {
      existingUser('user-b', ORG_B);

      await expect(service.removeForActor('user-b', ADMIN_A)).rejects.toThrow(
        NotFoundException,
      );
      expect(userRepository.delete).not.toHaveBeenCalled();
    });

    it('nadie se borra ni se deshabilita a sí mismo (tampoco el super-admin) -> 403', async () => {
      existingUser('admin-a', ORG_A);

      await expect(service.removeForActor('admin-a', ADMIN_A)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.disableForActor('admin-a', ADMIN_A)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.removeForActor('root', SUPER_ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
      expect(userRepository.delete).not.toHaveBeenCalled();
      expect(userRepository.softDelete).not.toHaveBeenCalled();
    });

    it('el admin no borra ni deshabilita a un super-admin -> 403; el super-admin sí', async () => {
      existingUser('root-member', ORG_A, [SUPER_ADMIN_ROLE]);

      await expect(
        service.removeForActor('root-member', ADMIN_A),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.disableForActor('root-member', ADMIN_A),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.delete).not.toHaveBeenCalled();

      await service.removeForActor('root-member', SUPER_ADMIN);
      expect(userRepository.delete).toHaveBeenCalledWith('root-member');
    });

    it('admin de A borra y deshabilita usuarios de A', async () => {
      existingUser('user-a', ORG_A);

      await service.disableForActor('user-a', ADMIN_A);
      await service.removeForActor('user-a', ADMIN_A);

      expect(userRepository.softDelete).toHaveBeenCalledWith('user-a');
      expect(userRepository.delete).toHaveBeenCalledWith('user-a');
    });

    it('enable: usuario de B -> 404; usuario de A deshabilitado -> se habilita', async () => {
      existingUser('user-b', ORG_B);
      await expect(service.enableForActor('user-b', ADMIN_A)).rejects.toThrow(
        NotFoundException,
      );

      const disabled = existingUser('user-a', ORG_A);
      disabled.deletedAt = new Date();
      await service.enableForActor('user-a', ADMIN_A);
      expect(userRepository.restore).toHaveBeenCalledWith('user-a');
    });
  });

  /**
   * Corrección P6 (cyber+QA): deshabilitar cierra las sesiones (el hook de
   * borrado corta el socket al instante) y habilitar no revive ninguna
   * sesión anterior.
   */
  describe('disable / enable cierran las sesiones (corrección P6)', () => {
    /** `session` simulada: userId -> ids de sesión vivas. */
    let sessionStore: Map<string, string[]>;
    let ended: SessionEndedEvent[];
    let removeListener: () => void;

    /** Sesión nueva del usuario (un login, aunque esté deshabilitado). */
    function login(userId: string): string {
      const sessionId = `sess-${userId}-${(sessionStore.get(userId) ?? []).length + 1}-${Math.random()}`;
      sessionStore.set(userId, [
        ...(sessionStore.get(userId) ?? []),
        sessionId,
      ]);
      return sessionId;
    }

    function isAlive(userId: string, sessionId: string): boolean {
      return (sessionStore.get(userId) ?? []).includes(sessionId);
    }

    beforeEach(() => {
      sessionStore = new Map();
      ended = [];
      removeListener = addSessionEndedListener((event) => ended.push(event));
      // Como better-auth: borra las filas y corre `session.delete.after` por
      // cada una (sin contexto de endpoint: motivo `revoked`).
      deleteUserSessions.mockImplementation((userId: string) => {
        for (const id of sessionStore.get(userId) ?? []) {
          notifySessionDeleted(
            { id, userId, expiresAt: new Date(Date.now() + 3_600_000) },
            null,
          );
        }
        sessionStore.delete(userId);
        return Promise.resolve();
      });
    });

    afterEach(() => {
      removeListener();
    });

    it('deshabilitar: soft-delete y DESPUÉS cierra todas sus sesiones; el gateway recibe revoked por cada una', async () => {
      existingUser('user-a', ORG_A);
      const laptop = login('user-a');
      const phone = login('user-a');

      await expect(service.disableForActor('user-a', ADMIN_A)).resolves.toEqual(
        expect.objectContaining({ affected: 1 }),
      );

      expect(userRepository.softDelete).toHaveBeenCalledWith('user-a');
      expect(deleteUserSessions).toHaveBeenCalledWith('user-a');
      expect(
        userRepository.softDelete.mock.invocationCallOrder[0],
      ).toBeLessThan(deleteUserSessions.mock.invocationCallOrder[0]);
      expect(isAlive('user-a', laptop)).toBe(false);
      expect(isAlive('user-a', phone)).toBe(false);
      expect(ended.map((event) => event.sessionId).sort()).toEqual(
        [laptop, phone].sort(),
      );
      expect(new Set(ended.map((event) => event.reason))).toEqual(
        new Set(['revoked']),
      );
    });

    it('sin better-auth disponible: cierra las sesiones con SQL (sin hook; cae en la revalidación del socket)', async () => {
      existingUser('user-a', ORG_A);
      deleteUserSessions.mockRejectedValue(new Error('adapter down'));

      await service.disableForActor('user-a', ADMIN_A);

      expect(managerQuery).toHaveBeenCalledWith(
        'DELETE FROM "session" WHERE "userId" = $1',
        ['user-a'],
      );
    });

    it('si no se pueden cerrar las sesiones: 500 explícito (la cuenta ya quedó deshabilitada)', async () => {
      existingUser('user-a', ORG_A);
      deleteUserSessions.mockRejectedValue(new Error('adapter down'));
      managerQuery.mockRejectedValue(new Error('db down'));

      await expect(service.disableForActor('user-a', ADMIN_A)).rejects.toThrow(
        new InternalServerErrorException(
          'El usuario quedó deshabilitado, pero no se pudieron cerrar sus sesiones abiertas. No puede usarlas mientras esté deshabilitado y se cerrarán al volver a habilitarlo.',
        ),
      );
      expect(userRepository.softDelete).toHaveBeenCalledWith('user-a');
    });

    it('re-habilitar NO reactiva la sesión vieja (ni una abierta mientras estaba deshabilitado)', async () => {
      const user = existingUser('user-a', ORG_A);
      const before = login('user-a');
      // El cierre al deshabilitar falla por completo: la sesión queda en la BD.
      deleteUserSessions.mockRejectedValueOnce(new Error('adapter down'));
      managerQuery.mockRejectedValueOnce(new Error('db down'));
      await expect(service.disableForActor('user-a', ADMIN_A)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(isAlive('user-a', before)).toBe(true);
      // better-auth no conoce el soft-delete: un login sigue creando sesión.
      const whileDisabled = login('user-a');
      user.deletedAt = new Date();

      await service.enableForActor('user-a', ADMIN_A);

      expect(isAlive('user-a', before)).toBe(false);
      expect(isAlive('user-a', whileDisabled)).toBe(false);
      expect(deleteUserSessions.mock.invocationCallOrder.at(-1)).toBeLessThan(
        userRepository.restore.mock.invocationCallOrder[0],
      );
      expect(userRepository.restore).toHaveBeenCalledWith('user-a');
    });

    it('habilitar: si no se pueden cerrar las sesiones anteriores, NO restaura (sigue deshabilitado) y responde 500', async () => {
      const user = existingUser('user-a', ORG_A);
      user.deletedAt = new Date();
      deleteUserSessions.mockRejectedValue(new Error('adapter down'));
      managerQuery.mockRejectedValue(new Error('db down'));

      await expect(service.enableForActor('user-a', ADMIN_A)).rejects.toThrow(
        new InternalServerErrorException(
          'No se pudieron cerrar las sesiones anteriores del usuario; sigue deshabilitado. Vuelve a intentarlo.',
        ),
      );
      expect(userRepository.restore).not.toHaveBeenCalled();
    });

    it('DELETE /users/:id: cierra las sesiones (revoked al gateway) ANTES de borrar', async () => {
      existingUser('user-a', ORG_A);
      const session = login('user-a');

      await service.removeForActor('user-a', ADMIN_A);

      expect(isAlive('user-a', session)).toBe(false);
      expect(ended).toEqual([
        { sessionId: session, userId: 'user-a', reason: 'revoked' },
      ]);
      expect(deleteUserSessions.mock.invocationCallOrder[0]).toBeLessThan(
        userRepository.delete.mock.invocationCallOrder[0],
      );
    });

    it('DELETE de alguien fuera del alcance no toca sus sesiones', async () => {
      existingUser('user-b', ORG_B);
      login('user-b');

      await expect(service.removeForActor('user-b', ADMIN_A)).rejects.toThrow(
        NotFoundException,
      );
      expect(deleteUserSessions).not.toHaveBeenCalled();
    });

    it('deshabilitar a alguien fuera del alcance (403/404) no toca sus sesiones', async () => {
      existingUser('user-b', ORG_B);
      login('user-b');

      await expect(service.disableForActor('user-b', ADMIN_A)).rejects.toThrow(
        NotFoundException,
      );
      expect(deleteUserSessions).not.toHaveBeenCalled();
      expect(sessionStore.get('user-b')).toHaveLength(1);
    });
  });

  describe('proyección de GET /users y GET /users/:id (P5.C)', () => {
    /** Conserje: `users.read` + `condominium.view-all`, sin `users.update`. */
    const CONCIERGE_A = adminOf(ORG_A, {
      userId: 'conserje-a',
      permissionNames: new Set(['users.read', CONDOMINIUM_VIEW_ALL_PERMISSION]),
    });

    function fullUser(id: string): User {
      return {
        id,
        name: `Nombre ${id}`,
        email: `${id}@x.cl`,
        rut: '11111111-1',
        phone: '+56900000000',
        roles: [RESIDENT_ROLE],
        family: { id: 'fam-1', name: 'Familia Uno' },
      } as unknown as User;
    }

    it('sin users.update: cada usuario (que no es el propio) va como { id, name, family: { id, name } | null }', async () => {
      userRepository.find.mockResolvedValue([
        fullUser('res-1'),
        { ...fullUser('res-2'), family: null },
      ]);

      const result = await service.findAllForActor(CONCIERGE_A);

      expect(result).toEqual([
        {
          id: 'res-1',
          name: 'Nombre res-1',
          family: { id: 'fam-1', name: 'Familia Uno' },
        },
        { id: 'res-2', name: 'Nombre res-2', family: null },
      ]);
      // Sin email, RUT, teléfono ni roles.
      for (const entry of result) {
        expect(Object.keys(entry).sort()).toEqual(['family', 'id', 'name']);
      }
    });

    it('con users.update (Administrador): el detalle completo', async () => {
      const user = fullUser('res-1');
      userRepository.find.mockResolvedValue([user]);

      await expect(service.findAllForActor(ADMIN_A)).resolves.toEqual([user]);
    });

    it('super-admin: el detalle completo', async () => {
      const user = fullUser('res-1');
      userRepository.find.mockResolvedValue([user]);

      await expect(service.findAllForActor(SUPER_ADMIN)).resolves.toEqual([
        user,
      ]);
    });

    it('el propio usuario va siempre completo (sin view-all solo se ve a sí mismo)', async () => {
      const self = existingUser('conserje-a', ORG_A);
      userRepository.find.mockResolvedValue([self, fullUser('res-1')]);

      const result = await service.findAllForActor(CONCIERGE_A);

      expect(result[0]).toBe(self);
      expect(result[1]).toEqual({
        id: 'res-1',
        name: 'Nombre res-1',
        family: { id: 'fam-1', name: 'Familia Uno' },
      });
    });

    it('GET /users/:id sin users.update: proyección; con users.update: detalle', async () => {
      const user = existingUser('user-a', ORG_A);
      user.family = { id: 'fam-1', name: 'Familia Uno' } as Family;

      await expect(
        service.findOneForActor('user-a', CONCIERGE_A),
      ).resolves.toEqual({
        id: 'user-a',
        name: 'user-a',
        family: { id: 'fam-1', name: 'Familia Uno' },
      });
      await expect(service.findOneForActor('user-a', ADMIN_A)).resolves.toBe(
        user,
      );
    });
  });

  it('P5.C: DELETE de un usuario con registros asociados (FK) -> 409 que sugiere deshabilitarlo, no 500', async () => {
    existingUser('user-a', ORG_A);
    userRepository.delete.mockRejectedValueOnce(
      new QueryFailedError(
        'DELETE FROM "user"',
        [],
        Object.assign(new Error('fk'), { code: '23503' }),
      ),
    );

    const attempt = service.removeForActor('user-a', ADMIN_A);
    await expect(attempt).rejects.toThrow(ConflictException);
    await expect(attempt).rejects.toThrow(/Deshabilítalo/);
  });

  it('P5.C: otros errores del DELETE siguen siendo 500', async () => {
    existingUser('user-a', ORG_A);
    userRepository.delete.mockRejectedValueOnce(new Error('db down'));

    await expect(service.removeForActor('user-a', ADMIN_A)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  describe('corrección P5 (cyber B2): cambio de email de OTRO usuario', () => {
    function userWithEmail(id: string, email: string): User {
      const user = existingUser(id, ORG_A);
      user.email = email;
      user.emailVerified = true;
      return user;
    }

    it('residual de B2: un actor que no es super-admin (aunque sea Administrador) -> 403 sin guardar', async () => {
      userWithEmail('user-a', 'antes@x.cl');

      await expect(
        service.updateForActor('user-a', { email: 'despues@x.cl' }, ADMIN_A),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(deleteUserSessions).not.toHaveBeenCalled();
    });

    it('el super-admin: deja el email sin verificar y cierra todas sus sesiones (API server-side de better-auth)', async () => {
      userWithEmail('user-a', 'antes@x.cl');

      await service.updateForActor(
        'user-a',
        { email: 'despues@x.cl' },
        SUPER_ADMIN,
      );

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'despues@x.cl',
          emailVerified: false,
        }),
      );
      expect(deleteUserSessions).toHaveBeenCalledWith('user-a');
      expect(managerQuery).not.toHaveBeenCalled();
    });

    it('si better-auth no está disponible, borra las filas de session', async () => {
      userWithEmail('user-a', 'antes@x.cl');
      authContext = Promise.reject(new Error('sin contexto'));
      authContext.catch(() => undefined);

      await service.updateForActor(
        'user-a',
        { email: 'despues@x.cl' },
        SUPER_ADMIN,
      );

      expect(managerQuery).toHaveBeenCalledWith(
        'DELETE FROM "session" WHERE "userId" = $1',
        ['user-a'],
      );
    });

    it('si no se pueden cerrar las sesiones por ninguna vía -> 500', async () => {
      userWithEmail('user-a', 'antes@x.cl');
      deleteUserSessions.mockRejectedValue(new Error('adapter down'));
      managerQuery.mockRejectedValue(new Error('db down'));

      await expect(
        service.updateForActor(
          'user-a',
          { email: 'despues@x.cl' },
          SUPER_ADMIN,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('el mismo email (otra capitalización), otro campo o su propio email: no cierra sesiones', async () => {
      userWithEmail('user-a', 'antes@x.cl');
      await service.updateForActor('user-a', { email: 'ANTES@x.cl' }, ADMIN_A);
      await service.updateForActor('user-a', { name: 'Otro nombre' }, ADMIN_A);
      userWithEmail('admin-a', 'admin@x.cl');
      await service.updateForActor(
        'admin-a',
        { email: 'nuevo-admin@x.cl' },
        ADMIN_A,
      );

      expect(deleteUserSessions).not.toHaveBeenCalled();
      for (const [saved] of userRepository.save.mock.calls as Array<[User]>) {
        expect(saved.emailVerified).toBe(true);
      }
    });

    it('UpdateUserDto ya no acepta emailVerified (400 con forbidNonWhitelisted)', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      });

      await expect(
        pipe.transform(
          { emailVerified: true },
          { type: 'body', metatype: UpdateUserDto },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('corrección P5 (QA): duplicados -> 409 con el campo', () => {
    function duplicate(detail: string, constraint?: string): QueryFailedError {
      return new QueryFailedError(
        'INSERT INTO "user"',
        [],
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          detail,
          constraint,
        }),
      );
    }

    async function conflictBodyOf(promise: Promise<unknown>): Promise<unknown> {
      const error = await promise.then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(error).toBeInstanceOf(ConflictException);
      return (error as ConflictException).getResponse();
    }

    it.each([
      [
        'phone',
        'Key (phone)=(+56911111111) already exists.',
        'El teléfono ya está en uso',
      ],
      [
        'rut',
        'Key (rut)=(11222333-4) already exists.',
        'El RUT ya está en uso',
      ],
      [
        'email',
        'Key (email)=(pedro@correo.cl) already exists.',
        'El email ya está en uso',
      ],
    ])(
      'alta con %s repetido -> 409 { message, field }',
      async (field, detail, message) => {
        userRepository.save.mockRejectedValueOnce(duplicate(detail));

        await expect(
          conflictBodyOf(
            service.createAccountByAdmin(
              { ...NEW_ACCOUNT, roleIds: [] },
              ADMIN_A,
            ),
          ),
        ).resolves.toEqual({
          statusCode: 409,
          error: 'Conflict',
          message,
          field,
        });
      },
    );

    it('sin detalle: el campo sale del nombre del constraint', async () => {
      userRepository.save.mockRejectedValueOnce(
        duplicate('', 'UQ_8e1f623798118e629b46a9e6299'),
      );

      await expect(
        conflictBodyOf(
          service.createAccountByAdmin(
            { ...NEW_ACCOUNT, roleIds: [] },
            ADMIN_A,
          ),
        ),
      ).resolves.toEqual(expect.objectContaining({ field: 'phone' }));
    });

    it('email ya registrado (chequeo previo) -> 409 field email', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'otro' });

      await expect(
        conflictBodyOf(
          service.createAccountByAdmin(
            { ...NEW_ACCOUNT, roleIds: [] },
            ADMIN_A,
          ),
        ),
      ).resolves.toEqual(expect.objectContaining({ field: 'email' }));
    });

    it('PATCH con un RUT repetido -> 409 field rut (antes 400 "email")', async () => {
      existingUser('user-a', ORG_A);
      userRepository.save.mockRejectedValueOnce(
        duplicate('Key (rut)=(1-9) already exists.'),
      );

      await expect(
        conflictBodyOf(
          service.updateForActor('user-a', { rut: '1-9' }, ADMIN_A),
        ),
      ).resolves.toEqual(expect.objectContaining({ field: 'rut' }));
    });
  });

  it('corrección P5 (QA): la vista proyectada de GET /users no lista deshabilitados; la completa sí', async () => {
    const active = {
      id: 'u-1',
      name: 'Activa',
      family: null,
    } as unknown as User;
    const disabled = {
      id: 'u-2',
      name: 'Deshabilitada',
      family: null,
      deletedAt: new Date(),
    } as unknown as User;
    userRepository.find.mockResolvedValue([active, disabled]);
    const conserje = adminOf(ORG_A, {
      userId: 'conserje-a',
      permissionNames: new Set(['users.read', CONDOMINIUM_VIEW_ALL_PERMISSION]),
    });

    await expect(service.findAllForActor(conserje)).resolves.toEqual([
      { id: 'u-1', name: 'Activa', family: null },
    ]);
    await expect(service.findAllForActor(ADMIN_A)).resolves.toEqual([
      active,
      disabled,
    ]);
  });

  describe('corrección P5 (cyber N1): jerarquía sobre los roles ACTUALES del destino', () => {
    function systemRole(name: string): Role {
      const definition = DEFAULT_ROLES.find((role) => role.name === name);
      if (!definition) {
        throw new Error(`Rol de sistema inexistente: ${name}`);
      }
      return makeRole(`role-${name}`, name, definition.permissions);
    }

    function actorWithRole(userId: string, name: string): TenantActor {
      return adminOf(ORG_A, {
        userId,
        permissionNames: new Set(
          systemRole(name).permissions.map((p) => p.name),
        ),
      });
    }

    const DEVELOPER = () => actorWithRole('dev-a', 'Desarrollador');
    const ADMINISTRATOR = () => actorWithRole('admin-real-a', 'Administrador');

    it.each([
      [
        'PATCH',
        (svc: UsersService, a: TenantActor) =>
          svc.updateForActor('target', { name: 'X' }, a),
      ],
      [
        'disable',
        (svc: UsersService, a: TenantActor) => svc.disableForActor('target', a),
      ],
      [
        'enable',
        (svc: UsersService, a: TenantActor) => svc.enableForActor('target', a),
      ],
      [
        'DELETE',
        (svc: UsersService, a: TenantActor) => svc.removeForActor('target', a),
      ],
    ] as const)(
      'Desarrollador (con users.update y view-all) sobre el Administrador: %s -> 403 sin escribir',
      async (_operation, run) => {
        const target = existingUser('target', ORG_A, [
          systemRole('Administrador'),
        ]);
        target.deletedAt = new Date();

        await expect(run(service, DEVELOPER())).rejects.toThrow(
          ForbiddenException,
        );
        expect(userRepository.save).not.toHaveBeenCalled();
        expect(userRepository.softDelete).not.toHaveBeenCalled();
        expect(userRepository.restore).not.toHaveBeenCalled();
        expect(userRepository.delete).not.toHaveBeenCalled();
      },
    );

    it.each(['Conserje', 'Residente', 'Seguridad', 'Administrador'])(
      'Administrador sobre un %s: PATCH, disable y DELETE permitidos',
      async (roleName) => {
        existingUser('target', ORG_A, [systemRole(roleName)]);

        await service.updateForActor(
          'target',
          { name: 'Nuevo' },
          ADMINISTRATOR(),
        );
        await service.disableForActor('target', ADMINISTRATOR());
        await service.removeForActor('target', ADMINISTRATOR());

        expect(userRepository.save).toHaveBeenCalled();
        expect(userRepository.softDelete).toHaveBeenCalledWith('target');
        expect(userRepository.delete).toHaveBeenCalledWith('target');
      },
    );

    it('Administrador sobre otro Administrador: el email sigue siendo solo de la plataforma -> 403', async () => {
      const target = existingUser('target', ORG_A, [
        systemRole('Administrador'),
      ]);
      target.email = 'otro-admin@x.cl';

      await expect(
        service.updateForActor(
          'target',
          { email: 'mio@x.cl' },
          ADMINISTRATOR(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sobre sí mismo no aplica: editar sus datos (sin cambiar roles) está permitido', async () => {
      existingUser('dev-a', ORG_A, [systemRole('Desarrollador')]);

      await service.updateForActor('dev-a', { name: 'Yo' }, DEVELOPER());

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Yo' }),
      );
    });

    it('el super-admin no tiene jerarquía', async () => {
      existingUser('target', ORG_A, [systemRole('Administrador')]);

      await service.disableForActor('target', SUPER_ADMIN);

      expect(userRepository.softDelete).toHaveBeenCalledWith('target');
    });
  });

  it('isActiveMemberOfOrganization delega en las membresías', async () => {
    membership.isActiveMember.mockResolvedValue(false);

    await expect(
      service.isActiveMemberOfOrganization('user-a', ORG_A),
    ).resolves.toBe(false);
    expect(membership.isActiveMember).toHaveBeenCalledWith('user-a', ORG_A);
  });
});
