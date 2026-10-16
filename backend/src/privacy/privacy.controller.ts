import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditAction, AuditModule } from '../audit/entities/audit-log.entity';
import { PRIVACY_MANAGE_PERMISSION } from '../common/constants/default-permissions.constant';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { CurrentActor, type TenantActor } from '../common/tenant/tenant-actor';
import { PrivacyErasureDto } from './dto/privacy-erasure.dto';
import {
  PrivacyErasureService,
  type PrivacyErasureResult,
} from './privacy-erasure.service';

/**
 * Derechos de los titulares ejercidos por la administración (Fase 4 · P7.R,
 * Ley 21.719, docs/modulos/privacidad-ley-21719.md §4). Solo sesión humana
 * con `privacy.manage`.
 */
@ApiTags('Privacidad')
@Controller('privacy')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiBearerAuth('JWT-auth')
@ApiUnauthorizedResponse({ description: 'Sin sesión' })
export class PrivacyController {
  constructor(private readonly erasureService: PrivacyErasureService) {}

  @Post('erasure')
  @HttpCode(HttpStatus.OK)
  @RateLimit('privacy-erasure')
  @RequirePermissions(PRIVACY_MANAGE_PERMISSION)
  @Auditable({
    module: AuditModule.PRIVACY,
    action: AuditAction.DATA_ERASURE,
    entityType: 'PersonalData',
    description: 'Supresión de datos personales (Ley 21.719)',
    // La respuesta solo trae conteos: nunca el RUT ni la patente.
    captureRequest: false,
    captureResponse: true,
  })
  @ApiOperation({
    summary: 'Suprimir o anonimizar los datos de un titular',
    description:
      'Exactamente uno de `rut`, `plate` o `userId`. Con rut o patente anonimiza de inmediato, en el condominio del actor, ' +
      'las visitas y sesiones del conserje terminadas y las detecciones (con sus intentos e imágenes), y borra las ' +
      'notificaciones y acciones del agente que copian esos datos; lo vigente se informa en `skipped` y no se toca. ' +
      'Con `userId` anonimiza a un usuario deshabilitado sin esperar el plazo de retención. El super-admin indica ' +
      '`organizationId` con rut o patente. Requiere el permiso "privacy.manage". Límite: 20 por hora.',
  })
  @ApiResponse({
    status: 200,
    description: 'Conteos por categoría (nunca el identificador).',
  })
  @ApiBadRequestResponse({
    description:
      'No vino exactamente uno de rut/plate/userId, el identificador no es válido, o falta organizationId (super-admin)',
  })
  @ApiForbiddenResponse({
    description:
      'Sin "privacy.manage", organizationId enviado por quien no es super-admin, o usuario que el actor no puede administrar',
  })
  @ApiNotFoundResponse({ description: 'Usuario fuera del alcance del actor' })
  @ApiConflictResponse({ description: 'El usuario no está deshabilitado' })
  @ApiResponse({ status: 429, description: 'Demasiadas solicitudes' })
  erase(
    @Body() dto: PrivacyErasureDto,
    @CurrentActor() actor: TenantActor,
  ): Promise<PrivacyErasureResult> {
    return this.erasureService.erase(dto, actor);
  }
}
