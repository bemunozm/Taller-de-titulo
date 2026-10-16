import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  HubAuthGuard,
  type AuthenticatedHub,
} from '../hub/guards/hub-auth.guard';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { ConciergeDeviceResponseDto } from './dto/session-status.dto';

type DeviceRequest = Request & { hub?: AuthenticatedHub };

/**
 * Identidad del dispositivo autenticado (Fase 4 · P4, D6).
 *
 * `GET /api/v1/concierge/device` con SOLO `HubAuthGuard` (headers
 * `X-Hub-Id` + `X-Hub-Secret`): el emparejamiento del kiosko lo usa para
 * validar la credencial y exigir `type = web-kiosk`. Sin credencial de hub →
 * 401. No va en `/hubs/me`, que chocaría con `GET /hubs/:hubId`.
 */
@ApiTags('Conserje digital')
@Controller('concierge')
@UseGuards(HubAuthGuard)
export class ConciergeDeviceController {
  @Get('device')
  @RateLimit('concierge-device')
  @ApiOperation({
    summary: 'Identidad del dispositivo (hub o kiosko) autenticado',
  })
  @ApiOkResponse({ type: ConciergeDeviceResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Credencial de dispositivo inválida o ausente',
  })
  getDevice(@Req() req: DeviceRequest): ConciergeDeviceResponseDto {
    const hub = req.hub;
    if (!hub) {
      // HubAuthGuard siempre puebla `req.hub`; llegar acá sería un bug.
      throw new UnauthorizedException(
        'Se requiere una credencial de dispositivo',
      );
    }
    return {
      hubId: hub.hubId,
      type: hub.type,
      organizationId: hub.organizationId,
    };
  }
}
