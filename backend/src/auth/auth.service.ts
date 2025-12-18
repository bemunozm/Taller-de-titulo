import { BadRequestException, Injectable, UnauthorizedException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { TokensService } from 'src/tokens/tokens.service';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
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
import { hashPassword, checkPassword } from './utils/auth.util';
import { generateToken } from './utils/token.util';
import { AuthEmailService } from './services/auth-email.service';

@Injectable()
export class AuthService {
    constructor(
        private readonly usersService: UsersService,
        private readonly tokensService: TokensService,
        private readonly jwtService: JwtService,
        private readonly authEmailService: AuthEmailService,
        private readonly cloudinaryService: CloudinaryService,
    ) {}

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

    async confirmAccount(confirmAccountDto: ConfirmAccountDto) {
        try {
            const { token } = confirmAccountDto;

            const tokenExists = await this.tokensService.findByTokenWithUser(token);
            if (!tokenExists) {
                throw new NotFoundException('Token no válido');
            }

            const user = tokenExists.user;
            user.confirmed = true;

            await this.usersService.save(user);
            await this.tokensService.remove(tokenExists.id);

            // Enviar email de bienvenida después de confirmar la cuenta
            await this.authEmailService.sendWelcomeEmail({
                email: user.email,
                name: user.name
            });

            return '¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.'
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
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

            if (!user.confirmed) {
                // Generar token de establecer contraseña (no solo de confirmación)
                const tokenValue = generateToken();
                await this.tokensService.create({ token: tokenValue, userId: user.id });

                // Enviar email para establecer contraseña (que también confirmará la cuenta)
                await this.authEmailService.sendAccountCreatedByAdminEmail(user, tokenValue);

                throw new UnauthorizedException('Tu cuenta aún no ha sido activada. Hemos enviado un enlace a tu email para que establezcas tu contraseña y actives tu cuenta.');
            }

            // Revisar password
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

    async requestConfirmationCode(requestConfirmationCodeDto: RequestConfirmationCodeDto) {
        try {
            const { email } = requestConfirmationCodeDto;

            // Usuario existe
            const user = await this.usersService.findByEmail(email);
            if (!user) {
                throw new NotFoundException('El Usuario no existe');
            }

            if (user.confirmed) {
                throw new BadRequestException('El Usuario ya está confirmado');
            }

            // Generar el token
            const tokenValue = generateToken();
            await this.tokensService.create({ token: tokenValue, userId: user.id });

            // Enviar email con el template profesional de confirmación
            await this.authEmailService.sendConfirmationEmail({
                email: user.email,
                name: user.name,
                token: tokenValue
            });

            return 'Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.'
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al solicitar código de confirmación');
        }
    }

    async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
        try {
            const { email } = forgotPasswordDto;

            // Usuario existe
            const user = await this.usersService.findByEmail(email);
            if (!user) {
                throw new NotFoundException('El Usuario no existe');
            }

            // Generar el token
            const tokenValue = generateToken();
            await this.tokensService.create({ token: tokenValue, userId: user.id });

            // Enviar email con el template profesional de recuperación de contraseña
            await this.authEmailService.sendPasswordResetToken({
                email: user.email,
                name: user.name,
                token: tokenValue
            });

            return 'Instrucciones de recuperación enviadas. Revisa tu email para restablecer tu contraseña de forma segura.';
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al procesar recuperación de password');
        }
    }

    async validateToken(validateTokenDto: ValidateTokenDto) {
        try {
            const { token } = validateTokenDto;

            const tokenExists = await this.tokensService.findByToken(token);
            if (!tokenExists) {
                throw new NotFoundException('Token no válido');
            }

            return 'Código verificado correctamente. Ahora puedes establecer tu nueva contraseña.';
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al validar el token');
        }
    }

    async updatePasswordWithToken(updatePasswordWithTokenDto: UpdatePasswordWithTokenDto) {
        try {
            const { token, password } = updatePasswordWithTokenDto;
            console.log('Received token:', token);
            console.log('Received password:', password);
            const tokenExists = await this.tokensService.findByTokenWithUser(token);
            if (!tokenExists) {
                throw new NotFoundException('Token no válido');
            }

            // Cargar el usuario completo con password para poder guardarlo correctamente
            const user = await this.usersService.findByIdWithPassword(tokenExists.user.id);
            
            // Verificar que la nueva contraseña sea diferente a la actual
            const isSamePassword = await checkPassword(password, user.password);
            if (isSamePassword) {
                throw new BadRequestException('La nueva contraseña no puede ser igual a la actual');
            }

            user.password = await hashPassword(password);
            
            // Si la cuenta no está confirmada, confirmarla automáticamente
            if (!user.confirmed) {
                user.confirmed = true;
                console.log('Cuenta confirmada automáticamente al restablecer contraseña');
            }

            await this.usersService.save(user);
            await this.tokensService.remove(tokenExists.id);

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
}
