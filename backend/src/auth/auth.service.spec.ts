import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokensService } from '../tokens/tokens.service';
import { AuthEmailService } from './services/auth-email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ConfirmAccountDto } from './dto/confirm-account.dto';
import { RequestConfirmationCodeDto } from './dto/request-confirmation-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { UpdatePasswordWithTokenDto } from './dto/update-password-with-token.dto';
import { User } from '../users/entities/user.entity';
import { Token } from '../tokens/entities/token.entity';
import * as authUtil from './utils/auth.util';
import * as tokenUtil from './utils/token.util';

// Mock de las utilidades
jest.mock('./utils/auth.util');
jest.mock('./utils/token.util');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let tokensService: jest.Mocked<TokensService>;
  let jwtService: jest.Mocked<JwtService>;
  let authEmailService: jest.Mocked<AuthEmailService>;

  const mockUser: Partial<User> = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashedPassword',
    confirmed: false,
    rut: '12345678-9',
    phone: '123456789',
    age: 25,
    roles: []
  };

  const mockToken: Partial<Token> = {
    id: '1',
    token: '123456',
    userId: '1',
    user: mockUser as User
  };

  beforeEach(async () => {
    const mockUsersService = {
      findByEmail: jest.fn(),
      findByEmailWithPassword: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    const mockTokensService = {
      create: jest.fn(),
      findByTokenWithUser: jest.fn(),
      findByToken: jest.fn(),
      remove: jest.fn(),
    };

    const mockJwtService = {
      sign: jest.fn(),
      verifyAsync: jest.fn(),
    };

    const mockAuthEmailService = {
      sendConfirmationEmail: jest.fn(),
      sendWelcomeEmail: jest.fn(),
      sendPasswordResetToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: TokensService,
          useValue: mockTokensService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: AuthEmailService,
          useValue: mockAuthEmailService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    tokensService = module.get(TokensService);
    jwtService = module.get(JwtService);
    authEmailService = module.get(AuthEmailService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      password_confirmation: 'password123',
      name: 'Test User',
      rut: '12345678-9',
      phone: '123456789',
      age: 25,
    };

    it('should register a new user successfully', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);
      (authUtil.hashPassword as jest.Mock).mockResolvedValue('hashedPassword');
      (tokenUtil.generateToken as jest.Mock).mockReturnValue('123456');
      usersService.create.mockResolvedValue(mockUser as User);
      tokensService.create.mockResolvedValue(mockToken as Token);
      authEmailService.sendConfirmationEmail.mockResolvedValue(undefined);

      // Act
      const result = await service.register(registerDto);

      // Assert
      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(authUtil.hashPassword).toHaveBeenCalledWith('password123');
      expect(usersService.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'hashedPassword',
        name: 'Test User',
        rut: '12345678-9',
        phone: '123456789',
        age: 25,
      });
      expect(tokenUtil.generateToken).toHaveBeenCalled();
      expect(tokensService.create).toHaveBeenCalledWith({
        token: '123456',
        userId: '1',
      });
      expect(authEmailService.sendConfirmationEmail).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
        token: '123456',
      });
      expect(result).toBe('Cuenta creada exitosamente. Revisa tu email para confirmarla y activar todas las funcionalidades.');
    });

    it('should throw BadRequestException when user already exists', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(mockUser as User);

      // Act & Assert
      await expect(service.register(registerDto)).rejects.toThrow(
        new BadRequestException('El Usuario ya está registrado')
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when passwords do not match', async () => {
      // Arrange
      const invalidRegisterDto = {
        ...registerDto,
        password_confirmation: 'differentPassword',
      };
      usersService.findByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(service.register(invalidRegisterDto)).rejects.toThrow(
        new BadRequestException('Las contraseñas no coinciden')
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when unexpected error occurs', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);
      (authUtil.hashPassword as jest.Mock).mockResolvedValue('hashedPassword');
      usersService.create.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.register(registerDto)).rejects.toThrow(
        new InternalServerErrorException('Error al registrar el usuario')
      );
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should login successfully with valid credentials', async () => {
      // Arrange
      const confirmedUser = { ...mockUser, confirmed: true };
      usersService.findByEmailWithPassword.mockResolvedValue(confirmedUser as User);
      (authUtil.checkPassword as jest.Mock).mockResolvedValue(true);
      jwtService.sign.mockReturnValue('jwt-token');

      // Act
      const result = await service.login(loginDto);

      // Assert
      expect(usersService.findByEmailWithPassword).toHaveBeenCalledWith('test@example.com');
      expect(authUtil.checkPassword).toHaveBeenCalledWith('password123', 'hashedPassword');
      expect(jwtService.sign).toHaveBeenCalledWith({ id: '1' });
      expect(result).toBe('jwt-token');
    });

    it('should throw UnauthorizedException when user does not exist', async () => {
      // Arrange
      usersService.findByEmailWithPassword.mockResolvedValue(null);

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Usuario No Encontrado')
      );
    });

    it('should throw UnauthorizedException when user is not confirmed', async () => {
      // Arrange
      usersService.findByEmailWithPassword.mockResolvedValue(mockUser as User);
      (tokenUtil.generateToken as jest.Mock).mockReturnValue('123456');
      tokensService.create.mockResolvedValue(mockToken as Token);
      authEmailService.sendConfirmationEmail.mockResolvedValue(undefined);

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Tu cuenta no está confirmada. Hemos enviado un nuevo código de verificación a tu email.')
      );
      expect(tokenUtil.generateToken).toHaveBeenCalled();
      expect(tokensService.create).toHaveBeenCalledWith({
        token: '123456',
        userId: '1',
      });
      expect(authEmailService.sendConfirmationEmail).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
        token: '123456',
      });
    });

    it('should throw UnauthorizedException when password is incorrect', async () => {
      // Arrange
      const confirmedUser = { ...mockUser, confirmed: true };
      usersService.findByEmailWithPassword.mockResolvedValue(confirmedUser as User);
      (authUtil.checkPassword as jest.Mock).mockResolvedValue(false);

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Password Incorrecto')
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when unexpected error occurs during login', async () => {
      // Arrange
      usersService.findByEmailWithPassword.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.login(loginDto)).rejects.toThrow(
        new InternalServerErrorException('Error al procesar el login')
      );
    });
  });

  describe('confirmAccount', () => {
    const confirmAccountDto: ConfirmAccountDto = {
      token: '123456',
    };

    it('should confirm account successfully', async () => {
      // Arrange
      tokensService.findByTokenWithUser.mockResolvedValue(mockToken as Token);
      usersService.save.mockResolvedValue(mockUser as User);
      tokensService.remove.mockResolvedValue(mockToken as Token);
      authEmailService.sendWelcomeEmail.mockResolvedValue(undefined);

      // Act
      const result = await service.confirmAccount(confirmAccountDto);

      // Assert
      expect(tokensService.findByTokenWithUser).toHaveBeenCalledWith('123456');
      expect(usersService.save).toHaveBeenCalledWith(
        expect.objectContaining({ confirmed: true })
      );
      expect(tokensService.remove).toHaveBeenCalledWith('1');
      expect(authEmailService.sendWelcomeEmail).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
      });
      expect(result).toBe('¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.');
    });

    it('should throw NotFoundException when token is invalid', async () => {
      // Arrange
      tokensService.findByTokenWithUser.mockResolvedValue(undefined as any);

      // Act & Assert
      await expect(service.confirmAccount(confirmAccountDto)).rejects.toThrow(
        new NotFoundException('Token no válido')
      );
      expect(usersService.save).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when unexpected error occurs', async () => {
      // Arrange
      tokensService.findByTokenWithUser.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.confirmAccount(confirmAccountDto)).rejects.toThrow(
        new InternalServerErrorException('Error al confirmar la cuenta')
      );
    });
  });

  describe('requestConfirmationCode', () => {
    const requestConfirmationCodeDto: RequestConfirmationCodeDto = {
      email: 'test@example.com',
    };

    it('should request confirmation code successfully', async () => {
      // Arrange
      const unconfirmedUser = { ...mockUser, confirmed: false };
      usersService.findByEmail.mockResolvedValue(unconfirmedUser as User);
      (tokenUtil.generateToken as jest.Mock).mockReturnValue('123456');
      tokensService.create.mockResolvedValue(mockToken as Token);
      authEmailService.sendConfirmationEmail.mockResolvedValue(undefined);

      // Act
      const result = await service.requestConfirmationCode(requestConfirmationCodeDto);

      // Assert
      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(tokenUtil.generateToken).toHaveBeenCalled();
      expect(tokensService.create).toHaveBeenCalledWith({
        token: '123456',
        userId: '1',
      });
      expect(authEmailService.sendConfirmationEmail).toHaveBeenCalledWith({
        email: 'test@example.com',
        name: 'Test User',
        token: '123456',
      });
      expect(result).toBe('Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.');
    });

    it('should throw NotFoundException when user does not exist', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(service.requestConfirmationCode(requestConfirmationCodeDto)).rejects.toThrow(
        new NotFoundException('El Usuario no existe')
      );
    });

    it('should throw BadRequestException when user is already confirmed', async () => {
      // Arrange
      const confirmedUser = { ...mockUser, confirmed: true };
      usersService.findByEmail.mockResolvedValue(confirmedUser as User);

      // Act & Assert
      await expect(service.requestConfirmationCode(requestConfirmationCodeDto)).rejects.toThrow(
        new BadRequestException('El Usuario ya está confirmado')
      );
    });

    it('should throw InternalServerErrorException when unexpected error occurs', async () => {
      // Arrange
      usersService.findByEmail.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(service.requestConfirmationCode(requestConfirmationCodeDto)).rejects.toThrow(
        new InternalServerErrorException('Error al solicitar código de confirmación')
      );
    });
  });

  describe('forgotPassword', () => {
    const forgotPasswordDto: ForgotPasswordDto = {
      email: 'test@example.com',
    };

    it('should send password reset email successfully', async () => {
      // Arrange
      usersService.findByEmail.mockResolvedValue(mockUser as User);
      (tokenUtil.generateToken as jest.Mock).mockReturnValue('123456');
      tokensService.create.mockResolvedValue(mockToken as Token);
      authEmailService.sendPasswordResetToken.mockResolvedValue(undefined);

      // Act
      const result = await service.forgotPassword(forgotPasswordDto);

      // Assert
      expect(usersService.findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(tokenUtil.generateToken).toHaveBeenCalled();
      expect(tokensService.create).toHaveBeenCalledWith({
        token: '123456',
        userId: '1',
      });
      expect(result).toContain('Instrucciones de recuperación enviadas');
    });
  });
});
