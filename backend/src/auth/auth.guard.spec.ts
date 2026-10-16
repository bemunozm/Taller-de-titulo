import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { AuthGuard } from './auth.guard';
import { User } from '../users/entities/user.entity';
import { fromNodeHeaders } from 'better-auth/node';

jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn().mockReturnValue('mock-headers'),
}));

describe('AuthGuard', () => {
  let guard: AuthGuard;
  // Mock suelto (no un método del repositorio): evita unbound-method en
  // los `expect(...)`.
  const findOne = jest.fn();
  let reflector: jest.Mocked<Reflector>;
  let betterAuthService: { api: { getSession: jest.Mock } };

  const appUser = {
    id: 'user-1',
    email: 'test@example.com',
    roles: [{ name: 'Admin', permissions: [{ name: 'users.read' }] }],
  } as unknown as User;

  const mockExecutionContext = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn(),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as jest.Mocked<Reflector>;
    betterAuthService = { api: { getSession: jest.fn() } };

    guard = new AuthGuard(
      { findOne } as unknown as Repository<User>,
      reflector,
      betterAuthService as never,
    );

    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
  });

  const mockRequest = (overrides: Record<string, unknown> = {}) => {
    const request: { headers: Record<string, string>; user?: User } & Record<
      string,
      unknown
    > = {
      headers: {},
      ...overrides,
    };
    (
      mockExecutionContext.switchToHttp().getRequest as jest.Mock
    ).mockReturnValue(request);
    return request;
  };

  describe('rutas públicas', () => {
    it('permite el acceso sin validar sesión', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest();

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(betterAuthService.api.getSession).not.toHaveBeenCalled();
    });
  });

  describe('sesión de better-auth', () => {
    it('autentica con la cookie de sesión y carga el User de la app', async () => {
      const request = mockRequest({
        headers: { cookie: 'better-auth.session=abc' },
      });
      betterAuthService.api.getSession.mockResolvedValue({
        user: { id: 'user-1' },
      });
      findOne.mockResolvedValue(appUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(fromNodeHeaders).toHaveBeenCalledWith(request.headers);
      expect(findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles', 'roles.permissions', 'family'],
      });
      expect(request.user).toEqual(appUser);
    });

    it('ignora un Authorization Bearer presente cuando hay sesión válida', async () => {
      mockRequest({
        headers: {
          cookie: 'better-auth.session=abc',
          authorization: 'Bearer some.jwt',
        },
      });
      betterAuthService.api.getSession.mockResolvedValue({
        user: { id: 'user-1' },
      });
      findOne.mockResolvedValue(appUser);

      await expect(guard.canActivate(mockExecutionContext)).resolves.toBe(true);
    });
  });

  describe('JWT Bearer legacy (retirado)', () => {
    it('un Bearer JWT ya NO autentica cuando no hay sesión de better-auth', async () => {
      mockRequest({ headers: { authorization: 'Bearer valid.jwt.token' } });
      betterAuthService.api.getSession.mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(findOne).not.toHaveBeenCalled();
    });

    it('un Bearer JWT tampoco autentica si consultar la sesión lanza', async () => {
      mockRequest({ headers: { authorization: 'Bearer valid.jwt.token' } });
      betterAuthService.api.getSession.mockRejectedValue(new Error('boom'));

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(findOne).not.toHaveBeenCalled();
    });
  });

  describe('sin credenciales', () => {
    it('lanza UnauthorizedException cuando no hay sesión', async () => {
      mockRequest();
      betterAuthService.api.getSession.mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('usuario no encontrado tras resolver identidad', () => {
    it('lanza UnauthorizedException si el userId resuelto no existe en la BD', async () => {
      mockRequest({ headers: { cookie: 'better-auth.session=abc' } });
      betterAuthService.api.getSession.mockResolvedValue({
        user: { id: 'user-1' },
      });
      findOne.mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
