import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
  let jwtService: jest.Mocked<JwtService>;
  let userRepository: jest.Mocked<Repository<User>>;
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
    jwtService = { verifyAsync: jest.fn() } as unknown as jest.Mocked<JwtService>;
    userRepository = { findOne: jest.fn() } as unknown as jest.Mocked<Repository<User>>;
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as jest.Mocked<Reflector>;
    betterAuthService = { api: { getSession: jest.fn() } };

    guard = new AuthGuard(
      jwtService,
      userRepository,
      reflector,
      betterAuthService as any,
    );

    jest.clearAllMocks();
    reflector.getAllAndOverride.mockReturnValue(false);
  });

  const mockRequest = (overrides: any = {}) => {
    const request = { headers: {}, ...overrides };
    (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(request);
    return request;
  };

  describe('rutas públicas', () => {
    it('permite el acceso sin validar sesión ni token', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest();

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(betterAuthService.api.getSession).not.toHaveBeenCalled();
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('camino primario: sesión de better-auth', () => {
    it('autentica con la cookie de sesión y carga el User de la app', async () => {
      const request = mockRequest({ headers: { cookie: 'better-auth.session=abc' } });
      betterAuthService.api.getSession.mockResolvedValue({ user: { id: 'user-1' } });
      userRepository.findOne.mockResolvedValue(appUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(fromNodeHeaders).toHaveBeenCalledWith(request.headers);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles', 'roles.permissions', 'family'],
      });
      expect(request.user).toEqual(appUser);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('no usa el fallback JWT si la sesión de better-auth ya resolvió un usuario', async () => {
      mockRequest({
        headers: { cookie: 'better-auth.session=abc', authorization: 'Bearer some.jwt' },
      });
      betterAuthService.api.getSession.mockResolvedValue({ user: { id: 'user-1' } });
      userRepository.findOne.mockResolvedValue(appUser);

      await guard.canActivate(mockExecutionContext);

      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('camino fallback: JWT Bearer legacy', () => {
    it('autentica con el JWT cuando no hay sesión de better-auth', async () => {
      const request = mockRequest({ headers: { authorization: 'Bearer valid.jwt.token' } });
      betterAuthService.api.getSession.mockResolvedValue(null);
      jwtService.verifyAsync.mockResolvedValue({ id: 'user-1' });
      userRepository.findOne.mockResolvedValue(appUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid.jwt.token');
      expect(request.user).toEqual(appUser);
    });

    it('también cae al JWT si consultar la sesión de better-auth lanza', async () => {
      const request = mockRequest({ headers: { authorization: 'Bearer valid.jwt.token' } });
      betterAuthService.api.getSession.mockRejectedValue(new Error('boom'));
      jwtService.verifyAsync.mockResolvedValue({ id: 'user-1' });
      userRepository.findOne.mockResolvedValue(appUser);

      const result = await guard.canActivate(mockExecutionContext);

      expect(result).toBe(true);
      expect(request.user).toEqual(appUser);
    });

    it('lanza UnauthorizedException si el JWT es inválido', async () => {
      mockRequest({ headers: { authorization: 'Bearer invalid.jwt.token' } });
      betterAuthService.api.getSession.mockResolvedValue(null);
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('sin credenciales', () => {
    it('lanza UnauthorizedException cuando no hay sesión ni token', async () => {
      mockRequest();
      betterAuthService.api.getSession.mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('lanza UnauthorizedException si el authorization header está malformado', async () => {
      mockRequest({ headers: { authorization: 'InvalidFormat token' } });
      betterAuthService.api.getSession.mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('usuario no encontrado tras resolver identidad', () => {
    it('lanza UnauthorizedException si el userId resuelto no existe en la BD', async () => {
      mockRequest({ headers: { cookie: 'better-auth.session=abc' } });
      betterAuthService.api.getSession.mockResolvedValue({ user: { id: 'user-1' } });
      userRepository.findOne.mockResolvedValue(null);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });
  });
});
