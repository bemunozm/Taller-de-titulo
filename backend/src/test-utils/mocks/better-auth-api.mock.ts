/**
 * Mock manual de `better-auth/api` para Jest (Fase 1, Bloque A2t — mismo
 * motivo que `better-auth-node.mock.ts`, ver su docstring: el subpath real
 * es ESM-only y arrastra una cadena de deps que no vale la pena transformar
 * solo para parsear).
 *
 * `auth/auth.service.ts` importa `APIError` como VALOR (no solo tipo):
 * `import { APIError as BetterAuthAPIError } from 'better-auth/api'`, y lo
 * usa en `instanceof` para distinguir errores de better-auth de otros
 * errores, leyendo `.message` y `.body?.code`. Esta clase replica esa forma
 * mínima (no la implementación completa de better-auth) — alcanza para que
 * `error instanceof APIError` funcione en los specs que construyan/lancen
 * este tipo de error contra un mock de `betterAuthService.api`.
 *
 * Se mapea vía `moduleNameMapper` en `package.json` (`^better-auth/api$`).
 */
export class APIError extends Error {
  constructor(
    public readonly status: string | number = 'INTERNAL_SERVER_ERROR',
    public readonly body?: Record<string, unknown>,
    message?: string,
  ) {
    super(
      message ??
        (body?.message as string | undefined) ??
        'better-auth API error',
    );
    this.name = 'APIError';
  }
}
