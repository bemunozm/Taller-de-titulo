/**
 * `advanced.useSecureCookies` de better-auth (Fase 4 · P9, corrección cyber
 * BAJO).
 *
 * Fijar la opción anula la detección automática de https de better-auth
 * (`createCookieGetter`: `options.advanced?.useSecureCookies !== undefined ?
 * ... : baseURL.startsWith('https://') || isProduction`). Con el valor
 * anterior (`isProduction`), un servidor sin `NODE_ENV=production` detrás de
 * https emitía la cookie de sesión SIN `Secure`. Ahora: `Secure` en
 * producción o cuando la URL propia de better-auth es https.
 */
export function shouldUseSecureCookies(
  isProduction: boolean,
  betterAuthBaseUrl: string,
): boolean {
  return isProduction || isHttpsUrl(betterAuthBaseUrl);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}
