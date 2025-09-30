import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let jwtService: jest.Mocked<JwtService>;

  const mockExecutionContext = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn(),
    }),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const mockJwtService = {
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    jwtService = module.get(JwtService);
    guard = new AuthGuard(jwtService);

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
        headers: {},
      };
      
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);
    });

    it('should return true when valid token is provided', async () => {
      // Arrange
      const validToken = 'valid.jwt.token';
      const payload = { id: '1', email: 'test@example.com' };
      
      mockRequest.headers.authorization = `Bearer ${validToken}`;
      jwtService.verifyAsync.mockResolvedValue(payload);

      // Act
      const result = await guard.canActivate(mockExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(validToken);
      expect(mockRequest.user).toEqual(payload);
    });

    it('should throw UnauthorizedException when no authorization header is provided', async () => {
      // Arrange
      mockRequest.headers = {}; // No authorization header

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when authorization header is malformed', async () => {
      // Arrange
      mockRequest.headers.authorization = 'InvalidFormat token';

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when only "Bearer" is provided without token', async () => {
      // Arrange
      mockRequest.headers.authorization = 'Bearer';

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when authorization header is empty', async () => {
      // Arrange
      mockRequest.headers.authorization = '';

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when token verification fails', async () => {
      // Arrange
      const invalidToken = 'invalid.jwt.token';
      mockRequest.headers.authorization = `Bearer ${invalidToken}`;
      jwtService.verifyAsync.mockRejectedValue(new Error('Token verification failed'));

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Error validando el token')
      );
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(invalidToken);
      expect(mockRequest.user).toBeUndefined();
    });

    it('should throw UnauthorizedException when token is expired', async () => {
      // Arrange
      const expiredToken = 'expired.jwt.token';
      mockRequest.headers.authorization = `Bearer ${expiredToken}`;
      jwtService.verifyAsync.mockRejectedValue(new Error('Token expired'));

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(
        new UnauthorizedException('Error validando el token')
      );
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(expiredToken);
    });

    it('should handle different token formats correctly', async () => {
      // Arrange - Test with multiple spaces
      const validToken = 'valid.jwt.token';
      const payload = { id: '1' };
      
      mockRequest.headers.authorization = `Bearer  ${validToken}`; // Extra space
      jwtService.verifyAsync.mockResolvedValue(payload);

      // Act
      const result = await guard.canActivate(mockExecutionContext);

      // Assert
      expect(result).toBe(true);
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(validToken);
    });

    it('should not accept tokens with different scheme', async () => {
      // Arrange
      mockRequest.headers.authorization = 'Basic sometoken';

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('should handle case-sensitive Bearer scheme', async () => {
      // Arrange
      mockRequest.headers.authorization = 'bearer valid.token'; // lowercase

      // Act & Assert
      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });
  });

  describe('extractTokenFromHeader', () => {
    it('should extract token correctly from valid Bearer authorization header', () => {
      // Arrange
      const request = {
        headers: {
          authorization: 'Bearer valid.jwt.token'
        }
      };

      // Act
      const token = (guard as any).extractTokenFromHeader(request);

      // Assert
      expect(token).toBe('valid.jwt.token');
    });

    it('should return undefined when no authorization header exists', () => {
      // Arrange
      const request = {
        headers: {}
      };

      // Act
      const token = (guard as any).extractTokenFromHeader(request);

      // Assert
      expect(token).toBeUndefined();
    });

    it('should return undefined when authorization header format is incorrect', () => {
      // Arrange
      const request = {
        headers: {
          authorization: 'InvalidFormat token'
        }
      };

      // Act
      const token = (guard as any).extractTokenFromHeader(request);

      // Assert
      expect(token).toBeUndefined();
    });
  });
});
