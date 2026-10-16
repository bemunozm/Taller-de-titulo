import type { FindOperator, Repository } from 'typeorm';
import { DataInitializationService } from './data-initialization.service';
import type { Role } from '../../roles/entities/role.entity';
import type { Permission } from '../../permissions/entities/permission.entity';
import {
  CONDOMINIUM_VIEW_ALL_PERMISSION,
  DEFAULT_PERMISSIONS,
} from '../constants/default-permissions.constant';
import { DEFAULT_ROLES } from '../constants/default-roles.constant';

/**
 * Fase 4 · P5 (D10): los roles de sistema se sincronizan al arrancar con su
 * definición en el código (agrega los permisos que faltan y quita los que
 * sobran) y la tabla final de `DEFAULT_ROLES`.
 */
describe('DataInitializationService — roles de sistema (Fase 4 · P5)', () => {
  let permissions: Permission[];
  let roles: Role[];
  let saves: number;
  let service: DataInitializationService;

  function roleNamed(name: string): Role {
    const role = roles.find((candidate) => candidate.name === name);
    if (!role) {
      throw new Error(`rol ${name} no sembrado`);
    }
    return role;
  }

  function permissionNamesOf(name: string): string[] {
    return (roleNamed(name).permissions ?? [])
      .map((permission) => permission.name)
      .sort();
  }

  function definitionOf(name: string): string[] {
    const definition = DEFAULT_ROLES.find((role) => role.name === name);
    return [...(definition?.permissions ?? [])].sort();
  }

  beforeEach(() => {
    permissions = [];
    roles = [];
    saves = 0;

    const permissionRepository = {
      findOne: jest.fn((options: { where: { name: string } }) =>
        Promise.resolve(
          permissions.find((p) => p.name === options.where.name) ?? null,
        ),
      ),
      create: jest.fn((data: Partial<Permission>) => ({ ...data })),
      save: jest.fn((permission: Permission) => {
        const saved = { ...permission, id: `perm-${permissions.length}` };
        permissions.push(saved);
        return Promise.resolve(saved);
      }),
      find: jest.fn(
        (options?: { where?: { name: FindOperator<string[]> } }) => {
          const names = options?.where?.name.value;
          return Promise.resolve(
            names
              ? permissions.filter((p) => names.includes(p.name))
              : [...permissions],
          );
        },
      ),
    };
    const roleRepository = {
      findOne: jest.fn((options: { where: { name: string } }) =>
        Promise.resolve(
          roles.find((role) => role.name === options.where.name) ?? null,
        ),
      ),
      create: jest.fn((data: Partial<Role>) => ({ ...data, permissions: [] })),
      save: jest.fn((role: Role) => {
        saves += 1;
        if (!roles.includes(role)) {
          roles.push({ ...role, id: `role-${roles.length}` });
        }
        return Promise.resolve(role);
      }),
    };

    service = new DataInitializationService(
      roleRepository as unknown as Repository<Role>,
      permissionRepository as unknown as Repository<Permission>,
    );
  });

  it('primer arranque: cada rol queda exactamente con su definición; Super Administrador con todos', async () => {
    await service.onModuleInit();

    expect(permissions).toHaveLength(DEFAULT_PERMISSIONS.length);
    for (const definition of DEFAULT_ROLES) {
      if (definition.name === 'Super Administrador') {
        expect(permissionNamesOf(definition.name)).toHaveLength(
          DEFAULT_PERMISSIONS.length,
        );
      } else {
        expect(permissionNamesOf(definition.name)).toEqual(
          definitionOf(definition.name),
        );
      }
    }
  });

  it('arranque sobre roles ya sembrados: agrega los permisos que faltan y quita los que sobran', async () => {
    await service.onModuleInit();
    // Estado viejo (pre-P5): Administrador con roles.create y logs.read, y
    // sin condominium.view-all.
    const admin = roleNamed('Administrador');
    const legacyExtras = permissions.filter((p) =>
      ['roles.create', 'logs.read'].includes(p.name),
    );
    admin.permissions = [
      ...admin.permissions.filter(
        (p) => p.name !== CONDOMINIUM_VIEW_ALL_PERMISSION,
      ),
      ...legacyExtras,
    ];

    const results = await service.syncSystemRoles();

    expect(results.find((r) => r.role === 'Administrador')).toEqual({
      role: 'Administrador',
      added: [CONDOMINIUM_VIEW_ALL_PERMISSION],
      removed: ['roles.create', 'logs.read'],
    });
    expect(permissionNamesOf('Administrador')).toEqual(
      definitionOf('Administrador'),
    );
  });

  it('un permiso nuevo llega al Super Administrador ya sembrado', async () => {
    await service.onModuleInit();
    permissions.push({ id: 'perm-new', name: 'gardens.read' } as Permission);

    await service.syncSystemRoles();

    expect(permissionNamesOf('Super Administrador')).toContain('gardens.read');
  });

  it('es idempotente: sin diferencias no guarda nada', async () => {
    await service.onModuleInit();
    saves = 0;

    const results = await service.syncSystemRoles();

    expect(saves).toBe(0);
    expect(
      results.every((r) => r.added.length === 0 && r.removed.length === 0),
    ).toBe(true);
  });
});

describe('DEFAULT_ROLES final (Fase 4 · P5)', () => {
  const permissionsOf = (name: string): string[] =>
    DEFAULT_ROLES.find((role) => role.name === name)?.permissions ?? [];
  const ROLE_MUTATIONS = [
    'roles.create',
    'roles.update',
    'roles.delete',
    'roles.assign-permissions',
  ];

  it('condominium.view-all existe como permiso de sistema', () => {
    expect(DEFAULT_PERMISSIONS.map((p) => p.name)).toContain(
      CONDOMINIUM_VIEW_ALL_PERMISSION,
    );
  });

  it.each(['Administrador', 'Conserje', 'Seguridad'])(
    '%s tiene condominium.view-all',
    (name) => {
      expect(permissionsOf(name)).toContain(CONDOMINIUM_VIEW_ALL_PERMISSION);
    },
  );

  it('Residente NO tiene condominium.view-all', () => {
    expect(permissionsOf('Residente')).not.toContain(
      CONDOMINIUM_VIEW_ALL_PERMISSION,
    );
  });

  it.each(['Administrador', 'Desarrollador'])(
    '%s no muta roles ni permisos (solo los lee)',
    (name) => {
      for (const permission of [
        ...ROLE_MUTATIONS,
        'permissions.create',
        'permissions.update',
        'permissions.delete',
      ]) {
        expect(permissionsOf(name)).not.toContain(permission);
      }
      expect(permissionsOf(name)).toEqual(
        expect.arrayContaining(['roles.read', 'permissions.read']),
      );
    },
  );

  it('logs.read no lo tiene ningún rol de sistema que no sea el Super Administrador', () => {
    for (const role of DEFAULT_ROLES) {
      expect(role.permissions).not.toContain('logs.read');
    }
  });

  it('ningún rol de condominio tiene permisos platform.*', () => {
    for (const role of DEFAULT_ROLES) {
      expect(role.permissions.some((p) => p.startsWith('platform.'))).toBe(
        false,
      );
    }
  });

  it('cada permiso referenciado por un rol existe en DEFAULT_PERMISSIONS', () => {
    const known = new Set(DEFAULT_PERMISSIONS.map((p) => p.name));
    for (const role of DEFAULT_ROLES) {
      for (const permission of role.permissions) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });
});
