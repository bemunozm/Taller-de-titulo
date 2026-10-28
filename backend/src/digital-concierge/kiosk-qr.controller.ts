import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { HubType } from '../hub/entities/hub.entity';
import {
  HubAuthGuard,
  type AuthenticatedHub,
} from '../hub/guards/hub-auth.guard';
import { RedeemQrDto, RedeemQrResponseDto } from './dto/redeem-qr.dto';
import type { RedeemQrResponse } from './dto/redeem-qr.dto';
import { KioskQrService } from './services/kiosk-qr.service';

type KioskRequest = Request & { hub?: AuthenticatedHub };

/**
 * Canje del QR de una visita desde el kiosko web.
 *
 * `POST /api/v1/concierge/qr/redeem` con SOLO `HubAuthGuard` (headers
 * `X-Hub-Id` + `X-Hub-Secret`), igual que `GET /concierge/device`. Solo un hub
 * `web-kiosk` con condominio puede canjear: un hub físico o una sesión humana
 * no (401/403). Abre el acceso de forma determinista, sin el agente.
 */
@ApiTags('Conserje digital')
@Controller('concierge')
@UseGuards(HubAuthGuard)
export class KioskQrController {
  constructor(private readonly kioskQrService: KioskQrService) {}

  @Post('qr/redeem')
  @RateLimit('concierge-qr-redeem')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Canjear el QR de una visita desde el kiosko',
    description:
      'Valida el QR, verifica al anfitrión, registra la entrada y ordena la apertura a los hubs físicos del condominio. Responde 200 tanto al conceder como al denegar (sin PII).',
  })
  @ApiOkResponse({ type: RedeemQrResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Credencial de dispositivo inválida o ausente',
  })
  @ApiForbiddenResponse({
    description: 'El dispositivo no es un kiosko web con condominio',
  })
  redeem(
    @Req() req: KioskRequest,
    @Body() dto: RedeemQrDto,
  ): Promise<RedeemQrResponse> {
    const hub = req.hub;
    if (!hub) {
      // HubAuthGuard siempre puebla `req.hub`; llegar acá sería un bug.
      throw new UnauthorizedException(
        'Se requiere una credencial de dispositivo',
      );
    }
    if (hub.type !== HubType.WEB_KIOSK || !hub.organizationId) {
      throw new ForbiddenException(
        'Solo un kiosko web con condominio puede canjear un QR',
      );
    }
    return this.kioskQrService.redeem(
      { hubId: hub.hubId, organizationId: hub.organizationId },
      dto.qrCode,
    );
  }
}
