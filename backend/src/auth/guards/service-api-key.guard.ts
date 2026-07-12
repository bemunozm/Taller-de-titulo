import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { auth } from '../better-auth';

// `.api` tipado con los plugins de nuestro `auth` (incluye `verifyApiKey`,
// del plugin apiKey — no está en el tipo base `BetterAuthService['api']`,
// que solo trae los endpoints core). Mismo patrón/motivo que
// `BetterAuthApi` en auth.service.ts: import type (no ejecuta better-auth.ts)
// + cast puntual más abajo, porque el tipo inyectado por DI debe seguir
// siendo la clase base para que Nest resuelva `design:paramtypes`.
type BetterAuthApi = BetterAuthService<typeof auth>['api'];

/**
 * Guard de credenciales de máquina (Fase 0, tarea #21 — hardening de ingesta
 * LPR, docs/modulos/auth-multitenant.md §11+). Protege los endpoints que
 * llama directamente el worker de IA (sin sesión de usuario humano):
 *   - POST /api/v1/detections/plates
 *   - POST /api/v1/detections/plates/attempts
 *   - POST /api/v1/anomalies
 *   - GET  /api/v1/anomalies
 *   - GET  /api/v1/workers/ia-health
 *
 * Verifica el header `x-api-key` (mismo header que usa por defecto el plugin
 * `apiKey` de better-auth) contra `auth.api.verifyApiKey`. La key se emite
 * vía `POST /api/v1/auth/service-api-keys` (AuthService.createServiceApiKey,
 * requiere el permiso `auth.manage-service-tokens`).
 *
 * A diferencia de `AuthGuard` (sesión de usuario humano), este guard NO
 * puebla `request.user` — deja `request.serviceApiKey` con los metadatos de
 * la key verificada (id, userId dueño, name) por si algún handler necesita
 * trazabilidad a futuro.
 *
 * `BetterAuthService` se inyecta vía DI (no el singleton `auth` de
 * better-auth.ts) porque `BetterAuthModule.forRoot(...)` es global — mismo
 * patrón que `AuthGuard` (ver su docstring).
 */
@Injectable()
export class ServiceApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ServiceApiKeyGuard.name);

  constructor(private readonly betterAuthService: BetterAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('Falta la API key de servicio (header x-api-key)');
    }

    const betterAuthApi = this.betterAuthService.api as unknown as BetterAuthApi;

    let result: Awaited<ReturnType<BetterAuthApi['verifyApiKey']>>;
    try {
      result = await betterAuthApi.verifyApiKey({
        body: { key: apiKey },
      });
    } catch (error) {
      this.logger.warn(`Error verificando API key de servicio: ${error}`);
      throw new UnauthorizedException('API key de servicio inválida');
    }

    if (!result.valid || !result.key) {
      this.logger.warn(`API key de servicio rechazada: ${result.error?.code ?? 'unknown'}`);
      throw new UnauthorizedException('API key de servicio inválida o expirada');
    }

    request.serviceApiKey = result.key;
    return true;
  }

  private extractApiKey(request: any): string | undefined {
    const header = request.headers?.['x-api-key'];
    return typeof header === 'string' && header.length > 0 ? header : undefined;
  }
}
