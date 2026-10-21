import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RolesService, type RoleEditor } from './roles.service';
import { Role } from './entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { DEFAULT_ROLES } from '../common/constants/default-roles.constant';
import {
  createMockRepository,
  type MockRepository,
} from '../test-utils/mock-repository';

const SUPER_ADMIN: RoleEditor = { isSuperAdmin: true };
const ADMIN: RoleEditor = { isSuperAdmin: false };

const CUSTOM_ROLE = {
  id: 'role-custom',
  name: 'Jardinero',
  permissions: [],
} as unknown as Role;
const SUPER_ROLE = {
  id: 'role-super',
  name: 'Super Administrador',
  permissions: [],
} as unknown as Role;

/**
 * Fase 4 · P5 (D10): roles de sistema inmutables, mutaciones solo del
 * super-admin, 409 al borrar un rol con usuarios y `GET /roles/:id` sin users.
 */
describe('RolesService (Fase 4 · P5, D10)', () => {
  let service: RolesService;
  let roleRepository: MockRepository<Role> & { query: jest.Mock };
  let permissionRepository: MockRepository<Permission>;

  function useRoles(...roles: Role[]): void {
    roleRepository.findOne.mockImplementation(
      (options: { where: { id: string } }) =>
        Promise.resolve(
          roles.find((role) => role.id === options.where.id) ?? null,
        ),
    );
  }

  beforeEach(async () => {
    roleRepository = Object.assign(createMockRepository<Role>(), {
      query: jest.fn().mockResolvedValue([{ count: 0 }]),
    });
    permissionRepository = createMockRepository<Permission>();
    roleRepository.update.mockResolvedValue({ affected: 1 });
    roleRepository.delete.mockResolvedValue({ affected: 1 });
    roleRepository.save.mockImplementation((role: Role) =>
      Promise.resolve(role),
    );
    roleRepository.create.mockImplementation((data: Partial<Role>) => data);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: getRepositoryToken(Role), useValue: roleRepository },
        {
          provide: getRepositoryToken(Permission),
          useValue: permissionRepository,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  it('P5.C: GET /roles marca cada rol con isSystem (los de DEFAULT_ROLES)', async () => {
    roleRepository.find.mockResolvedValue([
      { ...SUPER_ROLE },
      { ...CUSTOM_ROLE },
      { id: 'role-res', name: 'Residente', permissions: [] },
    ]);

    const roles = await service.findAll();

    expect(roles.map((role) => [role.name, role.isSystem])).toEqual([
      ['Super Administrador', true],
      ['Jardinero', false],
      ['Residente', true],
    ]);
    expect(roleRepository.find).toHaveBeenCalledWith({
      relations: ['permissions'],
      order: { name: 'ASC' },
    });
  });

  it('GET /roles/:id: carga los permisos pero NO los usuarios', async () => {
    useRoles(CUSTOM_ROLE);

    await service.findOne('role-custom');

    expect(roleRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'role-custom' },
      relations: ['permissions'],
    });
  });

  describe('solo el super-admin muta roles (chequeo explícito)', () => {
    it('create / update / remove / updateRolePermissions -> 403 para quien no es super-admin', async () => {
      useRoles(CUSTOM_ROLE);

      await expect(service.create({ name: 'Nuevo' }, ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.update('role-custom', { name: 'Otro' }, ADMIN),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.remove('role-custom', ADMIN)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        service.updateRolePermissions('role-custom', [], ADMIN),
      ).rejects.toThrow(ForbiddenException);

      expect(roleRepository.save).not.toHaveBeenCalled();
      expect(roleRepository.update).not.toHaveBeenCalled();
      expect(roleRepository.delete).not.toHaveBeenCalled();
    });

    it('el super-admin crea un rol personalizado (sin tomar campos extra del body)', async () => {
      await service.create(
        { name: 'Jardinero', description: 'Mantención', permissionIds: ['p1'] },
        SUPER_ADMIN,
      );

      expect(roleRepository.create).toHaveBeenCalledWith({
        name: 'Jardinero',
        description: 'Mantención',
      });
    });

    it('nadie crea un rol con el nombre de un rol de sistema', async () => {
      await expect(
        service.create({ name: 'Administrador' }, SUPER_ADMIN),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('roles de sistema inmutables (ni el super-admin por la API)', () => {
    it.each(DEFAULT_ROLES.map((role) => role.name))(
      '"%s": renombrar, borrar o cambiar permisos -> 403',
      async (name) => {
        const role = {
          id: `sys-${name}`,
          name,
          permissions: [],
        } as unknown as Role;
        useRoles(role);

        await expect(
          service.update(role.id, { name: 'Renombrado' }, SUPER_ADMIN),
        ).rejects.toThrow(ForbiddenException);
        await expect(service.remove(role.id, SUPER_ADMIN)).rejects.toThrow(
          ForbiddenException,
        );
        await expect(
          service.updateRolePermissions(role.id, [], SUPER_ADMIN),
        ).rejects.toThrow(ForbiddenException);

        expect(roleRepository.update).not.toHaveBeenCalled();
        expect(roleRepository.delete).not.toHaveBeenCalled();
        expect(roleRepository.save).not.toHaveBeenCalled();
      },
    );

    it('un rol personalizado no se puede renombrar a un nombre de sistema', async () => {
      useRoles(CUSTOM_ROLE);

      await expect(
        service.update('role-custom', { name: SUPER_ROLE.name }, SUPER_ADMIN),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('roles personalizados (super-admin)', () => {
    it('update cambia nombre/descripción y devuelve el rol', async () => {
      useRoles(CUSTOM_ROLE);

      const result = await service.update(
        'role-custom',
        { name: 'Jardinero jefe', description: 'x' },
        SUPER_ADMIN,
      );

      expect(roleRepository.update).toHaveBeenCalledWith('role-custom', {
        name: 'Jardinero jefe',
        description: 'x',
      });
      expect(result).toBe(CUSTOM_ROLE);
    });

    it('borrar un rol asignado a usuarios -> 409 sin borrar', async () => {
      useRoles(CUSTOM_ROLE);
      roleRepository.query.mockResolvedValue([{ count: 3 }]);

      await expect(service.remove('role-custom', SUPER_ADMIN)).rejects.toThrow(
        ConflictException,
      );
      expect(roleRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('user_roles_role'),
        ['role-custom'],
      );
      expect(roleRepository.delete).not.toHaveBeenCalled();
    });

    it('borrar un rol que una FK todavía usa (p. ej. cámaras) -> 409, no 500', async () => {
      useRoles(CUSTOM_ROLE);
      roleRepository.delete.mockRejectedValue(
        Object.assign(new Error('fk'), { code: '23503' }),
      );

      await expect(service.remove('role-custom', SUPER_ADMIN)).rejects.toThrow(
        ConflictException,
      );
    });

    it('borrar un rol sin usuarios: OK', async () => {
      useRoles(CUSTOM_ROLE);

      await expect(service.remove('role-custom', SUPER_ADMIN)).resolves.toEqual(
        {
          message: 'Rol eliminado exitosamente',
          deleted: true,
        },
      );
      expect(roleRepository.delete).toHaveBeenCalledWith('role-custom');
    });

    it('rol inexistente -> 404', async () => {
      useRoles();

      await expect(service.remove('nope', SUPER_ADMIN)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updateRolePermissions reemplaza los permisos (ids deduplicados)', async () => {
      const role = { ...CUSTOM_ROLE, permissions: [] } as unknown as Role;
      useRoles(role);
      const permission = { id: 'p1', name: 'visits.read' } as Permission;
      permissionRepository.findBy.mockResolvedValue([permission]);

      await service.updateRolePermissions(
        'role-custom',
        ['p1', 'p1'],
        SUPER_ADMIN,
      );

      expect(roleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: [permission] }),
      );
    });

    it('updateRolePermissions con un permiso inexistente -> 404', async () => {
      useRoles(CUSTOM_ROLE);
      permissionRepository.findBy.mockResolvedValue([]);

      await expect(
        service.updateRolePermissions('role-custom', ['p-x'], SUPER_ADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
