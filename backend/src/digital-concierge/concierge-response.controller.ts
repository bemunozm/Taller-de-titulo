import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import {
  AuthorizedContextFactory,
  type AuthorizedContextRequest,
} from '../agent/authorized-context.factory';
import { DigitalConciergeService } from './services/digital-concierge.service';
import {
  RespondToVisitorDto,
  RespondToVisitorResponseDto,
} from './dto/respond-to-visitor.dto';
import { toHumanConciergeActor } from './concierge-actor';

type HumanRequest = Request & AuthorizedContextRequest;

/**
 * Respuesta a una solicitud de visita del conserje digital (Fase 4 · P4, D5).
 *
 * Misma URL que antes (`POST /api/v1/concierge/session/:sessionId/respond`),
 * pero fuera de `DigitalConciergeController`: aquel usa `ConciergeAuthGuard`,
 * que también admite credenciales de hub. Responder abre el portón, así que
 * solo lo hace una sesión humana (`AuthGuard`): un hub o kiosko con
 * credenciales válidas pero sin sesión de usuario recibe 401.
 *
 * Sin `AuthorizationGuard`: el Residente no tiene permisos de conserjería; la
 * autorización (pertenencia a `residentsNotified` o
 * `digital-concierge.manage`) la hace el servicio antes de escribir nada.
 */
@ApiTags('Conserje digital')
@Controller('concierge')
@UseGuards(AuthGuard)
export class ConciergeResponseController {
  private readonly logger = new Logger(ConciergeResponseController.name);

  constructor(
    private readonly conciergeService: DigitalConciergeService,
    private readonly authorizedContextFactory: AuthorizedContextFactory,
  ) {}

  @Post('session/:sessionId/respond')
  @RateLimit('concierge-respond')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aprobar o rechazar la solicitud de visita de una sesión',
    description:
      'Solo sesión humana. Autoriza a los residentes notificados y a quien tiene "digital-concierge.manage" en el condominio.',
  })
  @ApiOkResponse({ type: RespondToVisitorResponseDto })
  @ApiBadRequestResponse({
    description:
      'Body inválido (approved no booleano, visitId no UUID o campos extra)',
  })
  @ApiUnauthorizedResponse({ description: 'Sin sesión de usuario' })
  @ApiForbiddenResponse({
    description:
      'El usuario no puede responder esta sesión, o la sesión no tiene condominio',
  })
  @ApiConflictResponse({
    description:
      'La solicitud ya se respondió, la sesión no está activa, o visitId no es la solicitud vigente',
  })
  async respond(
    @Param('sessionId') sessionId: string,
    @Body() dto: RespondToVisitorDto,
    @Req() req: HumanRequest,
  ): Promise<RespondToVisitorResponseDto> {
    const responder = toHumanConciergeActor(
      this.authorizedContextFactory.fromRequest(req),
    );
    this.logger.log(
      `Respuesta a la sesión ${sessionId} (aprobada=${dto.approved}) por el usuario ${responder.userId}`,
    );

    return await this.conciergeService.respondToVisitor(
      sessionId,
      { approved: dto.approved, visitId: dto.visitId },
      responder,
    );
  }
}
