import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator';
import { MediamtxAuthService } from './mediamtx-auth.service';
import { MediamtxCallerGuard } from './mediamtx-caller.guard';

/**
 * Fase 4 · P6.M (D14): `POST /api/v1/internal/mediamtx/auth`, el
 * `authHTTPAddress` de MediaMTX (mediamtx/mediamtx.yml). Sin sesión humana:
 * quien llama es MediaMTX, que reenvía el Basic del backend (forward WHEP y
 * Control API) como `user`/`password`.
 *
 * Contrato con MediaMTX: 200 (sin cuerpo) = autorizado; cualquier otro código
 * = denegado. Toda denegación es un 401 genérico, también ante un cuerpo
 * inválido o un error de BD (fail-closed). El cuerpo se recibe como `unknown`
 * y lo valida el servicio (zod): así el `ValidationPipe` global no responde
 * 400 y nunca se refleja el contenido.
 *
 * Guards del método, en orden (corrección cyber P6):
 *  1. `MediamtxCallerGuard`: solo la IP del socket de MediaMTX
 *     (`MEDIAMTX_AUTH_ALLOWED_IPS`, default loopback) y sin headers de proxy;
 *  2. rate limit `mediamtx-auth` por IP. Como va DESPUÉS, una petición de
 *     internet no consume el contador que usa MediaMTX.
 * Además, el reverse proxy no debería exponer `/api/v1/internal/`.
 */
@ApiExcludeController()
@Controller('internal/mediamtx')
export class MediamtxAuthController {
  private readonly logger = new Logger(MediamtxAuthController.name);

  constructor(private readonly mediamtxAuthService: MediamtxAuthService) {}

  @Post('auth')
  @HttpCode(HttpStatus.OK)
  // `@RateLimit` ARRIBA de `@UseGuards`: los decoradores se aplican de abajo
  // hacia arriba y cada `UseGuards` agrega al final, así el throttler queda
  // después del guard de origen.
  @RateLimit('mediamtx-auth')
  @UseGuards(MediamtxCallerGuard)
  async authorize(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const decision = await this.mediamtxAuthService.authorize(body);
    if (decision.allowed) {
      return;
    }
    // Solo el motivo y la IP real de la conexión: nada del cuerpo (podría
    // traer el secreto o texto arbitrario).
    this.logger.warn(
      `Autorización de MediaMTX denegada: motivo=${decision.reason} ip=${req.socket?.remoteAddress ?? 'desconocida'}`,
    );
    throw new UnauthorizedException();
  }
}
