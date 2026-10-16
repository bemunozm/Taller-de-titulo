import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import {
  normalizeIp,
  parseMediamtxAuthAllowedIps,
} from '../../config/env.validation';

/**
 * Headers que agrega un reverse proxy. MediaMTX llama directo (sin proxy): si
 * vienen, la petición pasó por el proxy público y no es MediaMTX.
 */
const PROXY_HEADERS: readonly string[] = [
  'x-forwarded-for',
  'forwarded',
  'x-real-ip',
];

/** Request tal como la mira el guard. */
interface CallerRequest {
  headers: IncomingHttpHeaders;
  socket?: { remoteAddress?: string };
}

/**
 * ¿La petición viene de MediaMTX? La IP del SOCKET (no `req.ip`, que con
 * `TRUST_PROXY` sale de `X-Forwarded-For`) debe estar en la lista y no debe
 * traer headers de proxy.
 */
export function isAllowedMediamtxCaller(
  request: CallerRequest,
  allowedIps: ReadonlySet<string>,
): boolean {
  if (PROXY_HEADERS.some((header) => request.headers[header] !== undefined)) {
    return false;
  }
  const remote = request.socket?.remoteAddress;
  const ip = remote ? normalizeIp(remote) : null;
  return ip !== null && allowedIps.has(ip);
}

/**
 * Fase 4 · P6.M (corrección cyber): `POST /internal/mediamtx/auth` solo desde
 * MediaMTX (`MEDIAMTX_AUTH_ALLOWED_IPS`, default loopback). Va ANTES del
 * throttler (`@RateLimit` arriba de `@UseGuards(MediamtxCallerGuard)`): una
 * petición de internet se rechaza sin consumir el contador por IP que comparte
 * MediaMTX. 401 genérico, sin detalle; el rechazo se loguea en `debug` para no
 * llenar los logs si alguien lo martilla.
 */
@Injectable()
export class MediamtxCallerGuard implements CanActivate {
  private readonly logger = new Logger(MediamtxCallerGuard.name);
  private readonly allowedIps = parseMediamtxAuthAllowedIps(
    process.env.MEDIAMTX_AUTH_ALLOWED_IPS,
  );

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<CallerRequest>();
    if (isAllowedMediamtxCaller(request, this.allowedIps)) {
      return true;
    }
    this.logger.debug(
      'Petición al auth de MediaMTX desde un origen no permitido (IP o proxy): se rechaza',
    );
    throw new UnauthorizedException();
  }
}
