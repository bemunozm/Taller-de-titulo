import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { createMockRepository } from '../test-utils/mock-repository';
import { ConfirmAccountDto } from './dto/confirm-account.dto';
import { RequestConfirmationCodeDto } from './dto/request-confirmation-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { User } from '../users/entities/user.entity';
import { APIError as BetterAuthAPIError } from 'better-auth/api';

const FRONTEND_URL = 'http://localhost:5173';

function betterAuthError(
  status: 'BAD_REQUEST' | 'UNAUTHORIZED',
  code: string,
): BetterAuthAPIError {
  return new BetterAuthAPIError(status, { code, message: code });
}

interface CreateApiKeyCall {
  body: {
    userId: string;
    expiresIn?: number;
    permissions: Record<string, string[]>;
    rateLimitEnabled: boolean;
    metadata: Record<string, unknown>;
  };
}

const DAY_IN_SECONDS = 24 * 60 * 60;

describe('AuthService', () => {
  const betterAuth = {
    api: {
      verifyEmail: jest.fn(),
      sendVerificationEmail: jest.fn(),
      requestPasswordReset: jest.fn(),
      createApiKey: jest.fn(),
      updateApiKey: jest.fn(),
      changePassword: jest.fn(),
      verifyPassword: jest.fn(),
    },
  };
  const dataSource = { query: jest.fn() };
  const findByEmail = jest.fn();
  const findOne = jest.fn();
  let service: AuthService;

  const mockUser: Partial<User> = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    emailVerified: false,
    rut: '12345678-9',
    phone: '123456789',
    age: 25,
    roles: [],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: { findByEmail, findOne, save: jest.fn() },
        },
        { provide: CloudinaryService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: BetterAuthService, useValue: betterAuth },
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository<User>(),
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('confirmAccount', () => {
    const confirmAccountDto: ConfirmAccountDto = { token: '123456' };

    it('should verify the email through better-auth', async () => {
      betterAuth.api.verifyEmail.mockResolvedValue({ status: true });

      const result = await service.confirmAccount(confirmAccountDto);

      expect(betterAuth.api.verifyEmail).toHaveBeenCalledWith({
        query: { token: '123456' },
      });
      expect(result).toBe(
        '¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.',
      );
    });

    it('should throw NotFoundException when better-auth rejects the token', async () => {
      betterAuth.api.verifyEmail.mockRejectedValue(
        new BetterAuthAPIError('BAD_REQUEST'),
      );

      await expect(service.confirmAccount(confirmAccountDto)).rejects.toThrow(
        new NotFoundException('Token no válido'),
      );
    });

    it('should throw InternalServerErrorException when unexpected error occurs', async () => {
      betterAuth.api.verifyEmail.mockRejectedValue(new Error('Network error'));

      await expect(service.confirmAccount(confirmAccountDto)).rejects.toThrow(
        new InternalServerErrorException('Error al confirmar la cuenta'),
      );
    });
  });

  describe('requestConfirmationCode', () => {
    const dto: RequestConfirmationCodeDto = { email: 'test@example.com' };

    it('should trigger the better-auth verification email', async () => {
      findByEmail.mockResolvedValue({ ...mockUser, emailVerified: false });
      betterAuth.api.sendVerificationEmail.mockResolvedValue({ status: true });

      const result = await service.requestConfirmationCode(dto);

      expect(findByEmail).toHaveBeenCalledWith('test@example.com');
      expect(betterAuth.api.sendVerificationEmail).toHaveBeenCalledWith({
        body: {
          email: 'test@example.com',
          callbackURL: `${FRONTEND_URL}/auth/confirm-account`,
        },
      });
      expect(result).toBe(
        'Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.',
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      findByEmail.mockResolvedValue(null);

      await expect(service.requestConfirmationCode(dto)).rejects.toThrow(
        new NotFoundException('El Usuario no existe'),
      );
    });

    it('should throw BadRequestException when user is already emailVerified', async () => {
      findByEmail.mockResolvedValue({ ...mockUser, emailVerified: true });

      await expect(service.requestConfirmationCode(dto)).rejects.toThrow(
        new BadRequestException('El Usuario ya está confirmado'),
      );
      expect(betterAuth.api.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException when unexpected error occurs', async () => {
      findByEmail.mockRejectedValue(new Error('Database error'));

      await expect(service.requestConfirmationCode(dto)).rejects.toThrow(
        new InternalServerErrorException(
          'Error al solicitar código de confirmación',
        ),
      );
    });
  });

  describe('forgotPassword', () => {
    const dto: ForgotPasswordDto = { email: 'test@example.com' };

    it('should request the password reset through better-auth without checking the user', async () => {
      betterAuth.api.requestPasswordReset.mockResolvedValue({ status: true });

      const result = await service.forgotPassword(dto);

      expect(betterAuth.api.requestPasswordReset).toHaveBeenCalledWith({
        body: {
          email: 'test@example.com',
          redirectTo: `${FRONTEND_URL}/auth/new-password`,
        },
      });
      // Anti-enumeración: no consulta si el email existe
      expect(findByEmail).not.toHaveBeenCalled();
      expect(result).toContain('Si el correo existe en nuestro sistema');
    });

    it('should throw InternalServerErrorException when better-auth fails', async () => {
      betterAuth.api.requestPasswordReset.mockRejectedValue(
        new Error('SMTP down'),
      );

      await expect(service.forgotPassword(dto)).rejects.toThrow(
        new InternalServerErrorException(
          'Error al procesar recuperación de password',
        ),
      );
    });
  });

  describe('updateCurrentUserPassword (credencial de better-auth)', () => {
    const headers = new Headers({ cookie: 'better-auth.session_token=abc' });
    const dto = { current_password: 'actual-123', password: 'nueva-12345' };

    it('delega en auth.api.changePassword con revokeOtherSessions y devuelve las cookies nuevas', async () => {
      const responseHeaders = new Headers();
      responseHeaders.append(
        'set-cookie',
        'better-auth.session_token=nuevo; Path=/; HttpOnly',
      );
      betterAuth.api.changePassword.mockResolvedValue({
        headers: responseHeaders,
        response: { token: 'nuevo', user: { id: '1' } },
      });

      const result = await service.updateCurrentUserPassword(dto, headers);

      expect(betterAuth.api.changePassword).toHaveBeenCalledWith({
        body: {
          currentPassword: 'actual-123',
          newPassword: 'nueva-12345',
          revokeOtherSessions: true,
        },
        headers,
        returnHeaders: true,
      });
      expect(result).toEqual({
        message: 'El password se modificó correctamente',
        setCookieHeaders: ['better-auth.session_token=nuevo; Path=/; HttpOnly'],
      });
    });

    it('contraseña actual incorrecta -> 400 con el mensaje de siempre', async () => {
      betterAuth.api.changePassword.mockRejectedValue(
        betterAuthError('BAD_REQUEST', 'INVALID_PASSWORD'),
      );

      await expect(
        service.updateCurrentUserPassword(dto, headers),
      ).rejects.toThrow(
        new BadRequestException('El Password Actual es incorrecto'),
      );
    });

    it('nueva contraseña fuera de los límites de better-auth -> 400', async () => {
      betterAuth.api.changePassword.mockRejectedValue(
        betterAuthError('BAD_REQUEST', 'PASSWORD_TOO_SHORT'),
      );

      await expect(
        service.updateCurrentUserPassword(dto, headers),
      ).rejects.toThrow(BadRequestException);
    });

    it('cuenta sin credencial -> 400 que apunta a "Olvidé mi contraseña"', async () => {
      betterAuth.api.changePassword.mockRejectedValue(
        betterAuthError('BAD_REQUEST', 'CREDENTIAL_ACCOUNT_NOT_FOUND'),
      );

      await expect(
        service.updateCurrentUserPassword(dto, headers),
      ).rejects.toThrow(/Olvidé mi contraseña/);
    });

    it('sesión inválida para better-auth -> 401', async () => {
      betterAuth.api.changePassword.mockRejectedValue(
        betterAuthError('UNAUTHORIZED', 'UNAUTHORIZED'),
      );

      await expect(
        service.updateCurrentUserPassword(dto, headers),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('error inesperado -> 500 sin filtrar el detalle', async () => {
      betterAuth.api.changePassword.mockRejectedValue(new Error('db down'));

      await expect(
        service.updateCurrentUserPassword(dto, headers),
      ).rejects.toThrow(
        new InternalServerErrorException('Error al cambiar la contraseña'),
      );
    });

    it('misma contraseña y la actual es correcta -> 400 "no puede ser igual", sin cambiarla', async () => {
      betterAuth.api.verifyPassword.mockResolvedValue({ status: true });

      await expect(
        service.updateCurrentUserPassword(
          { current_password: 'misma-12345', password: 'misma-12345' },
          headers,
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'La nueva contraseña no puede ser igual a la actual',
        ),
      );
      expect(betterAuth.api.verifyPassword).toHaveBeenCalledWith({
        body: { password: 'misma-12345' },
        headers,
      });
      expect(betterAuth.api.changePassword).not.toHaveBeenCalled();
    });

    it('misma contraseña pero la actual es incorrecta -> 400 "actual incorrecta"', async () => {
      betterAuth.api.verifyPassword.mockRejectedValue(
        betterAuthError('BAD_REQUEST', 'INVALID_PASSWORD'),
      );

      await expect(
        service.updateCurrentUserPassword(
          { current_password: 'misma-12345', password: 'misma-12345' },
          headers,
        ),
      ).rejects.toThrow(
        new BadRequestException('El Password Actual es incorrecto'),
      );
      expect(betterAuth.api.changePassword).not.toHaveBeenCalled();
    });
  });

  describe('checkPassword (credencial de better-auth)', () => {
    const headers = new Headers({ cookie: 'better-auth.session_token=abc' });

    it('verifica con auth.api.verifyPassword (cuenta credential) y responde "Password Correcto"', async () => {
      betterAuth.api.verifyPassword.mockResolvedValue({ status: true });

      await expect(
        service.checkPassword({ password: 'secreta-123' }, headers),
      ).resolves.toBe('Password Correcto');
      expect(betterAuth.api.verifyPassword).toHaveBeenCalledWith({
        body: { password: 'secreta-123' },
        headers,
      });
    });

    it('contraseña incorrecta -> 400 "Password Incorrecto"', async () => {
      betterAuth.api.verifyPassword.mockRejectedValue(
        betterAuthError('BAD_REQUEST', 'INVALID_PASSWORD'),
      );

      await expect(
        service.checkPassword({ password: 'otra-123' }, headers),
      ).rejects.toThrow(new BadRequestException('Password Incorrecto'));
    });

    it('sin sesión para better-auth -> 401', async () => {
      betterAuth.api.verifyPassword.mockRejectedValue(
        betterAuthError('UNAUTHORIZED', 'UNAUTHORIZED'),
      );

      await expect(
        service.checkPassword({ password: 'secreta-123' }, headers),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('error inesperado -> 500', async () => {
      betterAuth.api.verifyPassword.mockRejectedValue(new Error('boom'));

      await expect(
        service.checkPassword({ password: 'secreta-123' }, headers),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('createServiceApiKey', () => {
    const orgA = '11111111-1111-4111-8111-111111111111';
    const requester = {
      id: 'admin-1',
      roles: [{ name: 'Administrador' }],
    } as unknown as User;
    const superAdmin = {
      id: 'root-1',
      roles: [{ name: 'Super Administrador' }],
    } as unknown as User;

    function lastCreateCall(): CreateApiKeyCall {
      const calls = betterAuth.api.createApiKey.mock.calls as Array<
        [CreateApiKeyCall]
      >;
      return calls[calls.length - 1][0];
    }

    beforeEach(() => {
      findOne.mockResolvedValue({
        id: 'admin-1',
        email: 'admin@example.com',
        roles: [],
      });
      betterAuth.api.createApiKey.mockResolvedValue({
        id: 'key-1',
        key: 'plain-key',
        name: 'LPR',
        prefix: null,
        start: null,
        expiresAt: null,
        createdAt: new Date(),
      });
    });

    it('vincula la key al condominio en permissions (server-only), no en metadata', async () => {
      dataSource.query.mockResolvedValue([{ organizationId: orgA }]);

      const result = await service.createServiceApiKey(requester, {
        name: 'LPR',
      });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM member'),
        ['admin-1'],
      );
      const { body } = lastCreateCall();
      expect(body.permissions).toEqual({ service: ['lpr'], org: [orgA] });
      expect(body.metadata).not.toHaveProperty('organizationId');
      expect(body.metadata.createdBy).toBe('admin-1');
      expect(result.organizationId).toBe(orgA);
    });

    it('emite la key SIN el límite por key del plugin (rateLimitEnabled: false)', async () => {
      dataSource.query.mockResolvedValue([{ organizationId: orgA }]);

      await service.createServiceApiKey(requester, { name: 'LPR' });

      expect(lastCreateCall().body.rateLimitEnabled).toBe(false);
    });

    it('toda key expira: 365 días por defecto', async () => {
      dataSource.query.mockResolvedValue([{ organizationId: orgA }]);

      await service.createServiceApiKey(requester, { name: 'LPR' });

      expect(lastCreateCall().body.expiresIn).toBe(365 * DAY_IN_SECONDS);
    });

    it.each([
      ['30d', 30],
      ['90d', 90],
      ['180d', 180],
      ['365d', 365],
    ] as const)('duración %s -> expira en %i días', async (duration, days) => {
      dataSource.query.mockResolvedValue([{ organizationId: orgA }]);

      await service.createServiceApiKey(requester, { name: 'LPR', duration });

      expect(lastCreateCall().body.expiresIn).toBe(days * DAY_IN_SECONDS);
    });

    it('sin organizacion -> 400 y no emite ninguna key', async () => {
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.createServiceApiKey(requester, { name: 'LPR' }),
      ).rejects.toThrow(BadRequestException);
      expect(betterAuth.api.createApiKey).not.toHaveBeenCalled();
    });

    it('un super-admin vincula la key al condominio del usuario dueño', async () => {
      dataSource.query.mockResolvedValue([{ organizationId: orgA }]);

      await service.createServiceApiKey(superAdmin, {
        name: 'LPR',
        targetUserId: 'admin-1',
      });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM member'),
        ['admin-1'],
      );
      const { body } = lastCreateCall();
      expect(body.userId).toBe('admin-1');
      expect(body.permissions).toEqual({ service: ['lpr'], org: [orgA] });
    });

    it('un super-admin sin dueño con condominio -> 400', async () => {
      findOne.mockResolvedValue({
        id: 'root-1',
        email: 'root@example.com',
        roles: [{ name: 'Super Administrador' }],
      });
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.createServiceApiKey(superAdmin, { name: 'LPR' }),
      ).rejects.toThrow(BadRequestException);
      expect(betterAuth.api.createApiKey).not.toHaveBeenCalled();
    });

    describe('asignada a otro usuario (targetUserId)', () => {
      const orgB = '33333333-3333-4333-8333-333333333333';

      /** Membresía por usuario: admin-1 en orgA, el resto según `targetOrg`. */
      function mockMembership(targetOrg: string | null): void {
        dataSource.query.mockImplementation(
          (_sql: string, params: unknown[]) => {
            const userId = params[0];
            if (userId === 'admin-1') {
              return Promise.resolve([{ organizationId: orgA }]);
            }
            return Promise.resolve(
              targetOrg ? [{ organizationId: targetOrg }] : [],
            );
          },
        );
      }

      it('a un usuario del mismo condominio -> emite la key a su nombre', async () => {
        findOne.mockResolvedValue({
          id: 'worker-1',
          email: 'w@example.com',
          roles: [],
        });
        mockMembership(orgA);

        await service.createServiceApiKey(requester, {
          name: 'LPR',
          targetUserId: 'worker-1',
        });

        expect(lastCreateCall().body.userId).toBe('worker-1');
      });

      it('a un usuario de otro condominio -> 403', async () => {
        findOne.mockResolvedValue({
          id: 'worker-2',
          email: 'w2@example.com',
          roles: [],
        });
        mockMembership(orgB);

        await expect(
          service.createServiceApiKey(requester, {
            name: 'LPR',
            targetUserId: 'worker-2',
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(betterAuth.api.createApiKey).not.toHaveBeenCalled();
      });

      it('a una cuenta super-admin -> 403', async () => {
        findOne.mockResolvedValue({
          id: 'root-1',
          email: 'root@example.com',
          roles: [{ name: 'Super Administrador' }],
        });
        mockMembership(orgA);

        await expect(
          service.createServiceApiKey(requester, {
            name: 'LPR',
            targetUserId: 'root-1',
          }),
        ).rejects.toThrow(ForbiddenException);
        expect(betterAuth.api.createApiKey).not.toHaveBeenCalled();
      });
    });
  });

  describe('revokeServiceApiKey', () => {
    const orgA = '11111111-1111-4111-8111-111111111111';
    const orgB = '33333333-3333-4333-8333-333333333333';
    const keyId = '22222222-2222-4222-8222-222222222222';
    const admin = {
      id: 'admin-1',
      roles: [{ name: 'Administrador' }],
    } as unknown as User;
    const superAdmin = {
      id: 'root-1',
      roles: [{ name: 'Super Administrador' }],
    } as unknown as User;

    /** Fila de `apikey` tal como la guarda el plugin (`permissions` en JSON). */
    function keyRow(permissions: Record<string, string[]> | null) {
      return {
        id: keyId,
        referenceId: 'owner-1',
        permissions: permissions ? JSON.stringify(permissions) : null,
      };
    }

    /** `apikey` -> `key`; `member` -> condominio del solicitante. */
    function mockDb(
      key: ReturnType<typeof keyRow> | null,
      requesterOrgId: string | null,
    ): void {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM apikey')) {
          return Promise.resolve(key ? [key] : []);
        }
        if (sql.includes('FROM member')) {
          return Promise.resolve(
            requesterOrgId ? [{ organizationId: requesterOrgId }] : [],
          );
        }
        return Promise.reject(new Error(`query inesperada: ${sql}`));
      });
    }

    beforeEach(() => {
      betterAuth.api.updateApiKey.mockResolvedValue({
        id: keyId,
        name: 'LPR',
        enabled: false,
      });
    });

    it('revoca una key del propio condominio: updateApiKey server-side con el dueño y enabled=false', async () => {
      mockDb(keyRow({ service: ['lpr'], org: [orgA] }), orgA);

      const result = await service.revokeServiceApiKey(admin, keyId);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM apikey'),
        [keyId],
      );
      // Sin `headers`: llamada de servidor; `userId` = dueño (referenceId).
      expect(betterAuth.api.updateApiKey).toHaveBeenCalledWith({
        body: { keyId, userId: 'owner-1', enabled: false },
      });
      expect(result).toEqual({
        id: keyId,
        name: 'LPR',
        organizationId: orgA,
        enabled: false,
      });
    });

    it('una key de otro condominio -> 404 (no revela que existe) y no la toca', async () => {
      mockDb(keyRow({ service: ['lpr'], org: [orgB] }), orgA);

      await expect(service.revokeServiceApiKey(admin, keyId)).rejects.toThrow(
        new NotFoundException('API key de servicio no encontrada'),
      );
      expect(betterAuth.api.updateApiKey).not.toHaveBeenCalled();
    });

    it('una key inexistente -> el mismo 404', async () => {
      mockDb(null, orgA);

      await expect(service.revokeServiceApiKey(admin, keyId)).rejects.toThrow(
        new NotFoundException('API key de servicio no encontrada'),
      );
      expect(betterAuth.api.updateApiKey).not.toHaveBeenCalled();
    });

    it.each([
      ['sin permissions', null],
      ['sin condominio', { service: ['lpr'] }],
    ])(
      'key %s -> 404 para un admin de condominio',
      async (_label, permissions) => {
        mockDb(keyRow(permissions), orgA);

        await expect(service.revokeServiceApiKey(admin, keyId)).rejects.toThrow(
          NotFoundException,
        );
        expect(betterAuth.api.updateApiKey).not.toHaveBeenCalled();
      },
    );

    it('un solicitante sin condominio -> 404', async () => {
      mockDb(keyRow({ service: ['lpr'], org: [orgA] }), null);

      await expect(service.revokeServiceApiKey(admin, keyId)).rejects.toThrow(
        NotFoundException,
      );
      expect(betterAuth.api.updateApiKey).not.toHaveBeenCalled();
    });

    it('un super-admin revoca la key de cualquier condominio', async () => {
      mockDb(keyRow({ service: ['lpr'], org: [orgB] }), null);

      await expect(
        service.revokeServiceApiKey(superAdmin, keyId),
      ).resolves.toMatchObject({ id: keyId, organizationId: orgB });
      expect(betterAuth.api.updateApiKey).toHaveBeenCalledWith({
        body: { keyId, userId: 'owner-1', enabled: false },
      });
    });

    it('si la key desaparece antes del update (KEY_NOT_FOUND) -> 404', async () => {
      mockDb(keyRow({ service: ['lpr'], org: [orgA] }), orgA);
      betterAuth.api.updateApiKey.mockRejectedValue(
        new BetterAuthAPIError('NOT_FOUND', {
          code: 'KEY_NOT_FOUND',
          message: 'API Key not found',
        }),
      );

      await expect(service.revokeServiceApiKey(admin, keyId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('error inesperado -> 500 sin filtrar el detalle', async () => {
      mockDb(keyRow({ service: ['lpr'], org: [orgA] }), orgA);
      betterAuth.api.updateApiKey.mockRejectedValue(new Error('db down'));

      await expect(service.revokeServiceApiKey(admin, keyId)).rejects.toThrow(
        new InternalServerErrorException(
          'Error al revocar la API key de servicio',
        ),
      );
    });
  });
});
