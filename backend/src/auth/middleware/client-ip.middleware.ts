import type { IncomingHttpHeaders } from 'http';
import type { NextFunction, Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';

/**
 * IP real del cliente para better-auth (Fase 4 · P2, hallazgo M1).
 *
 * better-auth toma la IP (rate limit, `session.ipAddress`) de un header y no
 * conoce `trust proxy` de Express: con su default (`x-forwarded-for`) solo
 * acepta un valor único, así que detrás de un proxy queda sin IP y cualquier
 * cliente puede elegir la suya enviando el header. Este módulo deja como única
 * fuente `x-client-ip = req.ip`, que Express calcula respetando `TRUST_PROXY`
 * (ver main.ts), y borra antes los headers de IP que manda el cliente.
 *
 * better-auth.ts lo usa con `advanced.ipAddress.ipAddressHeaders`.
 */
export const CLIENT_IP_HEADER = 'x-client-ip';

/** Headers de IP que un cliente puede falsificar; nunca llegan a better-auth. */
export const CLIENT_SUPPLIED_IP_HEADERS: readonly string[] = [
  CLIENT_IP_HEADER,
  'x-forwarded-for',
  'x-forwarded',
  'forwarded',
  'forwarded-for',
  'x-real-ip',
  'x-cluster-client-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'fastly-client-ip',
];

/**
 * Borra de `headers` los headers de IP del cliente y, si hay `ip`, escribe
 * `x-client-ip`. Muta el objeto recibido.
 */
export function applyClientIpHeader(
  headers: IncomingHttpHeaders,
  ip: string | undefined,
): void {
  for (const name of CLIENT_SUPPLIED_IP_HEADERS) {
    delete headers[name];
  }
  if (ip) {
    headers[CLIENT_IP_HEADER] = ip;
  }
}

/**
 * Middleware para las rutas `/api/auth/*` (se monta como `middleware` de
 * `BetterAuthModule.forRoot`, justo antes del handler de better-auth). Lee
 * `req.ip` ANTES de borrar `x-forwarded-for`: Express lo calcula a partir de
 * ese header cuando `trust proxy` está activo.
 */
export function clientIpHeaderMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const ip = req.ip;
  applyClientIpHeader(req.headers, ip);
  next();
}

/** Request mínima para llamar a `auth.api.*` en nombre del usuario. */
export interface BetterAuthCallerRequest {
  headers: IncomingHttpHeaders;
  ip?: string;
}

/**
 * Headers para llamar a `auth.api.*` server-side con la sesión del usuario de
 * la request (cookie), con la misma higiene de IP que el middleware. No muta
 * los headers de la request original.
 */
export function buildBetterAuthHeaders(req: BetterAuthCallerRequest): Headers {
  const headers: IncomingHttpHeaders = { ...req.headers };
  applyClientIpHeader(headers, req.ip);
  return fromNodeHeaders(headers);
}
