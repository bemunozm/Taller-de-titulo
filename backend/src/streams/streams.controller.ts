import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { StreamsService } from './streams.service';

import { AuthGuard } from 'src/auth/auth.guard';
import { AuthorizationGuard } from 'src/auth/guards/authorization.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CameraViewGuard } from 'src/cameras/guards/camera-view.guard';
import type { CameraViewRequest } from 'src/cameras/guards/camera-view.guard';
import { Auditable } from '../audit/decorators/auditable.decorator';
import { AuditModule, AuditAction } from '../audit/entities/audit-log.entity';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiServiceUnavailableResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { WhepOfferDto } from './dto/whep-offer.dto';
import { WhepAnswerDto } from './dto/whep-answer.dto';

@ApiTags('Gestión de Transmisiones')
@ApiBearerAuth('JWT-auth')
@Controller('streams')
@UseGuards(AuthGuard, AuthorizationGuard)
@ApiUnauthorizedResponse({ description: 'Token JWT inválido o expirado' })
export class StreamsController {
  private readonly logger = new Logger(StreamsController.name);

  constructor(private readonly streamsService: StreamsService) {}

  /**
   * NOTA: Este endpoint requiere el permiso 'streams.read' Y verificación
   * granular mediante CameraViewGuard que valida:
   * - Que la cámara es del condominio del usuario (si no, 404; P5.B)
   * - Que la cámara existe y está activa
   * - Que el usuario tiene acceso a la cámara específica según sus roles
   * - Que la cámara está registrada en MediaMTX
   *
   * Esta es una capa doble de seguridad:
   * 1. Permiso general para acceder al módulo de streaming
   * 2. Guard específico para validar acceso a la cámara individual
   */
  @Post('whep')
  @UseGuards(CameraViewGuard)
  @RequirePermissions('streams.read')
  @Auditable({
    module: AuditModule.STREAMS,
    action: AuditAction.READ,
    entityType: 'Stream',
    description: 'Usuario accedió a visualización de cámara mediante WHEP',
    captureRequest: false,
    captureResponse: false,
  })
  @ApiOperation({
    summary: 'Negociar oferta WHEP para streaming de cámara',
    description:
      'Recibe una oferta SDP WHEP del cliente, la reenvía a MediaMTX y devuelve la respuesta SDP. Requiere permiso streams.read y acceso específico a la cámara solicitada.',
  })
  @ApiBody({
    type: WhepOfferDto,
    description: 'Oferta SDP WHEP con identificador de cámara (mountPath o id)',
    examples: {
      ejemplo1: {
        value: {
          offer:
            'v=0\r\no=- 123456789 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n...',
          cameraMount: 'live/cam1',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '✅ Negociación WHEP exitosa - Respuesta SDP devuelta',
    type: WhepAnswerDto,
    schema: {
      example: {
        answer:
          'v=0\r\no=- 987654321 2 IN IP4 192.168.1.100\r\ns=-\r\nt=0 0\r\n...',
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      '❌ Datos de entrada inválidos o faltantes (cameraMount requerido)',
  })
  @ApiNotFoundResponse({
    description: '❌ Cámara no encontrada',
  })
  @ApiForbiddenResponse({
    description:
      '❌ Usuario no tiene permiso para ver esta cámara o falta el permiso streams.read',
  })
  @ApiServiceUnavailableResponse({
    description: '❌ Cámara inactiva o no registrada en MediaMTX',
  })
  async whep(@Body() body: WhepOfferDto, @Req() req: CameraViewRequest) {
    // Fase 4 · P5.B: se negocia con la cámara que AUTORIZÓ CameraViewGuard
    // (condominio, estado y roles), no con el string crudo del body. Si el
    // guard resolvió por id, `forwardOfferToMediaMtx` usa el mountPath de esa
    // cámara.
    const camera = req.authorizedCamera;
    if (!camera) {
      // Fail-closed: el handler no debe alcanzarse sin CameraViewGuard.
      throw new ForbiddenException('Cámara no autorizada');
    }
    this.logger.log(`📹 Negociando WHEP para cámara: ${camera.id}`);

    const answer = await this.streamsService.forwardOfferToMediaMtx(
      body.offer,
      camera.id,
    );

    this.logger.log(`✅ Negociación WHEP exitosa para cámara: ${camera.id}`);
    return { answer };
  }
}
