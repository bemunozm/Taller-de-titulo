import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  PermissionsService,
  type PermissionEditor,
} from './permissions.service';
import { Permission } from './entities/permission.entity';
import {
  createMockRepository,
  type MockRepository,
} from '../test-utils/mock-repository';

const SUPER_ADMIN: PermissionEditor = { isSuperAdmin: true };
const ADMIN: PermissionEditor = { isSuperAdmin: false };

const SYSTEM_PERMISSION = {
  id: 'perm-sys',
  name: 'users.read',
  description: 'Ver usuarios',
  module: 'users',
  action: 'read',
} as Permission;
const CUSTOM_PERMISSION = {
  id: 'perm-custom',
  name: 'gardens.read',
  description: 'Ver jardines',
  module: 'gardens',
  action: 'read',
} as Permission;

const NEW_PERMISSION = {
  name: 'gardens.update',
  description: 'Editar jardines',
  module: 'gardens',
  action: 'update',
};

/**
 * Fase 4 · P5 (D10): permisos — mutaciones solo del super-admin; los de
 * sistema no se renombran ni se borran.
 */
describe('PermissionsService (Fase 4 · P5, D10)', () => {
  let service: PermissionsService;
  let repository: MockRepository<Permission>;

  function usePermission(permission: Permission | null): void {
    repository.findOne.mockResolvedValue(permission);
  }

  beforeEach(async () => {
    repository = createMockRepository<Permission>();
    repository.create.mockImplementation((data: Partial<Permission>) => data);
    repository.save.mockImplementation((data: Permission) =>
      Promise.resolve(data),
    );
    repository.update.mockResolvedValue({ affected: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: getRepositoryToken(Permission), useValue: repository },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
  });

  it('crear, editar o borrar -> 403 para quien no es super-admin', async () => {
    usePermission(CUSTOM_PERMISSION);

    await expect(service.create(NEW_PERMISSION, ADMIN)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.update('perm-custom', { description: 'x' }, ADMIN),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove('perm-custom', ADMIN)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('un permiso de sistema no se renombra ni se borra (ni el super-admin)', async () => {
    usePermission(SYSTEM_PERMISSION);

    await expect(
      service.update('perm-sys', { name: 'users.view' }, SUPER_ADMIN),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.remove('perm-sys', SUPER_ADMIN)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('un permiso de sistema sí admite cambiar su descripción', async () => {
    usePermission(SYSTEM_PERMISSION);

    await service.update(
      'perm-sys',
      { description: 'Listar usuarios' },
      SUPER_ADMIN,
    );

    expect(repository.update).toHaveBeenCalledWith('perm-sys', {
      description: 'Listar usuarios',
    });
  });

  it('un permiso personalizado no se renombra a un nombre de sistema', async () => {
    usePermission(CUSTOM_PERMISSION);

    await expect(
      service.update(
        'perm-custom',
        { name: 'platform.manage-hubs' },
        SUPER_ADMIN,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('el super-admin crea, renombra y borra permisos personalizados', async () => {
    usePermission(CUSTOM_PERMISSION);

    await service.create(NEW_PERMISSION, SUPER_ADMIN);
    await service.update('perm-custom', { name: 'gardens.view' }, SUPER_ADMIN);
    await service.remove('perm-custom', SUPER_ADMIN);

    expect(repository.save).toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith('perm-custom', {
      name: 'gardens.view',
    });
    expect(repository.remove).toHaveBeenCalledWith(CUSTOM_PERMISSION);
  });

  it('un nombre repetido -> 409, no 500', async () => {
    repository.save.mockRejectedValue(
      Object.assign(new Error('dup'), { code: '23505' }),
    );

    await expect(service.create(NEW_PERMISSION, SUPER_ADMIN)).rejects.toThrow(
      ConflictException,
    );
  });
});
