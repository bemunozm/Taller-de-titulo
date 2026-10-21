import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Request,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiForbiddenResponse,
  ApiConsumes,
  ApiParam,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { User } from '../users/entities/user.entity';
import { AuthService, type RevokedServiceApiKey } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthorizationGuard } from './guards/authorization.guard';
import { RequirePermissions } from './decorators/permissions.decorator';
import { ConfirmAccountDto } from './dto/confirm-account.dto';
import { RequestConfirmationCodeDto } from './dto/request-confirmation-code.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { UpdatePasswordWithTokenDto } from './dto/update-password-with-token.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateCurrentUserPasswordDto } from './dto/update-current-user-password.dto';
import { CheckPasswordDto } from './dto/check-password.dto';
import { CreateServiceApiKeyDto } from './dto/create-service-api-key.dto';
import { buildBetterAuthHeaders } from './middleware/client-ip.middleware';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import {
  DataExportService,
  dataExportFileName,
  type PersonalDataExport,
} from '../privacy/data-export.service';

/** Request de una ruta con `AuthGuard`: `user` es el User de TypeORM con sus roles. */
type AuthenticatedRequest = ExpressRequest & { user: User };

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly dataExportService: DataExportService,
  ) {}

  @Post('confirm-account')
  @RateLimit('auth-public')
  @ApiOperation({
    summary: 'Confirmar cuenta de usuario',
    description:
      'Confirma la cuenta del usuario usando el token de 6 dígitos enviado por email.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cuenta confirmada exitosamente',
    schema: {
      type: 'string',
      example:
        '¡Cuenta confirmada exitosamente! Ahora puedes acceder a todas las funcionalidades de la plataforma.',
    },
  })
  @ApiNotFoundResponse({
    description: 'Token no válido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no válido' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  @ApiBody({ type: ConfirmAccountDto })
  confirmAccount(@Body() confirmAccountDto: ConfirmAccountDto) {
    return this.authService.confirmAccount(confirmAccountDto);
  }

  @Post('request-code')
  @RateLimit('auth-public')
  @ApiOperation({
    summary: 'Solicitar código de confirmación',
    description:
      'Reenvía un nuevo código de confirmación al email del usuario. Solo funciona para cuentas no confirmadas.',
  })
  @ApiResponse({
    status: 200,
    description: 'Código enviado exitosamente',
    schema: {
      type: 'string',
      example:
        'Nuevo código de verificación enviado. Revisa tu email y completa la confirmación de tu cuenta.',
    },
  })
  @ApiNotFoundResponse({
    description: 'Usuario no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El Usuario no existe' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Usuario ya confirmado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El Usuario ya está confirmado' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 },
      },
    },
  })
  @ApiBody({ type: RequestConfirmationCodeDto })
  requestConfirmationCode(
    @Body() requestConfirmationCodeDto: RequestConfirmationCodeDto,
  ) {
    return this.authService.requestConfirmationCode(requestConfirmationCodeDto);
  }

  @Post('forgot-password')
  @RateLimit('auth-public')
  @ApiOperation({
    summary: 'Solicitar recuperación de contraseña',
    description:
      'Inicia el proceso de recuperación de contraseña vía better-auth (tarea #18). ' +
      'Por diseño (anti-enumeración) SIEMPRE responde 200 con un mensaje genérico, exista o no el email.',
  })
  @ApiResponse({
    status: 200,
    description: 'Respuesta genérica (no revela si el email existe)',
    schema: {
      type: 'string',
      example:
        'Si el correo existe en nuestro sistema, revisa tu email para restablecer tu contraseña de forma segura.',
    },
  })
  @ApiBody({ type: ForgotPasswordDto })
  forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('validate-token')
  @RateLimit('auth-token-validate')
  @ApiOperation({
    summary: 'Validar token de recuperación',
    description:
      'Valida un token de recuperación de contraseña antes de permitir el cambio.',
  })
  @ApiResponse({
    status: 200,
    description: 'Token válido',
    schema: {
      type: 'string',
      example:
        'Código verificado correctamente. Ahora puedes establecer tu nueva contraseña.',
    },
  })
  @ApiNotFoundResponse({
    description: 'Token inválido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no válido' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  @ApiBody({ type: ValidateTokenDto })
  validateToken(@Body() validateTokenDto: ValidateTokenDto) {
    return this.authService.validateToken(validateTokenDto);
  }

  @Post('reset-password')
  @RateLimit('auth-public')
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.PASSWORD_RESET,
    entityType: 'User',
    description: 'Contraseña restablecida mediante token de recuperación',
    captureRequest: false,
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Restablecer contraseña con token',
    description:
      'Establece una nueva contraseña usando un token de recuperación válido.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña actualizada exitosamente',
    schema: {
      type: 'string',
      example:
        '¡Contraseña actualizada exitosamente! Ya puedes iniciar sesión con tu nueva contraseña.',
    },
  })
  @ApiNotFoundResponse({
    description: 'Token inválido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no válido' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 },
      },
    },
  })
  @ApiBody({ type: UpdatePasswordWithTokenDto })
  updatePasswordWithToken(
    @Body() updatePasswordWithTokenDto: UpdatePasswordWithTokenDto,
  ) {
    return this.authService.updatePasswordWithToken(updatePasswordWithTokenDto);
  }

  @Get('user')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Obtener información del usuario actual',
    description: 'Retorna la información del usuario autenticado actualmente.',
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
        emailVerified: { type: 'boolean', example: true },
        roles: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'number', example: 401 },
      },
    },
  })
  getUser(@Request() req: AuthenticatedRequest) {
    return this.authService.getUser(req.user.id);
  }

  /**
   * Fase 4 · P7.R (Ley 21.719 arts. 5 y 9, acceso y portabilidad;
   * docs/modulos/privacidad-ley-21719.md §4): el titular descarga sus datos
   * como un archivo JSON. Solo sesión humana (`AuthGuard` no acepta API keys)
   * y solo los datos propios. Forma exacta: `PersonalDataExport`.
   */
  @Get('me/data-export')
  @RateLimit('privacy-data-export')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.PRIVACY,
    action: AuditAction.DATA_EXPORT,
    entityType: 'User',
    description: 'Titular descargó sus datos personales',
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Descargar mis datos (Ley 21.719)',
    description:
      'Devuelve un JSON descargable (Content-Disposition: attachment; filename="vigilia-mis-datos-<YYYY-MM-DD>.json") con el perfil, la familia, los vehículos propios, las visitas que el usuario creó (de los visitantes, solo el nombre) y sus notificaciones (sin el contenido, que copia datos de terceros). Límite: 5 por hora.',
  })
  @ApiResponse({
    status: 200,
    description: 'Archivo JSON con los datos del titular',
  })
  @ApiUnauthorizedResponse({ description: 'Sin sesión' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  async exportMyData(
    @Request() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
  ): Promise<PersonalDataExport> {
    const data = await this.dataExportService.exportForUser(req.user.id);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${dataExportFileName(data.generatedAt)}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  @Post('profile')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario actualizó su perfil',
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Actualizar perfil del usuario',
    description:
      'Permite al usuario actualizar su información de perfil (nombre, teléfono, edad).',
  })
  @ApiResponse({
    status: 200,
    description: 'Perfil actualizado exitosamente',
    schema: {
      type: 'string',
      example: 'Perfil actualizado correctamente',
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado',
  })
  @ApiBody({ type: UpdateProfileDto })
  updateProfile(
    @Request() req: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(req.user.id, updateProfileDto);
  }

  @Post('update-password')
  @RateLimit('auth-password')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.PASSWORD_CHANGE,
    entityType: 'User',
    description: 'Usuario cambió su contraseña',
    captureRequest: false,
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Cambiar contraseña del usuario actual',
    description:
      'Cambia la contraseña de login (credencial de better-auth) proporcionando la actual y la nueva. ' +
      'Cierra todas las demás sesiones; la sesión actual se renueva (nueva cookie en la respuesta).',
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña actualizada exitosamente',
    schema: {
      type: 'string',
      example: 'Password actualizado correctamente',
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'Token inválido, contraseña actual incorrecta o contraseñas no coinciden',
  })
  @ApiBody({ type: UpdateCurrentUserPasswordDto })
  async updateCurrentUserPassword(
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) res: ExpressResponse,
    @Body() updateCurrentUserPasswordDto: UpdateCurrentUserPasswordDto,
  ): Promise<string> {
    const { message, setCookieHeaders } =
      await this.authService.updateCurrentUserPassword(
        updateCurrentUserPasswordDto,
        buildBetterAuthHeaders(req),
      );
    // better-auth revocó todas las sesiones y abrió una nueva: sin reenviar su
    // cookie, el usuario quedaría deslogueado en su próximo request.
    if (setCookieHeaders.length > 0) {
      res.append('Set-Cookie', setCookieHeaders);
    }
    return message;
  }

  @Post('check-password')
  @RateLimit('auth-password')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Verificar contraseña actual',
    description:
      'Verifica si la contraseña proporcionada coincide con la contraseña actual del usuario.',
  })
  @ApiResponse({
    status: 200,
    description: 'Contraseña verificada exitosamente',
    schema: {
      type: 'string',
      example: 'Password correcto',
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o contraseña incorrecta',
  })
  @ApiBody({ type: CheckPasswordDto })
  checkPassword(
    @Req() req: ExpressRequest,
    @Body() checkPasswordDto: CheckPasswordDto,
  ): Promise<string> {
    return this.authService.checkPassword(
      checkPasswordDto,
      buildBetterAuthHeaders(req),
    );
  }

  @Post('upload-profile-picture')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
      },
    }),
  )
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.USERS,
    action: AuditAction.UPDATE,
    entityType: 'User',
    description: 'Usuario actualizó su foto de perfil',
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Subir foto de perfil',
    description:
      'Permite al usuario subir o actualizar su foto de perfil. La imagen se optimiza y almacena en Cloudinary.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Archivo de imagen (JPG, PNG, etc.)',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Foto de perfil actualizada exitosamente',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', example: 'https://res.cloudinary.com/...' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado',
  })
  @ApiBadRequestResponse({
    description: 'No se proporcionó un archivo o el formato no es válido',
  })
  uploadProfilePicture(
    @Request() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
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
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Eliminar foto de perfil',
    description:
      'Elimina la foto de perfil del usuario de Cloudinary y la base de datos.',
  })
  @ApiResponse({
    status: 200,
    description: 'Foto de perfil eliminada exitosamente',
    schema: {
      type: 'string',
      example: 'Foto de perfil eliminada exitosamente',
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Token inválido o expirado',
  })
  deleteProfilePicture(@Request() req: AuthenticatedRequest) {
    return this.authService.deleteProfilePicture(req.user.id);
  }

  @Post('service-api-keys')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('auth.manage-service-tokens')
  @ApiBearerAuth()
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.CREATE,
    entityType: 'ApiKey',
    description: 'API key de servicio creada (better-auth apiKey plugin)',
    captureResponse: false,
    captureRequest: true,
  })
  @ApiOperation({
    summary:
      'Crear API key de servicio para credenciales de máquina (Solo Admin)',
    description:
      'Tarea #18 (docs/modulos/auth-multitenant.md §10.3): genera una API key vía el plugin ' +
      '`apiKey` de better-auth, pensada para el worker LPR y otros servicios automatizados. ' +
      'El worker debe enviarla en el header `x-api-key` en cada request (default de better-auth). ' +
      'La key en texto plano SOLO se muestra en esta respuesta — better-auth solo guarda su hash. ' +
      'La key queda vinculada al condominio del solicitante (o del dueño, si emite un super-admin) y sin límite de requests por key. ' +
      'Requiere el permiso "auth.manage-service-tokens".',
  })
  @ApiResponse({
    status: 201,
    description: 'API key creada exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'apikey-uuid-123' },
        key: {
          type: 'string',
          example: 'ta_live_abc123...',
          description: 'Copiar ahora — no se vuelve a mostrar',
        },
        name: { type: 'string', example: 'LPR Worker Manager' },
        prefix: { type: 'string', example: 'ta_live_', nullable: true },
        start: { type: 'string', example: 'ta_live_ab', nullable: true },
        ownerUserId: { type: 'string', format: 'uuid' },
        ownerEmail: { type: 'string', example: 'admin@example.com' },
        organizationId: {
          type: 'string',
          format: 'uuid',
          description: 'Condominio al que queda vinculada la key',
        },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Token inválido o expirado' })
  @ApiForbiddenResponse({
    description:
      'No tiene el permiso "auth.manage-service-tokens", o intenta asignar la key a un usuario ' +
      'fuera de su organización o a una cuenta de super-administrador',
  })
  @ApiNotFoundResponse({
    description: 'El usuario dueño de la key (targetUserId) no existe',
  })
  @ApiBadRequestResponse({
    description:
      'No hay condominio para vincular la key: el solicitante (o, si es super-admin, el dueño) no pertenece a ninguno',
  })
  @ApiBody({ type: CreateServiceApiKeyDto })
  createServiceApiKey(
    @Request() req: AuthenticatedRequest,
    @Body() createServiceApiKeyDto: CreateServiceApiKeyDto,
  ) {
    return this.authService.createServiceApiKey(
      req.user,
      createServiceApiKeyDto,
    );
  }

  @Post('service-api-keys/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermissions('auth.manage-service-tokens')
  @ApiBearerAuth('JWT-auth')
  @Auditable({
    module: AuditModule.AUTH,
    action: AuditAction.UPDATE,
    entityType: 'ApiKey',
    description: 'API key de servicio revocada',
    captureRequest: false,
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Revocar una API key de servicio (Solo Admin)',
    description:
      'Deshabilita la key: desde ese momento los endpoints del worker LPR la rechazan con 401. ' +
      'No se puede reactivar; para seguir operando, emite una key nueva. ' +
      'Solo se pueden revocar keys del propio condominio (un super-admin puede revocar cualquiera). ' +
      'Requiere el permiso "auth.manage-service-tokens".',
  })
  @ApiParam({ name: 'id', description: 'ID de la API key', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'API key revocada (la operación es idempotente)',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'LPR Worker Manager', nullable: true },
        organizationId: { type: 'string', format: 'uuid', nullable: true },
        enabled: { type: 'boolean', example: false },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Sesión inválida o expirada' })
  @ApiForbiddenResponse({
    description: 'No tiene el permiso "auth.manage-service-tokens"',
  })
  @ApiNotFoundResponse({
    description: 'La key no existe o pertenece a otro condominio',
  })
  @ApiBadRequestResponse({ description: 'El id no es un UUID' })
  revokeServiceApiKey(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RevokedServiceApiKey> {
    return this.authService.revokeServiceApiKey(req.user, id);
  }
}
