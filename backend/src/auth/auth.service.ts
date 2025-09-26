import { BadRequestException, Injectable, UnauthorizedException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from 'src/users/users.service';
import { TokensService } from 'src/tokens/tokens.service';
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
    ) {}

    async register(registerDto: RegisterDto) {
        try {
            const { password, email } = registerDto;

            // Prevenir duplicados
            const userExists = await this.usersService.findByEmail(email);
            if (userExists) {
                throw new BadRequestException('El Usuario ya está registrado');
            }

            // Crear un usuario
            const userData = {
                ...registerDto,
                password: await hashPassword(password),
                email: email.toLowerCase()
            };
            
            const user = await this.usersService.create(userData);

            // Generar el token
            const tokenValue = generateToken();
            await this.tokensService.create({ token: tokenValue, userId: user.id });

            // Enviar el email
            await this.authEmailService.sendConfirmationEmail({
                email: user.email,
                name: user.name,
                token: tokenValue
            });

            return { message: 'Cuenta creada, revisa tu email para confirmarla' };
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

            return { message: 'Cuenta confirmada correctamente' };
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
                const tokenValue = generateToken();
                await this.tokensService.create({ token: tokenValue, userId: user.id });

                // Enviar el email
                await this.authEmailService.sendConfirmationEmail({
                    email: user.email,
                    name: user.name,
                    token: tokenValue
                });

                throw new UnauthorizedException('La Cuenta no ha sido confirmada, hemos enviado un e-mail de confirmación');
            }

            // Revisar password
            const isPasswordCorrect = await checkPassword(password, user.password);
            if (!isPasswordCorrect) {
                throw new UnauthorizedException('Password Incorrecto');
            }

            const payload = { id: user.id };
            const jwtToken = this.jwtService.sign(payload);

            return { token: jwtToken };
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

            // Enviar el email
            await this.authEmailService.sendConfirmationEmail({
                email: user.email,
                name: user.name,
                token: tokenValue
            });

            return { message: 'Se envió un nuevo token a tu e-mail' };
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

            // Enviar el email
            await this.authEmailService.sendPasswordResetToken({
                email: user.email,
                name: user.name,
                token: tokenValue
            });

            return { message: 'Revisa tu email para instrucciones' };
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

            return { message: 'Token válido, Define tu nuevo password' };
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

            const tokenExists = await this.tokensService.findByTokenWithUser(token);
            if (!tokenExists) {
                throw new NotFoundException('Token no válido');
            }

            const user = tokenExists.user;
            user.password = await hashPassword(password);

            await this.usersService.save(user);
            await this.tokensService.remove(tokenExists.id);

            return { message: 'El password se modificó correctamente' };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
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
            const { name, email } = updateProfileDto;

            const userExists = await this.usersService.findByEmail(email);
            if (userExists && userExists.id !== userId) {
                throw new BadRequestException('Ese e-mail ya está en uso');
            }

            const user = await this.usersService.findOne(userId);
            user.name = name;
            user.email = email.toLowerCase();

            await this.usersService.save(user);
            return { message: 'Perfil actualizado correctamente' };
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

            user.password = await hashPassword(password);
            await this.usersService.save(user);

            return { message: 'El password se modificó correctamente' };
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

            return { message: 'Password Correcto' };
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof BadRequestException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al verificar la contraseña');
        }
    }
}
