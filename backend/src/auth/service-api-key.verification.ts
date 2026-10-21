import type { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { auth } from './better-auth';
import { requiredServiceKeyPermissions } from './service-api-key.permissions';

/**
 * Verificación de la API key de servicio (worker y manager LPR) con
 * better-auth, compartida por `ServiceApiKeyGuard` y por el parser del body
 * (common/http/body-limits.ts, Fase 4 · P9).
 *
 * `verifyApiKey` NO es una lectura pura: con una key válida escribe en la fila
 * `apikey` (`lastRequest` y `updatedAt` siempre; `requestCount` si la key tiene
 * rate limit y `remaining` si tiene cupo; ver `claimUsageInDatabase` en
 * @better-auth/api-key). Verificar dos veces la misma request duplicaría esos
 * efectos (y gastaría cupo o rate limit dos veces). Por eso, cuando el parser
 * ya verificó la key de una ruta de ingesta, deja el resultado en la request
 * (propiedad con `Symbol`, que ningún input HTTP puede escribir) y el guard lo
 * reutiliza en vez de verificar otra vez. Sin resultado previo, el guard
 * verifica por su cuenta como siempre.
 */

// `.api` tipado con los plugins de nuestro `auth` (incluye `verifyApiKey`, del
// plugin apiKey; no está en el tipo base `BetterAuthService['api']`). `import
// type`: no ejecuta better-auth.ts (ver el mismo patrón en auth.service.ts).
type BetterAuthApi = BetterAuthService<typeof auth>['api'];

/** Key verificada que devuelve better-auth (sin el hash). */
export type VerifiedServiceApiKey = NonNullable<
  Awaited<ReturnType<BetterAuthApi['verifyApiKey']>>['key']
>;

/**
 * Resultado de verificar una API key de servicio:
 *  - `valid`: better-auth la aceptó con el permiso `service:lpr`;
 *  - `rejected`: better-auth respondió `valid: false` (no existe, revocada,
 *    vencida, sin permisos, sin cupo o con rate limit agotado);
 *  - `failed`: la verificación lanzó (BD caída, error inesperado). Se trata
 *    como inválida (fail-closed).
 */
export type ServiceApiKeyVerification =
  | { status: 'valid'; key: VerifiedServiceApiKey }
  | { status: 'rejected'; code: string }
  | { status: 'failed'; reason: string };

/** Verificador inyectable (el parser del body lo recibe desde main.ts). */
export type ServiceApiKeyVerifier = (
  apiKey: string,
) => Promise<ServiceApiKeyVerification>;

/** Header de la API key de servicio. */
export const SERVICE_API_KEY_HEADER = 'x-api-key';

/**
 * API key del header `x-api-key`: un string no vacío. Un header repetido
 * (`string[]`) o vacío cuenta como ausente (el guard responde 401).
 */
export function extractServiceApiKey(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  const header = headers?.[SERVICE_API_KEY_HEADER];
  return typeof header === 'string' && header.length > 0 ? header : undefined;
}

/**
 * Verifica `apiKey` con `auth.api.verifyApiKey`, exigiendo el permiso
 * `service:lpr`. Nunca lanza: un error de better-auth vuelve como `failed`.
 */
export async function verifyServiceApiKey(
  betterAuthService: Pick<BetterAuthService, 'api'>,
  apiKey: string,
): Promise<ServiceApiKeyVerification> {
  const betterAuthApi = betterAuthService.api as unknown as BetterAuthApi;
  let result: Awaited<ReturnType<BetterAuthApi['verifyApiKey']>>;
  try {
    result = await betterAuthApi.verifyApiKey({
      body: { key: apiKey, permissions: requiredServiceKeyPermissions() },
    });
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!result.valid || !result.key) {
    return { status: 'rejected', code: result.error?.code ?? 'unknown' };
  }
  return { status: 'valid', key: result.key };
}

/**
 * Propiedad de la request con la verificación ya hecha. Es un `Symbol`: no se
 * puede fijar desde headers, query ni body.
 */
export const SERVICE_API_KEY_VERIFICATION: unique symbol = Symbol(
  'vigilia.serviceApiKeyVerification',
);

/** Verificación guardada: el resultado y la key exacta a la que corresponde. */
export interface StoredServiceApiKeyVerification {
  readonly apiKey: string;
  readonly result: ServiceApiKeyVerification;
}

/** Request que puede llevar una verificación previa. */
export interface ServiceApiKeyVerificationCarrier {
  [SERVICE_API_KEY_VERIFICATION]?: StoredServiceApiKeyVerification;
}

/**
 * Deja en la request el resultado de verificar `apiKey`. No enumerable (no
 * aparece al serializar la request) y de solo lectura: la primera
 * verificación gana y una segunda llamada no la pisa.
 */
export function rememberServiceApiKeyVerification(
  request: object,
  apiKey: string,
  result: ServiceApiKeyVerification,
): void {
  if (
    Object.prototype.hasOwnProperty.call(request, SERVICE_API_KEY_VERIFICATION)
  ) {
    return;
  }
  const stored: StoredServiceApiKeyVerification = Object.freeze({
    apiKey,
    result,
  });
  Object.defineProperty(request, SERVICE_API_KEY_VERIFICATION, {
    value: stored,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * Resultado previo para `apiKey`, o `undefined` si no hay o si se verificó
 * otra key (en ese caso el guard verifica la que trae la request).
 */
export function previousServiceApiKeyVerification(
  request: ServiceApiKeyVerificationCarrier,
  apiKey: string,
): ServiceApiKeyVerification | undefined {
  const stored = request[SERVICE_API_KEY_VERIFICATION];
  return stored?.apiKey === apiKey ? stored.result : undefined;
}
