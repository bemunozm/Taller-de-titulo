import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS de la API HTTP (`app.enableCors` en main.ts). `origin` es el origen
 * validado del frontend (`FRONTEND_URL`, sin ruta ni `/` final).
 *
 * - Sin `Authorization`: el JWT Bearer legacy se retiró en P2 y el frontend
 *   autentica con la cookie de sesión de better-auth (`credentials: true`).
 * - `X-Hub-Id`/`X-Hub-Secret` (Fase 4 · P4, D6): el kiosko web manda su
 *   credencial de dispositivo desde el navegador. `x-api-key` no va: el LPR
 *   llama servidor a servidor, sin CORS.
 * - `exposedHeaders: Content-Disposition` (Fase 4 · P7): el frontend lee el
 *   nombre del archivo de `GET /auth/me/data-export` cuando front y back
 *   están en orígenes distintos (sin esto, el navegador oculta el header).
 */
export function buildHttpCorsOptions(origin: string): CorsOptions {
  return {
    origin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-Requested-With',
      'Accept',
      'Origin',
      'X-Hub-Id',
      'X-Hub-Secret',
    ],
    exposedHeaders: ['Content-Disposition'],
    credentials: true,
  };
}
