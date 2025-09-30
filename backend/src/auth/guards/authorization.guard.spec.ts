import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthorizationGuard } from './authorization.guard';
import { User } from '../../users/entities/user.entity';

describe('AuthorizationGuard', () => {
  let guard: AuthorizationGuard;
  let reflector: jest.Mocked<Reflector>;
  let userRepository: jest.Mocked<Repository<User>>;

  const mockExecutionContext = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn(),
    }),
    getHandler: jest.fn(),
    getClass: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    const mockUserRepository = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthorizationGuard,
        {
          provide: Reflector,
          useValue: mockReflector,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
      ],
    }).compile();

    guard = module.get<AuthorizationGuard>(AuthorizationGuard);
    reflector = module.get(Reflector);
    userRepository = module.get(getRepositoryToken(User));

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    let mockRequest: any;

    beforeEach(() => {
      mockRequest = {
        user: { id: 'user-1' },
      };
      
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);
    });

    it('should allow access when no roles or permissions are required', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No roles required
      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No permissions required

      // Act
      const result = await guard.canActivate(mockExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when user is not authenticated', async () => {
      // Arrange
      mockRequest.user = null;
      reflector.getAllAndOverride.mockReturnValueOnce(['admin']); // Roles required

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('Usuario no autenticado')
      );
    });

    it('should throw ForbiddenException when user has no roles', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValueOnce(['admin']); // Roles required
      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No permissions required
      
      const userWithNoRoles = {
        id: 'user-1',
        roles: [],
      };
      userRepository.findOne.mockResolvedValue(userWithNoRoles as any);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('Usuario sin roles asignados')
      );
    });

    it('should allow access when user has required role', async () => {
      // Arrange
      const userWithAdminRole = {
        id: 'user-1',
        roles: [{ name: 'admin', permissions: [] }],
      };

      reflector.getAllAndOverride.mockReturnValueOnce(['admin']); // Required roles
      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No permissions required
      userRepository.findOne.mockResolvedValue(userWithAdminRole as any);

      // Act
      const result = await guard.canActivate(mockExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        relations: ['roles', 'roles.permissions'],
      });
    });

    it('should deny access when user does not have required role', async () => {
      // Arrange
      const userWithUserRole = {
        id: 'user-1',
        roles: [{ name: 'user', permissions: [] }],
      };

      reflector.getAllAndOverride.mockReturnValueOnce(['admin']); // Required roles
      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No permissions required
      userRepository.findOne.mockResolvedValue(userWithUserRole as any);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('Acceso denegado. Se requiere: Roles: admin')
      );
    });

    it('should allow access when user has required permission', async () => {
      // Arrange
      const userWithPermission = {
        id: 'user-1',
        roles: [{ 
          name: 'user', 
          permissions: [{ name: 'read_users' }] 
        }],
      };

      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No roles required
      reflector.getAllAndOverride.mockReturnValueOnce(['read_users']); // Required permissions
      userRepository.findOne.mockResolvedValue(userWithPermission as any);

      // Act
      const result = await guard.canActivate(mockExecutionContext);

      // Assert
      expect(result).toBe(true);
    });

    it('should deny access when user does not have required permission', async () => {
      // Arrange
      const userWithWrongPermission = {
        id: 'user-1',
        roles: [{ 
          name: 'user', 
          permissions: [{ name: 'read_posts' }] 
        }],
      };

      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No roles required
      reflector.getAllAndOverride.mockReturnValueOnce(['write_users']); // Required permissions
      userRepository.findOne.mockResolvedValue(userWithWrongPermission as any);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('Acceso denegado. Se requiere: Permisos: write_users')
      );
    });

    it('should allow access with either required role OR permission', async () => {
      // Arrange
      const userWithOnlyPermission = {
        id: 'user-1',
        roles: [{ 
          name: 'user', // Not admin role
          permissions: [{ name: 'write_users' }] 
        }],
      };

      reflector.getAllAndOverride.mockReturnValueOnce(['admin']); // Required roles (don't have)
      reflector.getAllAndOverride.mockReturnValueOnce(['write_users']); // Required permissions (have)
      userRepository.findOne.mockResolvedValue(userWithOnlyPermission as any);

      // Act
      const result = await guard.canActivate(mockExecutionContext);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle scenarios where user without access tries to access protected resource', async () => {
      // Arrange - Escenario: Usuario sin permisos trata de acceder a recurso protegido
      const unauthorizedUser = {
        id: 'user-2',
        roles: [{ 
          name: 'guest', 
          permissions: [] 
        }],
      };

      reflector.getAllAndOverride.mockReturnValueOnce(['admin', 'moderator']); // Required roles
      reflector.getAllAndOverride.mockReturnValueOnce(['manage_users', 'delete_users']); // Required permissions
      userRepository.findOne.mockResolvedValue(unauthorizedUser as any);

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new ForbiddenException('Acceso denegado. Se requiere: Roles: admin, moderator o Permisos: manage_users, delete_users')
      );
    });

    it('should handle valid user with correct role accessing protected endpoint', async () => {
      // Arrange - Escenario: Usuario con rol correcto accede a endpoint protegido
      const validAdminUser = {
        id: 'user-3',
        roles: [{ 
          name: 'admin', 
          permissions: [
            { name: 'read_users' },
            { name: 'write_users' },
            { name: 'delete_users' }
          ] 
        }],
      };

      reflector.getAllAndOverride.mockReturnValueOnce(['admin']); // Required roles
      reflector.getAllAndOverride.mockReturnValueOnce(undefined); // No specific permissions required
      userRepository.findOne.mockResolvedValue(validAdminUser as any);

      // Act
      const result = await guard.canActivate(mockExecutionContext);

      // Assert
      expect(result).toBe(true);
    });
  });
});