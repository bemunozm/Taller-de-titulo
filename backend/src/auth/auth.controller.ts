import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Request, UseGuards, UseInterceptors, UploadedFile } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiUnauthorizedResponse, ApiBadRequestResponse, ApiNotFoundResponse, ApiConsumes } from "@nestjs/swagger";
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
import { CreateServiceTokenDto } from "./dto/create-service-token.dto";
import { AuthEmailService } from "./services/auth-email.service";
import { Auditable } from "../audit/decorators/auditable.decorator";
import { AuditModule, AuditAction } from "../audit/entities/audit-log.entity";

@ApiTags('Autenticación')
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authEmailService: AuthEmailService
  ) {}

  // ENDPOINT DESHABILITADO: Los usuarios solo pueden ser creados por administradores
  // @Post("create-account")
  // @Auditable({
  //   module: AuditModule.AUTH,
  //   action: AuditAction.CREATE,
  //   entityType: 'User',
  //   description: 'Nueva cuenta de usuario registrada',
  //   captureResponse: true,
  //   captureRequest: false
  // })
  // @ApiOperation({ 
  //   summary: 'Crear nueva cuenta de usuario',
  //   description: 'Registra un nuevo usuario en el sistema. El usuario debe confirmar su email antes de poder iniciar sesión.'
  // })
  // @ApiResponse({ 
  //   status: 201, 
  //   description: 'Cuenta creada exitosamente. Se envió un email de confirmación.',
  //   schema: {
  //     type: 'string',
  //     example: 'Cuenta creada exitosamente. Revisa tu email para confirmarla y activar todas las funcionalidades.'
  //   }
  // })
  // @ApiBadRequestResponse({ 
  //   description: 'Datos inválidos o email ya registrado',
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       message: { type: 'string', example: 'El Usuario ya está registrado' },
  //       error: { type: 'string', example: 'Bad Request' },
  //       statusCode: { type: 'number', example: 400 }
  //     }
  //   }
  // })
  // @ApiBody({ type: RegisterDto })
  // createAccount(@Body() registerDto: RegisterDto) {
  //   return this.authService.register(registerDto);
  // }

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
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.LOGIN,
    entityType: 'User',
    description: 'Usuario inició sesión',
    captureRequest: true,
    captureResponse: false
  })
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

  @Post("reset-password")
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.PASSWORD_RESET,
    entityType: 'User',
    description: 'Contraseña restablecida mediante token de recuperación',
    captureRequest: false,
    captureResponse: false
  })
  @ApiOperation({
    summary: 'Restablecer contraseña con token',
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
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario actualizó su perfil',
    captureResponse: false
  })
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
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario cambió su contraseña',
    captureRequest: false,
    captureResponse: false
  })
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

  @Post('upload-profile-picture')
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  }))
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario actualizó su foto de perfil',
    captureResponse: false
  })
  @ApiOperation({
    summary: 'Subir foto de perfil',
    description: 'Permite al usuario subir o actualizar su foto de perfil. La imagen se optimiza y almacena en Cloudinary.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo de imagen (JPG, PNG, etc.)'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Foto de perfil actualizada exitosamente',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', example: 'https://res.cloudinary.com/...' }
      }
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado'
  })
  @ApiBadRequestResponse({
    description: 'No se proporcionó un archivo o el formato no es válido'
  })
  uploadProfilePicture(@Request() req, @UploadedFile() file: Express.Multer.File) {
    return this.authService.uploadProfilePicture(req.user.id, file);
  }

  @Delete('delete-profile-picture')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario eliminó su foto de perfil',
    captureResponse: false
  })
  @ApiOperation({
    summary: 'Eliminar foto de perfil',
    description: 'Elimina la foto de perfil del usuario de Cloudinary y la base de datos.'
  })
  @ApiResponse({
    status: 200,
    description: 'Foto de perfil eliminada exitosamente',
    schema: {
      type: 'string',
      example: 'Foto de perfil eliminada exitosamente'
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado'
  })
  deleteProfilePicture(@Request() req) {
    return this.authService.deleteProfilePicture(req.user.id);
  }

  @Post("create-service-token")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.CREATE,
    entityType: 'ServiceToken',
    description: 'Token de servicio de larga duración creado',
    captureResponse: false,
    captureRequest: true
  })
  @ApiOperation({
    summary: 'Crear token de servicio de larga duración (Solo Admin)',
    description: 'Genera un JWT con mayor duración para servicios automatizados. Solo disponible para administradores.'
  })
  @ApiResponse({
    status: 200,
    description: 'Token de servicio creado exitosamente',
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
        expiresIn: { type: 'string', example: '365d' },
        description: { type: 'string', example: 'Token para LPR Worker Manager' },
        createdAt: { type: 'string', example: '2025-12-07T21:30:00.000Z' }
      }
    }
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido, expirado o usuario sin permisos de administrador'
  })
  @ApiBody({ type: CreateServiceTokenDto })
  createServiceToken(@Request() req, @Body() createServiceTokenDto: CreateServiceTokenDto) {
    const { duration, description } = createServiceTokenDto;
    return this.authService.createServiceToken(req.user.id, duration, description);
  }
}
