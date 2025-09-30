import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthEmailService } from './services/auth-email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ConfirmAccountDto } from './dto/confirm-account.dto';
import { RequestConfirmationCodeDto } from './dto/request-confirmation-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { UpdatePasswordWithTokenDto } from './dto/update-password-with-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateCurrentUserPasswordDto } from './dto/update-current-user-password.dto';
import { CheckPasswordDto } from './dto/check-password.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;
  let authEmailService: jest.Mocked<AuthEmailService>;

  const mockAuthService = {
    register: jest.fn(),
    confirmAccount: jest.fn(),
    login: jest.fn(),
    requestConfirmationCode: jest.fn(),
    forgotPassword: jest.fn(),
    validateToken: jest.fn(),
    updatePasswordWithToken: jest.fn(),
    user: jest.fn(),
    updateProfile: jest.fn(),
    updateCurrentUserPassword: jest.fn(),
    checkPassword: jest.fn(),
  };

  const mockAuthEmailService = {
    sendConfirmationEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: AuthEmailService,
          useValue: mockAuthEmailService,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
      ],
    })
    .overrideGuard(AuthGuard)
    .useValue({
      canActivate: jest.fn(() => true),
    })
    .compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
    authEmailService = module.get(AuthEmailService);

    // Reset all mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createAccount', () => {
    const registerDto: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      password_confirmation: 'password123',
      name: 'Test User',
      rut: '12345678-9',
      phone: '123456789',
      age: 25,
    };

    it('should create account successfully with valid data', async () => {
      // Arrange
      const expectedResult = 'Cuenta creada exitosamente. Revisa tu email para confirmarla y activar todas las funcionalidades.';
      authService.register.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.createAccount(registerDto);

      // Assert
      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(result).toBe(expectedResult);
    });

    it('should throw BadRequestException when user already exists', async () => {
      // Arrange
      authService.register.mockRejectedValue(new BadRequestException('El Usuario ya está registrado'));

      // Act & Assert
      await expect(controller.createAccount(registerDto)).rejects.toThrow(BadRequestException);
      expect(authService.register).toHaveBeenCalledWith(registerDto);
    });

    it('should throw BadRequestException when passwords do not match', async () => {
      // Arrange
      const invalidRegisterDto = { ...registerDto, password_confirmation: 'differentPassword' };
      authService.register.mockRejectedValue(new BadRequestException('Las contraseñas no coinciden'));

      // Act & Assert
      await expect(controller.createAccount(invalidRegisterDto)).rejects.toThrow(BadRequestException);
      expect(authService.register).toHaveBeenCalledWith(invalidRegisterDto);
    });
  });

  describe('confirmAccount', () => {
    const confirmAccountDto: ConfirmAccountDto = {
      token: '123456',
    };

    it('should confirm account successfully with valid token', async () => {
      // Arrange
      const expectedResult = '¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.';
      authService.confirmAccount.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.confirmAccount(confirmAccountDto);

      // Assert
      expect(authService.confirmAccount).toHaveBeenCalledWith(confirmAccountDto);
      expect(result).toBe(expectedResult);
    });

    it('should throw NotFoundException when token is invalid', async () => {
      // Arrange
      authService.confirmAccount.mockRejectedValue(new NotFoundException('Token no válido'));

      // Act & Assert
      await expect(controller.confirmAccount(confirmAccountDto)).rejects.toThrow(NotFoundException);
      expect(authService.confirmAccount).toHaveBeenCalledWith(confirmAccountDto);
    });

    it('should throw NotFoundException when token is expired', async () => {
      // Arrange
      authService.confirmAccount.mockRejectedValue(new NotFoundException('Token no válido'));

      // Act & Assert
      await expect(controller.confirmAccount({ token: 'expired-token' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should login successfully with valid credentials', async () => {
      // Arrange
      const expectedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
      authService.login.mockResolvedValue(expectedToken);

      // Act
      const result = await controller.login(loginDto);

      // Assert
      expect(authService.login).toHaveBeenCalledWith(loginDto);
      expect(result).toBe(expectedToken);
    });

    it('should throw UnauthorizedException with invalid credentials', async () => {
      // Arrange
      const invalidLoginDto = { email: 'test@example.com', password: 'wrongpassword' };
      authService.login.mockRejectedValue(new UnauthorizedException('Password Incorrecto'));

      // Act & Assert
      await expect(controller.login(invalidLoginDto)).rejects.toThrow(UnauthorizedException);
      expect(authService.login).toHaveBeenCalledWith(invalidLoginDto);
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      // Arrange
      const nonExistentUserDto = { email: 'nonexistent@example.com', password: 'password123' };
      authService.login.mockRejectedValue(new UnauthorizedException('Usuario No Encontrado'));

      // Act & Assert
      await expect(controller.login(nonExistentUserDto)).rejects.toThrow(UnauthorizedException);
      expect(authService.login).toHaveBeenCalledWith(nonExistentUserDto);
    });

    it('should throw UnauthorizedException when account is not confirmed', async () => {
      // Arrange
      authService.login.mockRejectedValue(
        new UnauthorizedException('Tu cuenta no está confirmada. Hemos enviado un nuevo código de verificación a tu email.')
      );

      // Act & Assert
      await expect(controller.login(loginDto)).rejects.toThrow(UnauthorizedException);
      expect(authService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should handle malformed email addresses', async () => {
      // Arrange
      const malformedEmailDto = { email: 'invalid-email', password: 'password123' };
      authService.login.mockRejectedValue(new UnauthorizedException('Usuario No Encontrado'));

      // Act & Assert
      await expect(controller.login(malformedEmailDto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('requestConfirmationCode', () => {
    const requestConfirmationCodeDto: RequestConfirmationCodeDto = {
      email: 'test@example.com',
    };

    it('should request confirmation code successfully', async () => {
      // Arrange
      const expectedResult = 'Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.';
      authService.requestConfirmationCode.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.requestConfirmationCode(requestConfirmationCodeDto);

      // Assert
      expect(authService.requestConfirmationCode).toHaveBeenCalledWith(requestConfirmationCodeDto);
      expect(result).toBe(expectedResult);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      // Arrange
      authService.requestConfirmationCode.mockRejectedValue(new NotFoundException('El Usuario no existe'));

      // Act & Assert
      await expect(controller.requestConfirmationCode(requestConfirmationCodeDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user is already confirmed', async () => {
      // Arrange
      authService.requestConfirmationCode.mockRejectedValue(new BadRequestException('El Usuario ya está confirmado'));

      // Act & Assert
      await expect(controller.requestConfirmationCode(requestConfirmationCodeDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('forgotPassword', () => {
    const forgotPasswordDto: ForgotPasswordDto = {
      email: 'test@example.com',
    };

    it('should send password reset email successfully', async () => {
      // Arrange
      const expectedResult = 'Hemos enviado un email con las instrucciones para restablecer tu contraseña.';
      authService.forgotPassword.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.forgotPassword(forgotPasswordDto);

      // Assert
      expect(authService.forgotPassword).toHaveBeenCalledWith(forgotPasswordDto);
      expect(result).toBe(expectedResult);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      // Arrange
      authService.forgotPassword.mockRejectedValue(new NotFoundException('Usuario no encontrado'));

      // Act & Assert
      await expect(controller.forgotPassword(forgotPasswordDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('validateToken', () => {
    const validateTokenDto: ValidateTokenDto = {
      token: '123456',
    };

    it('should validate token successfully', async () => {
      // Arrange
      const expectedResult = 'Código verificado correctamente. Ahora puedes establecer tu nueva contraseña.';
      authService.validateToken.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.validateToken(validateTokenDto);

      // Assert
      expect(authService.validateToken).toHaveBeenCalledWith(validateTokenDto);
      expect(result).toBe(expectedResult);
    });

    it('should return invalid when token is not found', async () => {
      // Arrange
      authService.validateToken.mockRejectedValue(new NotFoundException('Token no válido'));

      // Act & Assert
      await expect(controller.validateToken(validateTokenDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePasswordWithToken', () => {
    const updatePasswordDto: UpdatePasswordWithTokenDto = {
      token: '123456',
      password: 'newPassword123',
    };

    it('should update password successfully with valid token', async () => {
      // Arrange
      const expectedResult = '¡Contraseña actualizada exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.';
      authService.updatePasswordWithToken.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.updatePasswordWithToken(updatePasswordDto);

      // Assert
      expect(authService.updatePasswordWithToken).toHaveBeenCalledWith(updatePasswordDto);
      expect(result).toBe(expectedResult);
    });

    it('should throw NotFoundException when token is invalid', async () => {
      // Arrange
      authService.updatePasswordWithToken.mockRejectedValue(new NotFoundException('Token no válido'));

      // Act & Assert
      await expect(controller.updatePasswordWithToken(updatePasswordDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkPassword', () => {
    const checkPasswordDto: CheckPasswordDto = {
      password: 'currentPassword123',
    };

    const mockRequest = {
      user: { id: '1' },
    };

    it('should check password successfully when password is correct', async () => {
      // Arrange
      const expectedResult = 'Password Correcto';
      authService.checkPassword.mockResolvedValue(expectedResult);

      // Act
      const result = await controller.checkPassword(mockRequest, checkPasswordDto);

      // Assert
      expect(authService.checkPassword).toHaveBeenCalledWith('1', checkPasswordDto);
      expect(result).toBe(expectedResult);
    });

    it('should throw BadRequestException when password is incorrect', async () => {
      // Arrange
      authService.checkPassword.mockRejectedValue(new BadRequestException('Password Incorrecto'));

      // Act & Assert
      await expect(controller.checkPassword(mockRequest, checkPasswordDto)).rejects.toThrow(BadRequestException);
      expect(authService.checkPassword).toHaveBeenCalledWith('1', checkPasswordDto);
    });
  });
});
