import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BetterAuthPlugin } from 'better-auth';
import {
  BETTER_AUTH_BASE_PATH,
  BETTER_AUTH_HTTP_ALLOWLIST,
  httpAllowlistPlugin,
  isAllowedAuthHttpRequest,
  relativeAuthPath,
} from './better-auth-http-allowlist';

interface ProbeResult {
  /** `"<MÉTODO> <path>"` -> status, para cada endpoint enumerado de la instancia. */
  http: Record<string, number>;
  /** Lo mismo contra una instancia SIN la lista blanca. */
  controlHttp: Record<string, number>;
  variants: Record<string, number>;
  server: Record<string, boolean | string>;
}

const ALLOWED_ROUTES = [
  'GET /reset-password/:token',
  'GET /verify-email',
  'POST /sign-in/email',
  'POST /sign-out',
];

/**
 * Fase 4 · P4.B (ALTO-1, cyber N2): la superficie HTTP de better-auth es una
 * LISTA BLANCA; todo lo demás responde 404 y las llamadas `auth.api.*`
 * server-side siguen funcionando.
 */
describe('better-auth: lista blanca HTTP (Fase 4 · P4.B)', () => {
  describe('isAllowedAuthHttpRequest', () => {
    const url = (path: string): string =>
      `http://localhost:3000${BETTER_AUTH_BASE_PATH}${path}`;

    it.each([
      ['POST', '/sign-in/email'],
      ['POST', '/sign-out'],
      ['GET', '/reset-password/abc123TOKEN'],
      ['GET', '/verify-email?token=x&callbackURL=y'],
      ['post', '/sign-in/email'],
    ])('permite %s %s', (method, path) => {
      expect(isAllowedAuthHttpRequest(method, url(path))).toBe(true);
    });

    it.each([
      ['GET', '/get-session'],
      ['POST', '/organization/delete'],
      ['GET', '/organization/list-members'],
      ['POST', '/organization/invite-member'],
      ['POST', '/update-user'],
      ['GET', '/callback/google'],
      ['GET', '/sign-in/email'],
      ['POST', '/reset-password'],
      ['POST', '/reset-password/abc'],
      ['GET', '/reset-password/'],
      ['GET', '/reset-password/a/b'],
      ['POST', '/sign-in/email/'],
      ['POST', '/SIGN-IN/EMAIL'],
      ['POST', '/sign-in%2Femail'],
      ['GET', '/ok'],
    ])('deniega %s %s', (method, path) => {
      expect(isAllowedAuthHttpRequest(method, url(path))).toBe(false);
    });

    it('una URL fuera del basePath o inválida no está permitida', () => {
      expect(
        isAllowedAuthHttpRequest('POST', 'http://localhost:3000/sign-in/email'),
      ).toBe(false);
      expect(isAllowedAuthHttpRequest('POST', 'no-es-url')).toBe(false);
      expect(relativeAuthPath('http://x/api/authx/sign-out', '/api/auth')).toBe(
        null,
      );
    });

    it('cada excepción documenta quién la usa', () => {
      for (const route of BETTER_AUTH_HTTP_ALLOWLIST) {
        expect(route.reason.length).toBeGreaterThan(20);
      }
      expect(
        BETTER_AUTH_HTTP_ALLOWLIST.map((r) => `${r.method} ${r.path}`).sort(),
      ).toEqual(ALLOWED_ROUTES);
    });
  });

  describe('plugin onRequest', () => {
    const plugin = httpAllowlistPlugin();
    const ctx = {} as Parameters<NonNullable<BetterAuthPlugin['onRequest']>>[1];

    async function statusOf(method: string, path: string): Promise<number> {
      const onRequest = plugin.onRequest;
      if (!onRequest) {
        throw new Error('el plugin no define onRequest');
      }
      const result = await onRequest(
        new Request(`http://localhost:3000/api/auth${path}`, { method }),
        ctx,
      );
      return result && 'response' in result ? result.response.status : 0;
    }

    it('deja pasar la lista blanca (sin respuesta propia)', async () => {
      expect(await statusOf('POST', '/sign-in/email')).toBe(0);
    });

    it('responde 404 al resto', async () => {
      expect(await statusOf('POST', '/organization/delete')).toBe(404);
    });
  });

  /**
   * Router REAL de better-auth 1.6.23 en un proceso hijo
   * (`test-utils/better-auth-http.probe.cjs`): mismos plugins que
   * better-auth.ts + el plugin real de la lista blanca.
   */
  describe('router real (todos los endpoints enumerados)', () => {
    let probe: ProbeResult;

    beforeAll(() => {
      const output = execFileSync(
        process.execPath,
        [join(__dirname, '..', 'test-utils', 'better-auth-http.probe.cjs')],
        { encoding: 'utf8', timeout: 120_000 },
      );
      // Robusto a logs/avisos: solo la última línea es el JSON.
      const lastLine = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .pop();
      probe = JSON.parse(lastLine ?? '{}') as ProbeResult;
    }, 150_000);

    it('enumera todos los endpoints de la instancia (core + organization + apiKey + customSession)', () => {
      const routes = Object.keys(probe.http);

      expect(routes.length).toBeGreaterThan(50);
      expect(routes).toEqual(
        expect.arrayContaining([
          'GET /get-session',
          'POST /organization/delete',
          'GET /organization/list-members',
          'POST /api-key/create',
          'GET /callback/:id',
        ]),
      );
    });

    it('SOLO la lista blanca responde algo distinto de 404', () => {
      const reachable = Object.entries(probe.http)
        .filter(([, status]) => status !== 404)
        .map(([route]) => route)
        .sort();

      expect(reachable).toEqual(ALLOWED_ROUTES);
    });

    it('control: sin la lista blanca, todos esos endpoints respondían por HTTP', () => {
      const deniedNow = Object.entries(probe.http)
        .filter(([, status]) => status === 404)
        .map(([route]) => route);

      expect(deniedNow.length).toBeGreaterThan(50);
      for (const route of deniedNow) {
        expect({ route, status: probe.controlHttp[route] }).not.toEqual({
          route,
          status: 404,
        });
      }
    });

    it('variantes (/ final, mayúsculas, otro método, más segmentos) -> 404', () => {
      expect(Object.values(probe.variants).every((s) => s === 404)).toBe(true);
    });

    it('las llamadas auth.api.* server-side de la app siguen funcionando (onboarding, guards, cuenta, API keys)', () => {
      expect(probe.server).toEqual({
        createOrganization: true,
        addMember: true,
        getSession: true,
        'requestPasswordReset+resetPassword': true,
        'sendVerificationEmail+verifyEmail': true,
        verifyPassword: true,
        changePassword: true,
        'createApiKey+verifyApiKey': true,
      });
    });

    it('better-auth.ts usa el plugin como PRIMER plugin y ya no usa disabledPaths', () => {
      const source = readFileSync(join(__dirname, 'better-auth.ts'), 'utf8');
      const pluginsStart = source.indexOf('plugins: [');
      const allowlistAt = source.indexOf(
        'httpAllowlistPlugin(BETTER_AUTH_BASE_PATH)',
        pluginsStart,
      );
      const organizationAt = source.indexOf('organization({', pluginsStart);

      expect(pluginsStart).toBeGreaterThan(0);
      expect(allowlistAt).toBeGreaterThan(pluginsStart);
      expect(organizationAt).toBeGreaterThan(allowlistAt);
      expect(source).not.toMatch(/^\s*disabledPaths:/m);
    });
  });
});
