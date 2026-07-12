/**
 * Mock manual de `better-auth/plugins` para Jest (Fase 1, Bloque A2t —
 * mismo motivo que `better-auth-node.mock.ts`, ver su docstring).
 *
 * Nadie en el código propio importa este subpath directamente: el único
 * `require('better-auth/plugins')` en el árbol de módulos es interno, del
 * bundle CJS de `@thallesp/nestjs-better-auth` (usa `createAuthMiddleware`
 * para sus decoradores de hooks `@BeforeHook`/`@AfterHook`). Ningún spec
 * actual ejercita esos hooks, así que un passthrough mínimo alcanza para que
 * el `require` no rompa el parseo.
 *
 * Se mapea vía `moduleNameMapper` en `package.json` (`^better-auth/plugins$`).
 */
export function createAuthMiddleware<T extends (...args: unknown[]) => unknown>(
  handler: T,
): T {
  return handler;
}
