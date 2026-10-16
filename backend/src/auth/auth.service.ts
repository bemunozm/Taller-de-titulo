import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuthService as BetterAuthServiceBase } from '@thallesp/nestjs-better-auth';
import { APIError as BetterAuthAPIError } from 'better-auth/api';
import type { auth } from './better-auth';
import { UsersService } from 'src/users/users.service';
import { userFieldConflict } from 'src/users/user-unique-conflict';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { User } from 'src/users/entities/user.entity';
import {
  hasPlatformSuperAdminRole,
  resolveOrganizationIdForUser,
} from 'src/common/tenant/tenant-context.util';
import {
  evaluateTargetUser,
  managesOrganization,
  type PolicyActor,
} from 'src/roles/role-assignment.policy';
import { ConfirmAccountDto } from './dto/confirm-account.dto';
import { RequestConfirmationCodeDto } from './dto/request-confirmation-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { UpdatePasswordWithTokenDto } from './dto/update-password-with-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateCurrentUserPasswordDto } from './dto/update-current-user-password.dto';
import { CheckPasswordDto } from './dto/check-password.dto';
import {
  CreateServiceApiKeyDto,
  DEFAULT_SERVICE_API_KEY_DURATION,
  ServiceApiKeyDuration,
} from './dto/create-service-api-key.dto';
import {
  buildServiceKeyPermissions,
  extractServiceKeyOrganizationId,
} from './service-api-key.permissions';

/** Resultado de cambiar la contraseña: mensaje + cookies de la sesión nueva. */
export interface PasswordChangeResult {
  message: string;
  /**
   * `Set-Cookie` que emitió better-auth: `revokeOtherSessions` borra TODAS las
   * sesiones (también la actual) y abre una nueva. El controller debe
   * reenviarlas o el usuario queda deslogueado.
   */
  setCookieHeaders: string[];
}

/** Código de error de un `APIError` de better-auth (`body.code`). */
function betterAuthErrorCode(error: BetterAuthAPIError): string | undefined {
  return (error.body as { code?: string } | undefined)?.code;
}

// Duraciones de CreateServiceApiKeyDto en segundos (`expiresIn` de
// auth.api.createApiKey). Toda key expira: no hay opción sin vencimiento.
const SERVICE_API_KEY_DURATIONS: Record<ServiceApiKeyDuration, number> = {
  '30d': 30 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60,
  '180d': 180 * 24 * 60 * 60,
  '365d': 365 * 24 * 60 * 60,
};

/** Mismo mensaje para una key inexistente y para una de otro condominio. */
const SERVICE_API_KEY_NOT_FOUND_MESSAGE = 'API key de servicio no encontrada';

/** Resultado de revocar una API key de servicio. */
export interface RevokedServiceApiKey {
  id: string;
  name: string | null;
  organizationId: string | null;
  enabled: boolean;
}

/** Columnas de la tabla `apikey` (plugin `apiKey`) que se leen para revocar. */
interface ServiceApiKeyRow {
  id: string;
  referenceId: string;
  permissions: unknown;
}

/** API key de servicio leída de la BD, con el condominio ya extraído. */
interface StoredServiceApiKey {
  id: string;
  ownerUserId: string;
  organizationId: string | null;
}

/**
 * `apikey.permissions` es JSON guardado como texto. Un valor ilegible cuenta
 * como "sin permisos" (y, por lo tanto, sin condominio).
 */
function parseStoredPermissions(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw ?? null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Rol de plataforma: opera sobre todos los condominios. */
function isPlatformSuperAdmin(user: Pick<User, 'roles'>): boolean {
  return hasPlatformSuperAdminRole(user);
}

// Tipo del `.api` parametrizado con `typeof auth` (import type — no ejecuta
// el módulo better-auth.ts, solo aporta el tipo) para que incluya los
// endpoints de PLUGINS (createApiKey, del plugin apiKey) además de los
// endpoints core (requestPasswordReset, resetPassword, verifyEmail,
// sendVerificationEmail). NO se usa como tipo del campo inyectado: NestJS
// resuelve la DI por la clase `BetterAuthServiceBase` vía
// `design:paramtypes` — un alias de un tipo genérico ahí se serializa como
// `Object` y rompe la inyección (UnknownDependenciesException). Se castea
// puntualmente en `betterAuthApi` de abajo.
type BetterAuthApi = BetterAuthServiceBase<typeof auth>['api'];

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
    // Tarea #18: llamadas server-side a better-auth (sin `headers`/sesión)
    // para requestPasswordReset/resetPassword/verifyEmail/sendVerificationEmail
    // /createApiKey. Disponible por DI porque BetterAuthModule.forRoot(...)
    // es global (app.module.ts) — mismo patrón que src/auth/auth.guard.ts.
    private readonly betterAuthService: BetterAuthServiceBase,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    // Tarea #21: resuelve la organización del requester/target sin pasar
    // por TenantContextService (REQUEST-scoped) para no volver AuthService
    // entero request-scoped solo por este método — reusa el mismo helper
    // que ya usa el interceptor de tenant (tenant-context.util.ts).
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** `.api` tipado con los plugins de nuestro `auth` (ver `BetterAuthApi` arriba) — solo para llamadas plugin-specific (createApiKey, updateApiKey). */
  private get betterAuthApi(): BetterAuthApi {
    return this.betterAuthService.api as unknown as BetterAuthApi;
  }

  /** URL del frontend para construir los `redirectTo`/`callbackURL` de better-auth (rutas aún no migradas — #20). */
  private get frontendUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173'
    );
  }

  /**
   * Tarea #18 (docs/modulos/auth-multitenant.md §11/§12): reemplaza los
   * códigos de 6 dígitos propios (tabla Token) por la verificación nativa de
   * better-auth (JWT firmado, `emailVerification` en better-auth.ts).
   * `user.emailVerified` es la MISMA columna que ya leía el login legacy
   * (doc §12) — no hace falta ningún bridge adicional acá. El email de
   * bienvenida se re-cableó al hook `emailVerification.afterEmailVerification`
   * (better-auth.ts), que sí tiene acceso al usuario recién verificado (esta
   * respuesta no lo trae en el caso normal — ver `verifyEmail` en el SDK).
   */
  async confirmAccount(confirmAccountDto: ConfirmAccountDto) {
    try {
      await this.betterAuthService.api.verifyEmail({
        query: { token: confirmAccountDto.token },
      });

      return '¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.';
    } catch (error) {
      if (error instanceof BetterAuthAPIError) {
        throw new NotFoundException('Token no válido');
      }
      throw new InternalServerErrorException('Error al confirmar la cuenta');
    }
  }

  /** Tarea #18: dispara `emailVerification.sendVerificationEmail` de better-auth en vez del código propio de 6 dígitos. */
  async requestConfirmationCode(
    requestConfirmationCodeDto: RequestConfirmationCodeDto,
  ) {
    try {
      const { email } = requestConfirmationCodeDto;

      // Usuario existe (se mantiene el pre-check propio: a diferencia de
      // forgot-password, esta operación no cambia credenciales, así que
      // el mensaje específico sigue siendo la UX deseada acá).
      const user = await this.usersService.findByEmail(email);
      if (!user) {
        throw new NotFoundException('El Usuario no existe');
      }

      if (user.emailVerified) {
        throw new BadRequestException('El Usuario ya está confirmado');
      }

      await this.betterAuthService.api.sendVerificationEmail({
        body: {
          email: user.email,
          callbackURL: `${this.frontendUrl}/auth/confirm-account`,
        },
      });

      return 'Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.';
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Error al solicitar código de confirmación',
      );
    }
  }

  /**
   * Tarea #18: dispara `requestPasswordReset` de better-auth en vez del
   * token de 6 dígitos propio. Cambio de comportamiento DELIBERADO
   * (hardening, skill better-auth-security-best-practices "Account
   * Enumeration Prevention"): ya no revela si el email existe — better-auth
   * simula el trabajo y responde igual en ambos casos.
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    try {
      await this.betterAuthService.api.requestPasswordReset({
        body: {
          email: forgotPasswordDto.email,
          redirectTo: `${this.frontendUrl}/auth/new-password`,
        },
      });

      return 'Si el correo existe en nuestro sistema, revisa tu email para restablecer tu contraseña de forma segura.';
    } catch (error) {
      this.logger.error(
        'Error al solicitar el reset de contraseña',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al procesar recuperación de password',
      );
    }
  }

  /**
   * Tarea #18: better-auth no expone un endpoint JSON para "validar sin
   * consumir" (su GET /reset-password/:token es un redirect de navegador).
   * Se valida contra la MISMA tabla `verification` que usa
   * `requestPasswordReset`/`resetPassword` (identifier `reset-password:<token>`).
   */
  async validateToken(validateTokenDto: ValidateTokenDto) {
    try {
      const rows: Array<{ exists: boolean }> =
        await this.userRepository.manager.query(
          `SELECT EXISTS(SELECT 1 FROM verification WHERE identifier = $1 AND "expiresAt" > now()) AS exists`,
          [`reset-password:${validateTokenDto.token}`],
        );

      if (!rows[0]?.exists) {
        throw new NotFoundException('Token no válido');
      }

      return 'Token verificado correctamente. Ahora puedes establecer tu nueva contraseña.';
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al validar el token');
    }
  }

  /**
   * Restablece la contraseña con el token del email vía `auth.api.resetPassword`
   * (token opaco de un solo uso, tabla `verification`). better-auth reescribe
   * la única credencial (`account.password`) y, por
   * `revokeSessionsOnPasswordReset`, cierra todas las sesiones del usuario
   * (better-auth.ts). Acá solo queda el side-effect histórico: auto-confirmar
   * la cuenta si no estaba verificada (el link llegó a su email).
   */
  async updatePasswordWithToken(
    updatePasswordWithTokenDto: UpdatePasswordWithTokenDto,
  ) {
    try {
      const { token, password } = updatePasswordWithTokenDto;
      const identifier = `reset-password:${token}`;

      // Resolvemos el userId ANTES de resetear porque better-auth
      // CONSUME (borra) el registro de `verification` al resetear —
      // después no habría forma de saber a quién auto-confirmar.
      const verificationRows: Array<{ value: string }> =
        await this.userRepository.manager.query(
          `SELECT value FROM verification WHERE identifier = $1 AND "expiresAt" > now() LIMIT 1`,
          [identifier],
        );
      if (verificationRows.length === 0) {
        throw new NotFoundException('Token no válido');
      }
      const userId = verificationRows[0].value;

      try {
        await this.betterAuthService.api.resetPassword({
          body: { newPassword: password, token },
        });
      } catch (error) {
        if (error instanceof BetterAuthAPIError) {
          const code = (error.body as { code?: string } | undefined)?.code;
          if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
            throw new BadRequestException(error.message);
          }
          throw new NotFoundException('Token no válido');
        }
        throw error;
      }

      await this.userRepository.update(
        { id: userId, emailVerified: false },
        { emailVerified: true },
      );

      return '¡Contraseña actualizada exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.';
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        'Error al actualizar password con token',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al actualizar password con token',
      );
    }
  }

  async getUser(userId: string) {
    try {
      const user = await this.usersService.findOne(userId);
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al obtener el usuario');
    }
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    try {
      const { name, email, phone, age } = updateProfileDto;

      // Validar email si se está actualizando
      if (email) {
        const userExists = await this.usersService.findByEmail(email);
        if (userExists && userExists.id !== userId) {
          // Corrección P5 (QA): 409 con el campo, igual que en /users.
          throw userFieldConflict('email');
        }
      }

      const user = await this.usersService.findOne(userId);

      // Actualizar solo los campos que estén presentes
      if (name !== undefined) user.name = name;
      if (email !== undefined) user.email = email.toLowerCase();
      if (phone !== undefined) user.phone = phone;
      if (age !== undefined) user.age = age;

      await this.usersService.save(user);
      return 'Perfil actualizado correctamente';
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Error al actualizar el perfil');
    }
  }

  /**
   * Cambio de contraseña con sesión activa (Fase 4 · P2, hallazgo A1). Delega
   * en `auth.api.changePassword` de better-auth: verifica y reescribe la
   * credencial que usa el login (`account.password`, cuenta `credential`), así
   * que este endpoint y el nativo `/api/auth/change-password` operan sobre la
   * MISMA credencial. `revokeOtherSessions: true` cierra todas las sesiones
   * (también la actual) y abre una nueva; sus `Set-Cookie` vuelven en el
   * resultado para que el controller las reenvíe.
   *
   * `headers` son los de la request del usuario (cookie de sesión), ver
   * `buildBetterAuthHeaders`.
   */
  async updateCurrentUserPassword(
    updateCurrentUserPasswordDto: UpdateCurrentUserPasswordDto,
    headers: Headers,
  ): Promise<PasswordChangeResult> {
    const { current_password, password } = updateCurrentUserPasswordDto;

    // Misma contraseña: primero se informa si la actual es incorrecta (orden
    // histórico de los errores) y, si es correcta, que no puede repetirse.
    if (current_password === password) {
      const isCurrentCorrect = await this.verifyCurrentPassword(
        current_password,
        headers,
      );
      throw new BadRequestException(
        isCurrentCorrect
          ? 'La nueva contraseña no puede ser igual a la actual'
          : 'El Password Actual es incorrecto',
      );
    }

    try {
      const { headers: responseHeaders } =
        await this.betterAuthService.api.changePassword({
          body: {
            currentPassword: current_password,
            newPassword: password,
            revokeOtherSessions: true,
          },
          headers,
          returnHeaders: true,
        });

      return {
        message: 'El password se modificó correctamente',
        setCookieHeaders: responseHeaders.getSetCookie(),
      };
    } catch (error) {
      if (error instanceof BetterAuthAPIError) {
        const code = betterAuthErrorCode(error);
        if (code === 'INVALID_PASSWORD') {
          throw new BadRequestException('El Password Actual es incorrecto');
        }
        if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
          throw new BadRequestException(
            'La nueva contraseña debe tener entre 8 y 128 caracteres',
          );
        }
        if (code === 'CREDENTIAL_ACCOUNT_NOT_FOUND') {
          throw new BadRequestException(
            'Tu cuenta aún no tiene contraseña. Usa "Olvidé mi contraseña" para definirla.',
          );
        }
        if (code === 'UNAUTHORIZED') {
          throw new UnauthorizedException();
        }
      }
      this.logger.error(
        'Error al cambiar la contraseña',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException('Error al cambiar la contraseña');
    }
  }

  /**
   * Verifica la contraseña del usuario de la sesión contra la credencial de
   * better-auth (`auth.api.verifyPassword`, que usa el verificador configurado
   * en better-auth.ts). No toca `user`: la única credencial es la de `account`.
   */
  async checkPassword(
    checkPasswordDto: CheckPasswordDto,
    headers: Headers,
  ): Promise<string> {
    const isCorrect = await this.verifyCurrentPassword(
      checkPasswordDto.password,
      headers,
    );
    if (!isCorrect) {
      throw new BadRequestException('Password Incorrecto');
    }
    return 'Password Correcto';
  }

  /** `true`/`false` según better-auth; cualquier otro fallo es 401 o 500. */
  private async verifyCurrentPassword(
    password: string,
    headers: Headers,
  ): Promise<boolean> {
    try {
      await this.betterAuthService.api.verifyPassword({
        body: { password },
        headers,
      });
      return true;
    } catch (error) {
      if (error instanceof BetterAuthAPIError) {
        const code = betterAuthErrorCode(error);
        if (code === 'INVALID_PASSWORD') {
          return false;
        }
        if (code === 'UNAUTHORIZED') {
          throw new UnauthorizedException();
        }
      }
      this.logger.error(
        'Error al verificar la contraseña',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al verificar la contraseña',
      );
    }
  }

  async uploadProfilePicture(userId: string, file: Express.Multer.File) {
    try {
      if (!file) {
        throw new BadRequestException('No se proporcionó un archivo');
      }

      // Validar tipo de archivo
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/jpg',
        'image/webp',
      ];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new BadRequestException(
          'Solo se permiten imágenes JPG, PNG o WEBP',
        );
      }

      // Validar tamaño (5MB máximo)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        throw new BadRequestException('La imagen no puede exceder los 5MB');
      }

      // Obtener usuario para eliminar imagen anterior si existe
      const user = await this.usersService.findOne(userId);

      // Subir nueva imagen a Cloudinary
      const result = await this.cloudinaryService.uploadImage(file);

      // Eliminar imagen anterior de Cloudinary si existe
      if (user.profilePicture) {
        // Extraer public_id de la URL de Cloudinary
        const urlParts = user.profilePicture.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/'); // folder/filename.ext
        const publicId = publicIdWithExtension.split('.')[0]; // folder/filename

        try {
          await this.cloudinaryService.deleteImage(publicId);
        } catch (error) {
          // Si falla la eliminación, continuar (puede que la imagen ya no exista)
          this.logger.error(
            'Error al eliminar imagen anterior',
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      // Actualizar usuario con nueva URL
      await this.usersService.update(userId, {
        profilePicture: result.secure_url,
      });

      return { url: result.secure_url };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        'Error al subir imagen a Cloudinary',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al subir la imagen de perfil',
      );
    }
  }

  async deleteProfilePicture(userId: string) {
    try {
      const user = await this.usersService.findOne(userId);

      if (!user.profilePicture) {
        throw new BadRequestException('No hay foto de perfil para eliminar');
      }

      // Extraer public_id de la URL de Cloudinary
      const urlParts = user.profilePicture.split('/');
      const publicIdWithExtension = urlParts.slice(-2).join('/'); // folder/filename.ext
      const publicId = publicIdWithExtension.split('.')[0]; // folder/filename

      // Eliminar imagen de Cloudinary
      try {
        await this.cloudinaryService.deleteImage(publicId);
      } catch (error) {
        this.logger.error(
          'Error al eliminar imagen de Cloudinary',
          error instanceof Error ? error.stack : String(error),
        );
        // Continuar para eliminar de BD aunque falle en Cloudinary
      }

      // Actualizar usuario para remover URL
      await this.usersService.update(userId, {
        profilePicture: null,
      });

      return 'Foto de perfil eliminada exitosamente';
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        'Error al eliminar imagen de perfil',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al eliminar la imagen de perfil',
      );
    }
  }

  /**
   * Tarea #18 (docs/modulos/auth-multitenant.md §10.3): genera una API key
   * de better-auth (plugin `apiKey`) para credenciales de máquina (worker
   * LPR y futuros servicios). Llamada SERVER-SIDE (sin `headers`) a
   * propósito: better-auth trata las llamadas sin `headers`/`request` como
   * privilegiadas y permite pasar `userId` explícito en el body — si se
   * pasaran los headers de la request entrante, better-auth la trataría
   * como "client request" y forzaría el key a pertenecer al usuario de la
   * sesión actual (no serviría para asignarla a una cuenta de servicio
   * distinta). El endpoint que llama a este método ya está protegido con
   * `@RequirePermissions('auth.manage-service-tokens')`.
   *
   * El worker consume la key enviándola en el header `x-api-key` (default
   * de better-auth, `apiKeyHeaders`) contra los endpoints de ingesta LPR,
   * protegidos por `ServiceApiKeyGuard` (tarea #21).
   *
   * RESTRICCIÓN `targetUserId` (tarea #21, hardening — hallazgo del
   * cybersecurity-engineer): sin esto, cualquier admin de condominio con el
   * permiso `auth.manage-service-tokens` podía mintear una API key para
   * OTRO usuario arbitrario vía `targetUserId` — incluyendo, en el peor
   * caso, un super-admin de la plataforma, obteniendo así una credencial de
   * máquina que actúa como esa cuenta. Ahora, si `targetUserId` difiere del
   * requester, se exige UNA de estas dos condiciones:
   *   1) El requester es "Super Administrador" (rol de plataforma,
   *      PLATFORM_SUPER_ADMIN_ROLE) — puede asignar keys cross-tenant.
   *   2) El target NO es super-admin Y pertenece a la MISMA organización
   *      (condominio) que el requester (resuelta vía membresía, igual que
   *      TenantContextService — ver tenant-context.util.ts).
   */
  async createServiceApiKey(requestingUser: User, dto: CreateServiceApiKeyDto) {
    try {
      const requestingUserId = requestingUser.id;
      const targetUserId = dto.targetUserId ?? requestingUserId;
      const targetUser = await this.usersService.findOne(targetUserId);

      if (targetUserId !== requestingUserId) {
        await this.assertCanAssignServiceApiKeyTo(requestingUser, targetUser);
      }

      const expiresIn =
        SERVICE_API_KEY_DURATIONS[
          dto.duration ?? DEFAULT_SERVICE_API_KEY_DURATION
        ];
      const organizationId = await this.resolveServiceKeyOrganizationId(
        requestingUser,
        targetUser,
      );
      if (!organizationId) {
        // Una key sin condominio no sirve para nada (ServiceApiKeyGuard
        // la rechaza): se corta acá, antes de emitirla.
        throw new BadRequestException(
          'La API key de servicio debe quedar vinculada a un condominio y no hay uno para esta emisión: emítela desde (o para) un usuario que pertenezca al condominio',
        );
      }

      const result = await this.betterAuthApi.createApiKey({
        body: {
          userId: targetUserId,
          name: dto.name,
          expiresIn,
          // Server-only (un cliente no puede fijarlos): el condominio
          // va en `permissions`, que es lo que lee ServiceApiKeyGuard.
          permissions: buildServiceKeyPermissions(organizationId),
          // Decisión de Benjamin (2026-10-08): sin el límite por key del
          // plugin (10 verificaciones / 24 h por defecto, ventana medida
          // desde el último request) el LPR no se corta en el request 11.
          // Solo para estas keys; el plugin conserva su default. La
          // protección por origen llega en la fase P4.
          rateLimitEnabled: false,
          // Solo trazabilidad: `metadata` la puede escribir un cliente,
          // así que NUNCA se usa para autorizar.
          metadata: {
            description: dto.description ?? 'Service API key',
            createdBy: requestingUserId,
            createdAt: new Date().toISOString(),
          },
        },
      });

      return {
        id: result.id,
        key: result.key, // Solo se muestra UNA VEZ — better-auth guarda solo el hash
        name: result.name,
        prefix: result.prefix,
        start: result.start,
        ownerUserId: targetUserId,
        ownerEmail: targetUser.email,
        organizationId,
        expiresAt: result.expiresAt,
        createdAt: result.createdAt,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      this.logger.error(
        'Error al crear la API key de servicio',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al crear la API key de servicio',
      );
    }
  }

  /**
   * Organización (condominio) a la que queda vinculada la key (en sus
   * `permissions`): la del solicitante. Un super-admin no tiene condominio
   * propio, así que se usa la del usuario dueño de la key (si tiene). `null`
   * = sin organización (la emisión responde 400).
   */
  private async resolveServiceKeyOrganizationId(
    requestingUser: User,
    targetUser: User,
  ): Promise<string | null> {
    const sourceUserId = isPlatformSuperAdmin(requestingUser)
      ? targetUser.id
      : requestingUser.id;
    return resolveOrganizationIdForUser(sourceUserId, this.dataSource);
  }

  /**
   * Revoca (deshabilita) una API key de servicio. Desde ese momento
   * `verifyApiKey` responde `KEY_DISABLED` y `ServiceApiKeyGuard` da 401. Es
   * la forma de cortar una key filtrada: las rutas de cliente
   * `/api/auth/api-key/*` están deshabilitadas. Idempotente: revocar una key
   * ya revocada responde igual.
   *
   * Autorización (misma base que la emisión, `managesOrganization`): el
   * condominio de la key (`permissions.org`) debe ser el del solicitante; un
   * super-admin revoca cualquiera. Si no, responde 404 igual que una key
   * inexistente, para no revelar que existe en otro condominio.
   *
   * `updateApiKey` se llama sin `headers` (llamada de servidor) y con
   * `userId` = dueño de la key: sin sesión, el plugin toma `body.userId` como
   * usuario y exige que coincida con el `referenceId` de la key.
   */
  async revokeServiceApiKey(
    requestingUser: User,
    keyId: string,
  ): Promise<RevokedServiceApiKey> {
    try {
      const key = await this.findServiceApiKey(keyId);
      if (
        !key ||
        !(await this.managesOrganization(requestingUser, key.organizationId))
      ) {
        throw new NotFoundException(SERVICE_API_KEY_NOT_FOUND_MESSAGE);
      }

      const updated = await this.betterAuthApi.updateApiKey({
        body: { keyId: key.id, userId: key.ownerUserId, enabled: false },
      });

      return {
        id: updated.id,
        name: updated.name ?? null,
        organizationId: key.organizationId,
        enabled: updated.enabled,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      // La key se borró entre la lectura y el update.
      if (
        error instanceof BetterAuthAPIError &&
        betterAuthErrorCode(error) === 'KEY_NOT_FOUND'
      ) {
        throw new NotFoundException(SERVICE_API_KEY_NOT_FOUND_MESSAGE);
      }
      this.logger.error(
        'Error al revocar la API key de servicio',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException(
        'Error al revocar la API key de servicio',
      );
    }
  }

  /**
   * Lee una key por id directo de la tabla `apikey` (el plugin usa su
   * `storage` por defecto, `'database'`). `auth.api.getApiKey` no sirve acá:
   * exige la sesión del dueño de la key.
   */
  private async findServiceApiKey(
    keyId: string,
  ): Promise<StoredServiceApiKey | null> {
    const rows = await this.dataSource.query<ServiceApiKeyRow[]>(
      `SELECT id, "referenceId", permissions FROM apikey WHERE id = $1 LIMIT 1`,
      [keyId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      ownerUserId: row.referenceId,
      organizationId: extractServiceKeyOrganizationId(
        parseStoredPermissions(row.permissions),
      ),
    };
  }

  /**
   * Actor de la política de condominio (`RoleAssignmentPolicy`, P5) a partir
   * del usuario solicitante. El condominio solo se resuelve si no es
   * super-admin (un super-admin no lo necesita).
   */
  private async policyActorOf(
    requestingUser: User,
  ): Promise<Pick<PolicyActor, 'isSuperAdmin' | 'organizationId'>> {
    if (isPlatformSuperAdmin(requestingUser)) {
      return { isSuperAdmin: true, organizationId: null };
    }
    return {
      isSuperAdmin: false,
      organizationId: await resolveOrganizationIdForUser(
        requestingUser.id,
        this.dataSource,
      ),
    };
  }

  /**
   * `true` si el solicitante administra el condominio `organizationId`: un
   * super-admin, todos; el resto, solo el suyo (por membresía). Es la base de
   * la emisión (`assertCanAssignServiceApiKeyTo`) y de la revocación. La
   * regla vive en `RoleAssignmentPolicy.managesOrganization` (P5).
   */
  private async managesOrganization(
    requestingUser: User,
    organizationId: string | null,
  ): Promise<boolean> {
    if (!organizationId && !isPlatformSuperAdmin(requestingUser)) {
      return false;
    }
    return managesOrganization(
      await this.policyActorOf(requestingUser),
      organizationId,
    );
  }

  /**
   * Ver docstring de `createServiceApiKey` para el detalle de la política
   * (regla "mismo condominio" de `RoleAssignmentPolicy.evaluateTargetUser`).
   * Lanza `ForbiddenException` (403) si el requester NO tiene permiso para
   * asignar la key a `targetUser`.
   */
  private async assertCanAssignServiceApiKeyTo(
    requestingUser: User,
    targetUser: User,
  ): Promise<void> {
    const actor = await this.policyActorOf(requestingUser);
    if (actor.isSuperAdmin) {
      return;
    }

    const targetIsSuperAdmin = isPlatformSuperAdmin(targetUser);
    const decision = evaluateTargetUser(actor, {
      isSuperAdmin: targetIsSuperAdmin,
      organizationId: targetIsSuperAdmin
        ? null
        : await resolveOrganizationIdForUser(targetUser.id, this.dataSource),
    });
    if (decision.allowed) {
      return;
    }
    throw new ForbiddenException(
      decision.reason === 'target-is-super-admin'
        ? 'No tiene permisos de plataforma para asignar una API key de servicio a una cuenta de super-administrador'
        : 'Solo puede asignar la API key de servicio a un usuario de su misma organización',
    );
  }
}
