/**
 * Mock manual de `better-auth/node` para Jest (Fase 1, Bloque A2t —
 * arreglo de infra de tests, docs/modulos/agente-cerebro.md).
 *
 * `better-auth/node` se distribuye SOLO como ESM (`.mjs` — ver
 * `node_modules/better-auth/package.json`, exports."./node" no tiene
 * condición "require"). Jest corre sobre CommonJS vía `ts-jest`, que no
 * transforma nada dentro de `node_modules` por defecto: al hacer
 * `require('better-auth/node')` (directo desde `auth/auth.guard.ts`, o
 * indirecto porque el bundle CJS de `@thallesp/nestjs-better-auth` también
 * lo requiere) Jest intenta ejecutar el `.mjs` como script y explota con
 * `SyntaxError: Cannot use import statement outside a module`.
 *
 * Intentar resolver esto con `transformIgnorePatterns` arrastra una cadena
 * ESM más profunda (`better-call/node` y lo que venga después) solo para
 * poder parsear un archivo cuyo comportamiento real ni siquiera se ejercita
 * en los tests (la sesión se mockea en `betterAuthService.api.getSession`).
 * Mockear el módulo es más simple y no depende de la cadena de deps ESM de
 * better-auth.
 *
 * Se mapea vía `moduleNameMapper` en `package.json` (`^better-auth/node$`),
 * así que CUALQUIER `require('better-auth/node')` en el árbol de módulos
 * (código propio o de `node_modules`) resuelve a este stub.
 *
 * `fromNodeHeaders` reimplementa la lógica REAL, verbatim, de
 * `node_modules/better-auth/dist/integrations/node.mjs` (es trivial y sin
 * dependencias ESM propias) para que el mock no le mienta a los tests sobre
 * su comportamiento si algún spec futuro llega a inspeccionar su output.
 */
export function fromNodeHeaders(
  nodeHeaders: Record<string, string | string[] | undefined>,
): Headers {
  const webHeaders = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => webHeaders.append(key, v));
    } else {
      webHeaders.set(key, value);
    }
  }
  return webHeaders;
}

/**
 * Ningún spec actual invoca `toNodeHandler` (es un adaptador de Express que
 * ni `auth.guard.ts` ni el resto del código propio usan) — stub que falla
 * ruidosamente si algún test futuro lo termina llamando sin actualizar este
 * mock.
 */
export function toNodeHandler(): (req: unknown, res: unknown) => void {
  return () => {
    throw new Error(
      'toNodeHandler() es un stub de test (better-auth-node.mock.ts) sin implementar — ' +
        'ningún spec lo ejercitaba al escribir este mock.',
    );
  };
}
