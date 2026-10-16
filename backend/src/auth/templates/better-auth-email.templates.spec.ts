import { escapeHtml, safeHttpUrl } from '../../common/utils/escape-html.util';
import {
  buildAccountVerificationEmailHtml,
  buildOrganizationInvitationEmailHtml,
  buildPasswordResetEmailHtml,
  buildWelcomeAfterVerificationEmailHtml,
} from './better-auth-email.templates';

/**
 * Fase 4 · P4.B (cyber N2): los templates de email escapan todo valor
 * interpolado (nombres de usuario, organización, invitador, email) y solo
 * aceptan links http(s).
 */
describe('templates de email de better-auth: escape de HTML', () => {
  const SCRIPT = '<script>alert(1)</script>';
  const ATTRIBUTE_BREAK = '"><img src=x onerror=alert(1)>';
  const URL_OK =
    'https://app.vigilia.cl/api/auth/reset-password/abc?callbackURL=x&y=1';

  function expectNoRawInjection(html: string): void {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
  }

  it('invitación: nombre de organización e invitador escapados', () => {
    const html = buildOrganizationInvitationEmailHtml(
      'invitado@example.com',
      SCRIPT,
      ATTRIBUTE_BREAK,
      URL_OK,
    );

    expectNoRawInjection(html);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('invitación: el email del invitado (saludo) también se escapa', () => {
    const html = buildOrganizationInvitationEmailHtml(
      `a${SCRIPT}@example.com`,
      'Condominio',
      'Ana',
      URL_OK,
    );

    expectNoRawInjection(html);
  });

  it.each([
    [
      'restablecer contraseña',
      (name: string) => buildPasswordResetEmailHtml(name, URL_OK, false),
    ],
    [
      'activar cuenta nueva',
      (name: string) => buildPasswordResetEmailHtml(name, URL_OK, true),
    ],
    [
      'verificar cuenta',
      (name: string) => buildAccountVerificationEmailHtml(name, URL_OK),
    ],
    [
      'bienvenida',
      (name: string) =>
        buildWelcomeAfterVerificationEmailHtml(name, 'https://app.vigilia.cl'),
    ],
  ])('%s: el nombre del usuario se escapa', (_template, build) => {
    const html = build(`Juan ${SCRIPT} ${ATTRIBUTE_BREAK}`);

    expectNoRawInjection(html);
    expect(html).toContain('Hola Juan &lt;script&gt;');
  });

  it('el link del botón se escapa (& -> &amp;) y conserva la URL', () => {
    const html = buildPasswordResetEmailHtml('Ana', URL_OK, false);

    expect(html).toContain(
      'href="https://app.vigilia.cl/api/auth/reset-password/abc?callbackURL=x&amp;y=1"',
    );
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'no-es-url'])(
    'un link que no es http(s) (%p) se reemplaza por #',
    (url) => {
      const html = buildAccountVerificationEmailHtml('Ana', url);

      expect(html).toContain('href="#"');
      expect(html).not.toContain('javascript:');
    },
  );

  describe('escapeHtml / safeHttpUrl', () => {
    it.each([
      ['<b>&"\'</b>', '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;'],
      ['texto normal ñ', 'texto normal ñ'],
      ['', ''],
    ])('escapeHtml(%p) -> %p', (input, expected) => {
      expect(escapeHtml(input)).toBe(expected);
    });

    it('safeHttpUrl acepta http y https', () => {
      expect(safeHttpUrl('http://localhost:5173/auth/login')).toBe(
        'http://localhost:5173/auth/login',
      );
      expect(safeHttpUrl('https://x.cl/a?b="c"')).toBe(
        'https://x.cl/a?b=%22c%22',
      );
    });
  });
});
