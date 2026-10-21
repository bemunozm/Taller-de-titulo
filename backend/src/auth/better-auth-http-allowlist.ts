import type { BetterAuthPlugin } from 'better-auth';

/**
 * Superficie HTTP de better-auth: LISTA BLANCA (Fase 4 · P4.B, ALTO-1 y
 * cyber N2). Por HTTP solo responden los endpoints que el navegador o los
 * links de los emails usan de verdad; todo lo demás (core, `organization`,
 * `apiKey`, `customSession` y cualquier endpoint que traiga una
 * actualización) responde 404. Las llamadas `auth.api.*` del servidor
 * (rutas Nest, onboarding, guards) no pasan por el router HTTP y siguen
 * funcionando.
 *
 * Por qué un plugin con `onRequest` y no `disabledPaths` (verificado en
 * better-auth 1.6.23):
 *  - `disabledPaths` compara el path EXACTO (`dist/api/index.mjs`:164-166
 *    con `normalizePathname`): no puede deshabilitar endpoints dinámicos como
 *    `/callback/:id`, y deshabilitar "todo menos X" exige enumerar los
 *    endpoints, que recién existen DESPUÉS de crear la instancia
 *    (`createBetterAuth` -> `getEndpoints(authContext, options)` en
 *    `dist/auth/base.mjs`), mientras que `disabledPaths` se lee de
 *    `ctx.options`, una copia de las opciones armada en `init`. Rellenarla
 *    después dependería de que esa copia comparta la referencia del array.
 *  - El `onRequest` de los plugins corre en el MISMO `onRequest` del router,
 *    justo después de `disabledPaths` (`dist/api/index.mjs`:163-178), recibe
 *    toda request HTTP a `/api/auth/*` (exista o no el endpoint) y nunca se
 *    invoca en `auth.api.*`. Decidir con la lista blanca deniega por defecto
 *    cualquier endpoint presente o futuro, sin enumerarlos.
 *
 * El test (`better-auth-http-allowlist.spec.ts`) sí enumera los endpoints
 * reales de la instancia (`auth.api`) y verifica contra el router real que
 * solo la lista blanca responde algo distinto de 404.
 */

/** `basePath` de better-auth (también lo usan main.ts y better-auth.ts). */
export const BETTER_AUTH_BASE_PATH = '/api/auth';

export interface AuthHttpRoute {
  readonly method: 'GET' | 'POST';
  /** Relativo a `basePath`; un segmento `:param` acepta cualquier valor no vacío. */
  readonly path: string;
  /** Quién lo usa por HTTP. */
  readonly reason: string;
}

export const BETTER_AUTH_HTTP_ALLOWLIST: readonly AuthHttpRoute[] = [
  {
    method: 'POST',
    path: '/sign-in/email',
    reason:
      'Login del frontend (frontend/src/api/AuthAPI.ts: authApi.post("/sign-in/email")); deja la cookie de sesión.',
  },
  {
    method: 'POST',
    path: '/sign-out',
    reason:
      'Logout del frontend (AuthAPI.ts: authApi.post("/sign-out")); borra la sesión y la cookie.',
  },
  {
    method: 'GET',
    path: '/reset-password/:token',
    reason:
      'Link de los emails de recuperación y de activación de cuenta (sendResetPassword usa la url de better-auth); valida el token y redirige al frontend (/auth/new-password).',
  },
  {
    method: 'GET',
    path: '/verify-email',
    reason:
      'Link del email de confirmación de cuenta (sendVerificationEmail usa la url de better-auth); verifica y redirige al frontend (/auth/confirm-account).',
  },
];

/**
 * Path relativo a `basePath` (`/sign-in/email`), o `null` si la URL no es de
 * better-auth. No normaliza `/` finales ni mayúsculas: el router tampoco.
 */
export function relativeAuthPath(url: string, basePath: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const base = basePath.replace(/\/+$/, '');
  if (!pathname.startsWith(`${base}/`)) {
    return null;
  }
  return pathname.slice(base.length);
}

function matchesRoute(pattern: string, path: string): boolean {
  const expected = pattern.split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) {
    return false;
  }
  return expected.every((segment, index) =>
    segment.startsWith(':')
      ? actual[index].length > 0
      : segment === actual[index],
  );
}

/** ¿La request HTTP apunta a un endpoint de la lista blanca? */
export function isAllowedAuthHttpRequest(
  method: string,
  url: string,
  basePath: string = BETTER_AUTH_BASE_PATH,
): boolean {
  const path = relativeAuthPath(url, basePath);
  if (path === null) {
    return false;
  }
  const upperMethod = method.toUpperCase();
  return BETTER_AUTH_HTTP_ALLOWLIST.some(
    (route) => route.method === upperMethod && matchesRoute(route.path, path),
  );
}

export const HTTP_ALLOWLIST_PLUGIN_ID = 'vigilia-http-allowlist';

/**
 * Plugin de better-auth que responde 404 a toda request HTTP fuera de
 * `BETTER_AUTH_HTTP_ALLOWLIST`. Debe ir PRIMERO en `plugins` (los
 * `onRequest` corren en orden).
 */
export function httpAllowlistPlugin(
  basePath: string = BETTER_AUTH_BASE_PATH,
): BetterAuthPlugin {
  return {
    id: HTTP_ALLOWLIST_PLUGIN_ID,
    onRequest: (request) =>
      Promise.resolve(
        isAllowedAuthHttpRequest(request.method, request.url, basePath)
          ? undefined
          : { response: new Response('Not Found', { status: 404 }) },
      ),
  };
}
