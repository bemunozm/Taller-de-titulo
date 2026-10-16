import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { DataExportService } from '../privacy/data-export.service';
import { AuthGuard } from './auth.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { VigiliaThrottlerGuard } from '../common/rate-limit/vigilia-throttler.guard';
import {
  AUDITABLE_KEY,
  type AuditableOptions,
} from '../audit/decorators/auditable.decorator';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';
import { ConfirmAccountDto } from './dto/confirm-account.dto';
import { RequestConfirmationCodeDto } from './dto/request-confirmation-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { UpdatePasswordWithTokenDto } from './dto/update-password-with-token.dto';
import { UpdateCurrentUserPasswordDto } from './dto/update-current-user-password.dto';
import { CheckPasswordDto } from './dto/check-password.dto';

describe('AuthController', () => {
  let controller: AuthController;

  const confirmAccount = jest.fn();
  const requestConfirmationCode = jest.fn();
  const forgotPassword = jest.fn();
  const validateToken = jest.fn();
  const updatePasswordWithToken = jest.fn();
  const updateCurrentUserPassword = jest.fn();
  const checkPassword = jest.fn();
  const revokeServiceApiKey = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            confirmAccount,
            requestConfirmationCode,
            forgotPassword,
            validateToken,
            updatePasswordWithToken,
            updateProfile: jest.fn(),
            updateCurrentUserPassword,
            checkPassword,
            revokeServiceApiKey,
          },
        },
        // Fase 4 · P7.R: `GET /auth/me/data-export` (privacy/data-export.http.spec.ts).
        { provide: DataExportService, useValue: { exportForUser: jest.fn() } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(AuthorizationGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      // Fase 4 · P4.B: `@RateLimit` (el throttling real se prueba en
      // auth-rate-limit.spec.ts).
      .overrideGuard(VigiliaThrottlerGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<AuthController>(AuthController);
    jest.clearAllMocks();
  });

  /** Request de una sesión de better-auth (cookie) con un header de IP falso. */
  function sessionRequest(): Request {
    return {
      headers: {
        cookie: 'better-auth.session_token=abc',
        'x-forwarded-for': '6.6.6.6',
      },
      ip: '10.0.0.7',
      user: { id: '1' },
    } as unknown as Request;
  }

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('confirmAccount', () => {
    const dto: ConfirmAccountDto = { token: '123456' };

    it('should confirm account successfully with valid token', async () => {
      const expected =
        '¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.';
      confirmAccount.mockResolvedValue(expected);

      await expect(controller.confirmAccount(dto)).resolves.toBe(expected);
      expect(confirmAccount).toHaveBeenCalledWith(dto);
    });

    it('should throw NotFoundException when token is invalid', async () => {
      confirmAccount.mockRejectedValue(
        new NotFoundException('Token no válido'),
      );

      await expect(controller.confirmAccount(dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('requestConfirmationCode', () => {
    const dto: RequestConfirmationCodeDto = { email: 'test@example.com' };

    it('should request confirmation code successfully', async () => {
      requestConfirmationCode.mockResolvedValue('enviado');

      await expect(controller.requestConfirmationCode(dto)).resolves.toBe(
        'enviado',
      );
      expect(requestConfirmationCode).toHaveBeenCalledWith(dto);
    });

    it('should propagate BadRequestException when user is already confirmed', async () => {
      requestConfirmationCode.mockRejectedValue(
        new BadRequestException('El Usuario ya está confirmado'),
      );

      await expect(controller.requestConfirmationCode(dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('forgotPassword', () => {
    const dto: ForgotPasswordDto = { email: 'test@example.com' };

    it('should delegate to the service', async () => {
      forgotPassword.mockResolvedValue('Si el correo existe...');

      await expect(controller.forgotPassword(dto)).resolves.toBe(
        'Si el correo existe...',
      );
      expect(forgotPassword).toHaveBeenCalledWith(dto);
    });
  });

  describe('validateToken', () => {
    const dto: ValidateTokenDto = { token: '123456' };

    it('should propagate NotFoundException when token is not found', async () => {
      validateToken.mockRejectedValue(new NotFoundException('Token no válido'));

      await expect(controller.validateToken(dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updatePasswordWithToken', () => {
    const dto: UpdatePasswordWithTokenDto = {
      token: '123456',
      password: 'newPassword123',
    };

    it('should update password successfully with valid token', async () => {
      updatePasswordWithToken.mockResolvedValue('ok');

      await expect(controller.updatePasswordWithToken(dto)).resolves.toBe('ok');
      expect(updatePasswordWithToken).toHaveBeenCalledWith(dto);
    });
  });

  describe('checkPassword', () => {
    const dto: CheckPasswordDto = { password: 'currentPassword123' };

    it('verifica con los headers de la sesión (cookie) y responde el mismo string', async () => {
      checkPassword.mockResolvedValue('Password Correcto');

      await expect(
        controller.checkPassword(sessionRequest(), dto),
      ).resolves.toBe('Password Correcto');

      const [calledDto, headers] = checkPassword.mock.calls[0] as [
        CheckPasswordDto,
        Headers,
      ];
      expect(calledDto).toBe(dto);
      expect(headers.get('cookie')).toBe('better-auth.session_token=abc');
      // La IP que ve better-auth es la de Express, no la que manda el cliente.
      expect(headers.get('x-forwarded-for')).toBeNull();
      expect(headers.get('x-client-ip')).toBe('10.0.0.7');
    });

    it('propaga el 400 de contraseña incorrecta', async () => {
      checkPassword.mockRejectedValue(
        new BadRequestException('Password Incorrecto'),
      );

      await expect(
        controller.checkPassword(sessionRequest(), dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCurrentUserPassword', () => {
    const dto: UpdateCurrentUserPasswordDto = {
      current_password: 'actual-123',
      password: 'nueva-12345',
    };

    function fakeResponse(): { res: Response; append: jest.Mock } {
      const append = jest.fn();
      return { res: { append } as unknown as Response, append };
    }

    it('reenvía las cookies de la sesión nueva y responde el mismo string', async () => {
      updateCurrentUserPassword.mockResolvedValue({
        message: 'El password se modificó correctamente',
        setCookieHeaders: ['better-auth.session_token=nuevo; Path=/; HttpOnly'],
      });
      const { res, append } = fakeResponse();

      await expect(
        controller.updateCurrentUserPassword(sessionRequest(), res, dto),
      ).resolves.toBe('El password se modificó correctamente');

      const [calledDto, headers] = updateCurrentUserPassword.mock.calls[0] as [
        UpdateCurrentUserPasswordDto,
        Headers,
      ];
      expect(calledDto).toBe(dto);
      expect(headers.get('cookie')).toBe('better-auth.session_token=abc');
      expect(append).toHaveBeenCalledWith('Set-Cookie', [
        'better-auth.session_token=nuevo; Path=/; HttpOnly',
      ]);
    });

    it('no escribe Set-Cookie si better-auth no devolvió cookies', async () => {
      updateCurrentUserPassword.mockResolvedValue({
        message: 'El password se modificó correctamente',
        setCookieHeaders: [],
      });
      const { res, append } = fakeResponse();

      await controller.updateCurrentUserPassword(sessionRequest(), res, dto);

      expect(append).not.toHaveBeenCalled();
    });

    it('propaga el 400 de contraseña actual incorrecta sin tocar la respuesta', async () => {
      updateCurrentUserPassword.mockRejectedValue(
        new BadRequestException('El Password Actual es incorrecto'),
      );
      const { res, append } = fakeResponse();

      await expect(
        controller.updateCurrentUserPassword(sessionRequest(), res, dto),
      ).rejects.toThrow(BadRequestException);
      expect(append).not.toHaveBeenCalled();
    });

    it('Fase 4 · P4.B: se audita como PASSWORD_CHANGE (sin capturar el body con las contraseñas)', () => {
      const auditable = Reflect.getMetadata(
        AUDITABLE_KEY,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- solo se lee su metadata
        AuthController.prototype.updateCurrentUserPassword,
      ) as AuditableOptions;

      expect(auditable).toEqual(
        expect.objectContaining({
          module: AuditModule.AUTH,
          action: AuditAction.PASSWORD_CHANGE,
          captureRequest: false,
          captureResponse: false,
        }),
      );
    });
  });

  describe('revokeServiceApiKey', () => {
    const keyId = '22222222-2222-4222-8222-222222222222';
    const admin = { id: 'admin-1', roles: [] } as unknown as User;

    function handlerMetadata<T>(
      key: string,
      handler: 'revokeServiceApiKey' | 'createServiceApiKey',
    ): T {
      const descriptor = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        handler,
      );
      return Reflect.getMetadata(key, descriptor?.value as object) as T;
    }

    it('revoca la key a nombre del usuario de la sesión', async () => {
      const revoked = {
        id: keyId,
        name: 'LPR',
        organizationId: 'org-a',
        enabled: false,
      };
      revokeServiceApiKey.mockResolvedValue(revoked);
      const req = { user: admin } as unknown as Parameters<
        AuthController['revokeServiceApiKey']
      >[0];

      await expect(controller.revokeServiceApiKey(req, keyId)).resolves.toBe(
        revoked,
      );
      expect(revokeServiceApiKey).toHaveBeenCalledWith(admin, keyId);
    });

    it('propaga el 404 de una key ajena o inexistente', async () => {
      revokeServiceApiKey.mockRejectedValue(
        new NotFoundException('API key de servicio no encontrada'),
      );
      const req = { user: admin } as unknown as Parameters<
        AuthController['revokeServiceApiKey']
      >[0];

      await expect(controller.revokeServiceApiKey(req, keyId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('está protegido igual que la emisión (guards y permiso)', () => {
      expect(
        handlerMetadata<unknown[]>(GUARDS_METADATA, 'revokeServiceApiKey'),
      ).toEqual([AuthGuard, AuthorizationGuard]);
      expect(
        handlerMetadata<unknown[]>(GUARDS_METADATA, 'revokeServiceApiKey'),
      ).toEqual(handlerMetadata(GUARDS_METADATA, 'createServiceApiKey'));
      expect(
        handlerMetadata<string[]>(PERMISSIONS_KEY, 'revokeServiceApiKey'),
      ).toEqual(['auth.manage-service-tokens']);
      expect(
        handlerMetadata<string[]>(PERMISSIONS_KEY, 'revokeServiceApiKey'),
      ).toEqual(handlerMetadata(PERMISSIONS_KEY, 'createServiceApiKey'));
    });
  });
});
