import { BadRequestException, Injectable, UnauthorizedException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService as BetterAuthServiceBase } from '@thallesp/nestjs-better-auth';
import { APIError as BetterAuthAPIError } from 'better-auth/api';
import type { auth } from './better-auth';
import { UsersService } from 'src/users/users.service';
import { TokensService } from 'src/tokens/tokens.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { User } from 'src/users/entities/user.entity';
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
import { CreateServiceApiKeyDto } from './dto/create-service-api-key.dto';
import { hashPassword, checkPassword } from './utils/auth.util';
import { generateToken } from './utils/token.util';
import { AuthEmailService } from './services/auth-email.service';

// Duraciones soportadas por CreateServiceApiKeyDto, en segundos
// (`expiresIn` de auth.api.createApiKey). 'never' omite el campo por completo.
const SERVICE_API_KEY_DURATIONS: Record<string, number | undefined> = {
    '30d': 30 * 24 * 60 * 60,
    '90d': 90 * 24 * 60 * 60,
    '180d': 180 * 24 * 60 * 60,
    '365d': 365 * 24 * 60 * 60,
    never: undefined,
};

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
    constructor(
        private readonly usersService: UsersService,
        private readonly tokensService: TokensService,
        private readonly jwtService: JwtService,
        private readonly authEmailService: AuthEmailService,
        private readonly cloudinaryService: CloudinaryService,
        private readonly configService: ConfigService,
        // Tarea #18: llamadas server-side a better-auth (sin `headers`/sesión)
        // para requestPasswordReset/resetPassword/verifyEmail/sendVerificationEmail
        // /createApiKey. Disponible por DI porque BetterAuthModule.forRoot(...)
        // es global (app.module.ts) — mismo patrón que src/auth/auth.guard.ts.
        private readonly betterAuthService: BetterAuthServiceBase,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    /** `.api` tipado con los plugins de nuestro `auth` (ver `BetterAuthApi` arriba) — solo para llamadas plugin-specific (createApiKey). */
    private get betterAuthApi(): BetterAuthApi {
        return this.betterAuthService.api as unknown as BetterAuthApi;
    }

    /** URL del frontend para construir los `redirectTo`/`callbackURL` de better-auth (rutas aún no migradas — #20). */
    private get frontendUrl(): string {
        return this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
    }

    async register(registerDto: RegisterDto) {
        try {
            const { password, email, password_confirmation, ...restData } = registerDto;

            // Prevenir duplicados
            const userExists = await this.usersService.findByEmail(email);
            if (userExists) {
                throw new BadRequestException('El Usuario ya está registrado');
            }

            // Verificar que las contraseñas coincidan (validación adicional)
            if (password !== password_confirmation) {
                throw new BadRequestException('Las contraseñas no coinciden');
            }

            // Crear un usuario (excluir password_confirmation)
            const userData = {
                ...restData,
                password: await hashPassword(password),
                email: email.toLowerCase()
            };
            
            const user = await this.usersService.create(userData);

            // Generar el token
            const tokenValue = generateToken();
            await this.tokensService.create({ token: tokenValue, userId: user.id });

            // Enviar el email de confirmación con el nuevo template profesional
            await this.authEmailService.sendConfirmationEmail({
                email: user.email,
                name: user.name,
                token: tokenValue
            });

            return 'Cuenta creada exitosamente. Revisa tu email para confirmarla y activar todas las funcionalidades.';
        } catch (error) {
            if (error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al registrar el usuario');
        }
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

    async login(loginDto: LoginDto) {
        try {
            const { email, password } = loginDto;

            const user = await this.usersService.findByEmailWithPassword(email);
            if (!user) {
                throw new UnauthorizedException('Usuario No Encontrado');
            }

            if (!user.emailVerified) {
                // Tarea #18: activar la cuenta = establecer contraseña por
                // primera vez, que es el MISMO flujo que "olvidé mi
                // contraseña" vía better-auth (ver better-auth.ts
                // `sendResetPassword`, que distingue el copy del email con
                // `isNewAccount` sin necesitar un hook separado). Reemplaza
                // el token de 6 dígitos + sendAccountCreatedByAdminEmail.
                try {
                    await this.betterAuthService.api.requestPasswordReset({
                        body: {
                            email: user.email,
                            redirectTo: `${this.frontendUrl}/auth/new-password`,
                        },
                    });
                } catch (error) {
                    // No dejamos que un fallo de email/better-auth oculte el
                    // 401 esperado — se loguea para investigar aparte.
                    console.error('Error al solicitar activación de cuenta vía better-auth:', error);
                }

                throw new UnauthorizedException('Tu cuenta aún no ha sido activada. Hemos enviado un enlace a tu email para que establezcas tu contraseña y actives tu cuenta.');
            }

            // Revisar password (RESTRICCIÓN CRÍTICA tarea #18: user.password
            // se mantiene sincronizada con el hash de better-auth vía el
            // bridge de better-auth.ts, así que este camino JWT legacy sigue
            // funcionando sin cambios tras un reset/activación por better-auth)
            const isPasswordCorrect = await checkPassword(password, user.password);
            if (!isPasswordCorrect) {
                throw new UnauthorizedException('Password Incorrecto');
            }

            // Solo guardar IDs de roles en el JWT para evitar que sea muy grande
            const roleIds = user.roles?.map(role => role.id) || [];
            const payload = { id: user.id, email: user.email, name: user.name, roleIds };
            const jwtToken = this.jwtService.sign(payload);

            return jwtToken;
        } catch (error) {
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al procesar el login');
        }
    }

    /** Tarea #18: dispara `emailVerification.sendVerificationEmail` de better-auth en vez del código propio de 6 dígitos. */
    async requestConfirmationCode(requestConfirmationCodeDto: RequestConfirmationCodeDto) {
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

            return 'Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.'
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al solicitar código de confirmación');
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
            throw new InternalServerErrorException('Error al procesar recuperación de password');
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
            const rows: Array<{ exists: boolean }> = await this.userRepository.manager.query(
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
     * Tarea #18: dispara `resetPassword` de better-auth (token opaco de un
     * solo uso) en vez de la tabla Token propia. El bridge de sincronización
     * `user.password` (better-auth.ts, `emailAndPassword.onPasswordReset`)
     * corre DENTRO de la llamada de arriba — para cuando esta función retorna,
     * el login legacy ya ve el hash nuevo. Acá solo falta el side-effect
     * histórico: auto-confirmar la cuenta si no estaba verificada (mismo
     * comportamiento que el flujo Token propio tenía).
     */
    async updatePasswordWithToken(updatePasswordWithTokenDto: UpdatePasswordWithTokenDto) {
        try {
            const { token, password } = updatePasswordWithTokenDto;
            const identifier = `reset-password:${token}`;

            // Resolvemos el userId ANTES de resetear porque better-auth
            // CONSUME (borra) el registro de `verification` al resetear —
            // después no habría forma de saber a quién auto-confirmar.
            const verificationRows: Array<{ value: string }> = await this.userRepository.manager.query(
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

            await this.userRepository.update({ id: userId, emailVerified: false }, { emailVerified: true });

            return '¡Contraseña actualizada exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.';
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            console.error('Error al actualizar password con token:', error);
            throw new InternalServerErrorException('Error al actualizar password con token');
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
                    throw new BadRequestException('Ese e-mail ya está en uso');
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
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al actualizar el perfil');
        }
    }

    async updateCurrentUserPassword(userId: string, updateCurrentUserPasswordDto: UpdateCurrentUserPasswordDto) {
        try {
            const { current_password, password } = updateCurrentUserPasswordDto;

            const user = await this.usersService.findByIdWithPassword(userId);

            const isPasswordCorrect = await checkPassword(current_password, user.password);
            if (!isPasswordCorrect) {
                throw new BadRequestException('El Password Actual es incorrecto');
            }

            // Verificar que la nueva contraseña sea diferente a la actual
            const isSamePassword = await checkPassword(password, user.password);
            if (isSamePassword) {
                throw new BadRequestException('La nueva contraseña no puede ser igual a la actual');
            }

            user.password = await hashPassword(password);
            await this.usersService.save(user);

            return 'El password se modificó correctamente';
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al cambiar la contraseña');
        }
    }

    async checkPassword(userId: string, checkPasswordDto: CheckPasswordDto) {
        try {
            const { password } = checkPasswordDto;

            const user = await this.usersService.findByIdWithPassword(userId);

            const isPasswordCorrect = await checkPassword(password, user.password);
            if (!isPasswordCorrect) {
                throw new BadRequestException('Password Incorrecto');
            }

            return 'Password Correcto';
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al verificar la contraseña');
        }
    }

    async uploadProfilePicture(userId: string, file: Express.Multer.File) {
        try {
            if (!file) {
                throw new BadRequestException('No se proporcionó un archivo');
            }

            // Validar tipo de archivo
            const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
            if (!allowedTypes.includes(file.mimetype)) {
                throw new BadRequestException('Solo se permiten imágenes JPG, PNG o WEBP');
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
                    console.error('Error al eliminar imagen anterior:', error);
                }
            }

            // Actualizar usuario con nueva URL
            await this.usersService.update(userId, {
                profilePicture: result.secure_url,
            });

            return { url: result.secure_url };
        } catch (error) {
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            console.error('Error al subir imagen a Cloudinary:', error);
            throw new InternalServerErrorException('Error al subir la imagen de perfil');
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
                console.error('Error al eliminar imagen de Cloudinary:', error);
                // Continuar para eliminar de BD aunque falle en Cloudinary
            }

            // Actualizar usuario para remover URL
            await this.usersService.update(userId, {
                profilePicture: null,
            });

            return 'Foto de perfil eliminada exitosamente';
        } catch (error) {
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            console.error('Error al eliminar imagen de perfil:', error);
            throw new InternalServerErrorException('Error al eliminar la imagen de perfil');
        }
    }

    /**
     * @deprecated Tarea #18 (docs/modulos/auth-multitenant.md §10.3): el
     * service-token para credenciales de máquina (worker LPR) se resolvió con
     * el plugin `apiKey` de better-auth — ver `createServiceApiKey` abajo y
     * `POST /api/v1/auth/service-api-keys` en AuthController. Este método
     * queda huérfano (nada lo llama hoy — ni frontend ni el worker LPR, que
     * todavía no tiene su auth cableada, eso es hardening #21) y es candidato
     * a retiro completo en #21. Se deja funcionando por compatibilidad
     * mínima mientras tanto (JWT firmado con el mismo `JwtModule` del login
     * legacy — no confundir con las API keys nuevas, que son opacas y viven
     * en la tabla `apikey` de better-auth, no en JWT).
     */
    async createServiceToken(userId: string, duration: string = '365d', description?: string) {
        try {
            const user = await this.usersService.findOne(userId);
            if (!user) {
                throw new NotFoundException('Usuario no encontrado');
            }

            // Verificar que el usuario sea admin
            const isAdmin = user.roles?.some(role => role.name === 'Administrador' || role.name === 'Super Administrador');
            if (!isAdmin) {
                throw new UnauthorizedException('Solo administradores pueden generar tokens de servicio');
            }

            // Generar token de larga duración
            const roleIds = user.roles?.map(role => role.id) || [];
            const payload = {
                id: user.id,
                email: user.email,
                name: user.name,
                roleIds,
                isServiceToken: true,
                description: description || 'Service Token'
            };

            const serviceToken = this.jwtService.sign(payload, { expiresIn: duration });

            return {
                token: serviceToken,
                expiresIn: duration,
                description: description || 'Service Token',
                createdAt: new Date().toISOString()
            };
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof UnauthorizedException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al crear el token de servicio');
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
     * de better-auth, `apiKeyHeaders`) contra los endpoints que en el futuro
     * (#21, hardening de ingesta LPR) se protejan con el guard/plugin de
     * apiKey — NO se cablea ningún endpoint de ingesta en esta tarea.
     */
    async createServiceApiKey(requestingUserId: string, dto: CreateServiceApiKeyDto) {
        try {
            const targetUserId = dto.targetUserId ?? requestingUserId;
            const targetUser = await this.usersService.findOne(targetUserId);

            const expiresIn = SERVICE_API_KEY_DURATIONS[dto.duration ?? '365d'];

            const result = await this.betterAuthApi.createApiKey({
                body: {
                    userId: targetUserId,
                    name: dto.name,
                    ...(expiresIn !== undefined ? { expiresIn } : {}),
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
                expiresAt: result.expiresAt,
                createdAt: result.createdAt,
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            console.error('Error al crear la API key de servicio:', error);
            throw new InternalServerErrorException('Error al crear la API key de servicio');
        }
    }
}
