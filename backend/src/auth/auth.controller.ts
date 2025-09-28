import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Request, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiUnauthorizedResponse, ApiBadRequestResponse, ApiNotFoundResponse } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { AuthGuard } from "./auth.guard";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ConfirmAccountDto } from "./dto/confirm-account.dto";
import { RequestConfirmationCodeDto } from "./dto/request-confirmation-code.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ValidateTokenDto } from "./dto/validate-token.dto";
import { UpdatePasswordWithTokenDto } from "./dto/update-password-with-token.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { UpdateCurrentUserPasswordDto } from "./dto/update-current-user-password.dto";
import { CheckPasswordDto } from "./dto/check-password.dto";
import { AuthEmailService } from "./services/auth-email.service";

@ApiTags('Autenticación')
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authEmailService: AuthEmailService
  ) {}

  @Post("create-account")
  @ApiOperation({ 
    summary: 'Crear nueva cuenta de usuario',
    description: 'Registra un nuevo usuario en el sistema. El usuario debe confirmar su email antes de poder iniciar sesión.'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Cuenta creada exitosamente. Se envió un email de confirmación.',
    schema: {
      type: 'string',
      example: 'Cuenta creada exitosamente. Revisa tu email para confirmarla y activar todas las funcionalidades.'
    }
  })
  @ApiBadRequestResponse({ 
    description: 'Datos inválidos o email ya registrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El Usuario ya está registrado' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @ApiBody({ type: RegisterDto })
  createAccount(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post("confirm-account")
  @ApiOperation({
    summary: 'Confirmar cuenta de usuario',
    description: 'Confirma la cuenta del usuario usando el token de 6 dígitos enviado por email.'
  })
  @ApiResponse({
    status: 200,
    description: 'Cuenta confirmada exitosamente',
    schema: {
      type: 'string',
      example: '¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.'
    }
  })
  @ApiNotFoundResponse({
    description: 'Token no válido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no válido' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  @ApiBody({ type: ConfirmAccountDto })
  confirmAccount(@Body() confirmAccountDto: ConfirmAccountDto) {
    return this.authService.confirmAccount(confirmAccountDto);
  }

  @HttpCode(HttpStatus.OK)
  @Post("login")
  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Autentica al usuario con email y contraseña. Retorna un token JWT válido por 24 horas.'
  })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso',
    schema: {
      type: 'string',
      example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Credenciales inválidas o cuenta no confirmada',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          example: 'Tu cuenta no está confirmada. Hemos enviado un nuevo código de verificación a tu email.'
        },
        error: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'number', example: 401 }
      }
    }
  })
  @ApiBody({ type: LoginDto })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post("request-code")
  @ApiOperation({
    summary: 'Solicitar código de confirmación',
    description: 'Reenvía un nuevo código de confirmación al email del usuario. Solo funciona para cuentas no confirmadas.'
  })
  @ApiResponse({
    status: 200,
    description: 'Código enviado exitosamente',
    schema: {
      type: 'string',
      example: 'Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.'
    }
  })
  @ApiNotFoundResponse({
    description: 'Usuario no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El Usuario no existe' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Usuario ya confirmado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El Usuario ya está confirmado' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  })
  @ApiBody({ type: RequestConfirmationCodeDto })
  requestConfirmationCode(@Body() requestConfirmationCodeDto: RequestConfirmationCodeDto) {
    return this.authService.requestConfirmationCode(requestConfirmationCodeDto);
  }

  @Post("forgot-password")
  @ApiOperation({
    summary: 'Solicitar recuperación de contraseña',
    description: 'Inicia el proceso de recuperación de contraseña enviando un token por email.'
  })
  @ApiResponse({
    status: 200,
    description: 'Email de recuperación enviado',
    schema: {
      type: 'string',
      example: 'Instrucciones de recuperación enviadas. Revisa tu email para restablecer tu contraseña de forma segura.'
    }
  })
  @ApiNotFoundResponse({
    description: 'Usuario no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El Usuario no existe' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  @ApiBody({ type: ForgotPasswordDto })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post("validate-token")
  @ApiOperation({
    summary: 'Validar token de recuperación',
    description: 'Valida un token de recuperación de contraseña antes de permitir el cambio.'
  })
  @ApiResponse({
    status: 200,
    description: 'Token válido',
    schema: {
      type: 'string',
      example: 'Código verificado correctamente. Ahora puedes establecer tu nueva contraseña.'
    }
  })
  @ApiNotFoundResponse({
    description: 'Token inválido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no válido' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  @ApiBody({ type: ValidateTokenDto })
  validateToken(@Body() validateTokenDto: ValidateTokenDto) {
    return this.authService.validateToken(validateTokenDto);
  }

  @Post("update-password")
  @ApiOperation({
    summary: 'Actualizar contraseña con token',
    description: 'Establece una nueva contraseña usando un token de recuperación válido.'
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña actualizada exitosamente',
    schema: {
      type: 'string',
      example: '¡Contraseña actualizada exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.'
    }
  })
  @ApiNotFoundResponse({
    description: 'Token inválido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no válido' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  })
  @ApiBody({ type: UpdatePasswordWithTokenDto })
  updatePasswordWithToken(@Body() updatePasswordWithTokenDto: UpdatePasswordWithTokenDto) {
    return this.authService.updatePasswordWithToken(updatePasswordWithTokenDto);
  }

  @Get('user')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Obtener información del usuario actual',
    description: 'Retorna la información del usuario autenticado actualmente.'
  })
  @ApiResponse({
    status: 200,
    description: 'Información del usuario',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'uuid-123' },
        rut: { type: 'string', example: '12345678-9' },
        name: { type: 'string', example: 'Juan Pérez' },
        email: { type: 'string', example: 'juan@example.com' },
        phone: { type: 'string', example: '+56912345678' },
        age: { type: 'number', example: 25 },
        confirmed: { type: 'boolean', example: true },
        roles: { type: 'array', items: { type: 'object' } }
      }
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'number', example: 401 }
      }
    }
  })
  getUser(@Request() req) {
    return this.authService.getUser(req.user.id);
  }

  @Post('profile')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Actualizar perfil del usuario',
    description: 'Permite al usuario actualizar su información de perfil (nombre, teléfono, edad).'
  })
  @ApiResponse({
    status: 200,
    description: 'Perfil actualizado exitosamente',
    schema: {
      type: 'string',
      example: 'Perfil actualizado correctamente'
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado'
  })
  @ApiBody({ type: UpdateProfileDto })
  updateProfile(@Request() req, @Body() updateProfileDto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, updateProfileDto);
  }

  @Post('update-password')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Cambiar contraseña del usuario actual',
    description: 'Permite al usuario autenticado cambiar su contraseña proporcionando la actual y la nueva.'
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña actualizada exitosamente',
    schema: {
      type: 'string',
      example: 'Password actualizado correctamente'
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido, contraseña actual incorrecta o contraseñas no coinciden'
  })
  @ApiBody({ type: UpdateCurrentUserPasswordDto })
  updateCurrentUserPassword(@Request() req, @Body() updateCurrentUserPasswordDto: UpdateCurrentUserPasswordDto) {
    return this.authService.updateCurrentUserPassword(req.user.id, updateCurrentUserPasswordDto);
  }

  @Post('check-password')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Verificar contraseña actual',
    description: 'Verifica si la contraseña proporcionada coincide con la contraseña actual del usuario.'
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña verificada exitosamente',
    schema: {
      type: 'string',
      example: 'Password correcto'
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o contraseña incorrecta'
  })
  @ApiBody({ type: CheckPasswordDto })
  checkPassword(@Request() req, @Body() checkPasswordDto: CheckPasswordDto) {
    return this.authService.checkPassword(req.user.id, checkPasswordDto);
  }

  // Endpoint temporal para probar el envío de emails
  @Get('test-email')
  @ApiOperation({
    summary: 'Probar envío de email (solo desarrollo)',
    description: 'Endpoint temporal para probar la configuración del servicio de email.'
  })
  @ApiResponse({
    status: 200,
    description: 'Email de prueba enviado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Email de prueba enviado correctamente' }
      }
    }
  })
  async testEmail() {
    try {
      await this.authEmailService.sendConfirmationEmail({
        email: 'test@example.com',
        name: 'Usuario de Prueba',
        token: '123456'
      });
      return { message: 'Email de prueba enviado correctamente' };
    } catch (error) {
      return { error: 'Error al enviar email', details: error.message };
    }
  }
}