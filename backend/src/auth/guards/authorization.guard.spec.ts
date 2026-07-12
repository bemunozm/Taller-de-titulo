import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthorizationGuard } from './authorization.guard';
import { User } from '../../users/entities/user.entity';

/**
 * Reescrito en Fase 1, Bloque A2t (arreglo de infra de tests): el guard NO
 * llama a `userRepository.findOne` desde la tarea #17 de Fase 0 (lee
 * `request.user` directo, poblado por `AuthGuard` — ver su docstring). Los
 * 7 tests que mockeaban `userRepository.findOne(...)` para "armar" el
 * usuario quedaron desalineados desde entonces: el guard nunca invoca ese
 * mock, así que `request.user` llegaba sin `roles` a `canActivate` y varias
 * aserciones de `result === true` fallaban.
 *
 * Ahora se mockea `request.user` directamente (la forma real que ve el
 * guard en producción). `userRepository` se sigue proveyendo en el módulo
 * de test SOLO para satisfacer la inyección por constructor — el guard no
 * lo usa y ningún test hace aserciones sobre él.
 */
describe('AuthorizationGuard', () => {
  let guard: AuthorizationGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;

  function makeContext(user: unknown): ExecutionContext {
    const request = { user };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get(AuthorizationGuard);
    reflector = module.get(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  /** Encadena los dos `getAllAndOverride` que hace el guard: roles, luego permisos. */
  function stubRequirements(
    roles: string[] | undefined,
    permissions: string[] | undefined,
  ) {
    reflector.getAllAndOverride
      .mockReturnValueOnce(roles)
      .mockReturnValueOnce(permissions);
  }

  describe('canActivate', () => {
    it('permite el acceso cuando no se requieren roles ni permisos', async () => {
      stubRequirements(undefined, undefined);
      const ctx = makeContext(undefined); // ni siquiera hace falta un usuario

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('lanza ForbiddenException("Usuario no autenticado") si no hay request.user', async () => {
      stubRequirements(['admin'], undefined);
      const ctx = makeContext(null);

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('Usuario no autenticado'),
      );
    });

    it('lanza ForbiddenException("Usuario sin roles asignados") si el usuario no tiene roles', async () => {
      stubRequirements(undefined, ['users.read']);
      const ctx = makeContext({ id: 'user-1', roles: [] });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('Usuario sin roles asignados'),
      );
    });

    it('permite el acceso cuando el usuario tiene el rol requerido', async () => {
      stubRequirements(['admin'], undefined);
      const ctx = makeContext({
        id: 'user-1',
        roles: [{ name: 'admin', permissions: [] }],
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('deniega cuando el usuario no tiene el rol requerido', async () => {
      stubRequirements(['admin'], undefined);
      const ctx = makeContext({
        id: 'user-1',
        roles: [{ name: 'user', permissions: [] }],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('Acceso denegado. Se requiere: Roles: admin'),
      );
    });

    it('permite el acceso cuando el usuario tiene el permiso requerido', async () => {
      stubRequirements(undefined, ['users.read']);
      const ctx = makeContext({
        id: 'user-1',
        roles: [{ name: 'user', permissions: [{ name: 'users.read' }] }],
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('deniega cuando el usuario no tiene el permiso requerido', async () => {
      stubRequirements(undefined, ['users.write']);
      const ctx = makeContext({
        id: 'user-1',
        roles: [{ name: 'user', permissions: [{ name: 'users.read' }] }],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException(
          'Acceso denegado. Se requiere: Permisos: users.write',
        ),
      );
    });

    it('permite el acceso con rol O permiso — basta con uno de los dos', async () => {
      stubRequirements(['admin'], ['users.write']);
      const ctx = makeContext({
        id: 'user-1',
        roles: [{ name: 'user', permissions: [{ name: 'users.write' }] }], // no tiene el rol, sí el permiso
      });

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('deniega con el mensaje combinado cuando no tiene ni los roles ni los permisos', async () => {
      stubRequirements(
        ['admin', 'moderator'],
        ['users.manage', 'users.delete'],
      );
      const ctx = makeContext({
        id: 'user-2',
        roles: [{ name: 'guest', permissions: [] }],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException(
          'Acceso denegado. Se requiere: Roles: admin, moderator o Permisos: users.manage, users.delete',
        ),
      );
    });

    /**
     * Fase 1, Bloque A2a: `hasAnyPermission` (auth/utils/permissions.util.ts)
     * se corrigió para que `required: []` DENIEGUE (antes devolvía `true`
     * porque `[].some(...)` es `false` pero el bug estaba en el guard viejo
     * tratando `[]` como "sin restricción"). `@RequirePermissions()` sin
     * argumentos produce `[]` (truthy en JS) — el guard NO lo trata igual
     * que `undefined` (esa rama de "sin restricción" solo dispara cuando el
     * decorador no se usó), así que debe seguir exigiendo autorización real.
     */
    it('deniega con @RequirePermissions() vacío — [] no es "sin restricción"', async () => {
      stubRequirements(undefined, []);
      const ctx = makeContext({
        id: 'user-1',
        roles: [{ name: 'user', permissions: [{ name: 'users.read' }] }],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });
});
