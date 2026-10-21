import { shouldUseSecureCookies } from './secure-cookies.policy';

/**
 * Fase 4 · P9 (cyber BAJO): fijar `useSecureCookies` anula la detección de
 * https de better-auth, así que la política cubre los dos casos.
 */
describe('shouldUseSecureCookies', () => {
  it.each([
    [true, 'http://localhost:3000', true],
    [true, 'https://api.vigilia.cl', true],
    [false, 'https://api.vigilia.cl', true],
    [false, 'HTTPS://api.vigilia.cl', true],
    [false, ' https://api.vigilia.cl ', true],
    [false, 'http://localhost:3000', false],
    [false, 'http://192.168.1.20:3000', false],
    [false, 'no-es-una-url', false],
    [false, '', false],
  ])(
    'producción=%p y BETTER_AUTH_URL=%p -> Secure=%p',
    (isProduction, url, expected) => {
      expect(shouldUseSecureCookies(isProduction, url)).toBe(expected);
    },
  );
});
