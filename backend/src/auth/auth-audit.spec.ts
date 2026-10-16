import { Logger } from '@nestjs/common';
import {
  auditAuthEndpointResult,
  auditSessionCreated,
  auditSessionDeleted,
  attemptedEmailFingerprint,
  attemptedEmailFor,
  emitAuthAuditEvent,
  normalizeEmail,
  setAuthAuditSink,
  type AuthAuditEvent,
} from './auth-audit';

/**
 * Fase 4 · P4.B — auditoría de login de better-auth. Se prueban los
 * adaptadores que better-auth.ts conecta a `hooks.after` y `databaseHooks`
 * (better-auth es ESM-only y no carga en Jest; better-auth.ts solo los
 * enchufa, sin lógica propia).
 */
describe('auditoría de login (auth-audit)', () => {
  const PASSWORD = 'Sup3r-Secreta!';
  let events: AuthAuditEvent[];

  function headers(values: Record<string, string>): Headers {
    return new Headers(values);
  }

  /** Error de better-auth tal como queda en `ctx.context.returned`. */
  function apiError(code: string): Error & { body: { code: string } } {
    return Object.assign(new Error('Invalid email or password'), {
      body: { code },
    });
  }

  const AUTH_SECRET = 'secreto-de-prueba-de-al-menos-32-caracteres';
  const originalSecret = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = AUTH_SECRET;
    events = [];
    setAuthAuditSink((event) => {
      events.push(event);
    });
  });

  afterEach(() => {
    process.env.BETTER_AUTH_SECRET = originalSecret;
  });

  afterEach(() => {
    setAuthAuditSink(null);
    jest.restoreAllMocks();
  });

  describe('LOGIN (databaseHooks.session.create.after)', () => {
    it('una sesión creada por /sign-in/email registra LOGIN con userId, ip y userAgent', async () => {
      await auditSessionCreated(
        {
          userId: 'user-1',
          ipAddress: '203.0.113.5',
          userAgent: 'Mozilla/5.0',
        },
        { path: '/sign-in/email' },
      );

      expect(events).toEqual([
        {
          action: 'LOGIN',
          userId: 'user-1',
          ip: '203.0.113.5',
          userAgent: 'Mozilla/5.0',
          endpoint: '/api/auth/sign-in/email',
        },
      ]);
    });

    it('sin IP en la sesión, la toma de x-client-ip del request', async () => {
      await auditSessionCreated(
        { userId: 'user-1', ipAddress: '', userAgent: null },
        {
          path: '/sign-in/email',
          headers: headers({
            'x-client-ip': '198.51.100.3',
            'user-agent': 'curl/8',
          }),
        },
      );

      expect(events[0]).toEqual(
        expect.objectContaining({ ip: '198.51.100.3', userAgent: 'curl/8' }),
      );
    });

    it('la rotación de sesión de /change-password NO es un LOGIN', async () => {
      await auditSessionCreated(
        { userId: 'user-1' },
        { path: '/change-password' },
      );

      expect(events).toEqual([]);
    });
  });

  describe('LOGIN_FAILED (hooks.after en /sign-in/email)', () => {
    it('registra el email intentado ENMASCARADO + su HMAC (nunca en claro), el código de error, ip y userAgent', async () => {
      await auditAuthEndpointResult({
        path: '/sign-in/email',
        body: { email: '  Ana.Perez@Example.COM ', password: PASSWORD },
        headers: headers({
          'x-client-ip': '203.0.113.9',
          'user-agent': 'Mozilla/5.0',
        }),
        returned: apiError('INVALID_EMAIL_OR_PASSWORD'),
        failed: true,
      });

      expect(events).toEqual([
        {
          action: 'LOGIN_FAILED',
          attemptedEmail: 'a***@example.com',
          attemptedEmailHash: attemptedEmailFingerprint(
            'ana.perez@example.com',
            AUTH_SECRET,
          ),
          reason: 'INVALID_EMAIL_OR_PASSWORD',
          ip: '203.0.113.9',
          userAgent: 'Mozilla/5.0',
          endpoint: '/api/auth/sign-in/email',
        },
      ]);
    });

    it('NUNCA registra la contraseña', async () => {
      await auditAuthEndpointResult({
        path: '/sign-in/email',
        body: { email: 'ana@example.com', password: PASSWORD },
        returned: apiError('INVALID_EMAIL_OR_PASSWORD'),
        failed: true,
      });

      expect(JSON.stringify(events)).not.toContain(PASSWORD);
    });

    it('un sign-in exitoso no registra LOGIN_FAILED (el LOGIN sale de la sesión creada)', async () => {
      await auditAuthEndpointResult({
        path: '/sign-in/email',
        body: { email: 'ana@example.com', password: PASSWORD },
        returned: { user: { id: 'user-1' }, token: 'secreto' },
        failed: false,
      });

      expect(events).toEqual([]);
    });

    it('un body sin email (validación fallida) registra el intento sin email', async () => {
      await auditAuthEndpointResult({
        path: '/sign-in/email',
        body: { email: 42 },
        returned: apiError('VALIDATION_ERROR'),
        failed: true,
      });

      expect(events[0]).toEqual(
        expect.objectContaining({
          action: 'LOGIN_FAILED',
          attemptedEmail: null,
        }),
      );
    });

    it('cyber M3: una contraseña tipeada en el campo email NO se guarda (attemptedEmail null)', async () => {
      await auditAuthEndpointResult({
        path: '/sign-in/email',
        body: { email: PASSWORD, password: PASSWORD },
        returned: apiError('INVALID_EMAIL_OR_PASSWORD'),
        failed: true,
      });

      expect(events[0]).toEqual(
        expect.objectContaining({
          action: 'LOGIN_FAILED',
          attemptedEmail: null,
        }),
      );
      expect(JSON.stringify(events)).not.toContain(PASSWORD);
      expect(JSON.stringify(events)).not.toContain(PASSWORD.toLowerCase());
    });

    it('cyber M3: si better-auth lo rechazó por formato (INVALID_EMAIL), no se guarda aunque parezca email', async () => {
      await auditAuthEndpointResult({
        path: '/sign-in/email',
        body: { email: 'ana@example.com', password: PASSWORD },
        returned: apiError('INVALID_EMAIL'),
        failed: true,
      });

      expect(events[0]).toEqual(
        expect.objectContaining({
          attemptedEmail: null,
          reason: 'INVALID_EMAIL',
        }),
      );
    });

    it.each([
      ['ana@example.com', undefined, 'ana@example.com'],
      ['  Ana@Example.COM ', 'INVALID_EMAIL_OR_PASSWORD', 'ana@example.com'],
      ['ana@example.com', 'INVALID_EMAIL', null],
      ['Sup3r-Secreta!', 'INVALID_EMAIL_OR_PASSWORD', null],
      ['clave sin arroba', undefined, null],
      ['ana@', undefined, null],
      [42, undefined, null],
      [undefined, undefined, null],
    ])('attemptedEmailFor(%p, %p) -> %p', (value, reason, expected) => {
      expect(attemptedEmailFor(value, reason)).toBe(expected);
    });

    /**
     * Corrección P7 (cyber B4): `LOGIN_FAILED` guarda el email enmascarado y
     * un HMAC con clave del servidor para correlacionar intentos.
     */
    describe('email intentado: enmascarado + HMAC (corrección P7)', () => {
      async function failWith(email: string): Promise<AuthAuditEvent> {
        events = [];
        await auditAuthEndpointResult({
          path: '/sign-in/email',
          body: { email, password: PASSWORD },
          returned: apiError('INVALID_EMAIL_OR_PASSWORD'),
          failed: true,
        });
        return events[0];
      }

      it('el email en claro no sale del adaptador', async () => {
        const event = await failWith('Victima.Real@Correo.cl');

        expect(event.attemptedEmail).toBe('v***@correo.cl');
        expect(JSON.stringify(event)).not.toMatch(/victima\.real/i);
      });

      it('el mismo email (normalizado) da el mismo HMAC; otro email, otro', async () => {
        const first = await failWith('ana@example.com');
        const again = await failWith('  ANA@example.com ');
        const other = await failWith('beto@example.com');

        expect(first.attemptedEmailHash).toMatch(/^[0-9a-f]{32}$/);
        expect(again.attemptedEmailHash).toBe(first.attemptedEmailHash);
        expect(other.attemptedEmailHash).not.toBe(first.attemptedEmailHash);
      });

      it('el HMAC depende de la clave del servidor y no es un hash sin clave', () => {
        const withKey = attemptedEmailFingerprint('ana@example.com', 'k1');
        expect(withKey).not.toBe(
          attemptedEmailFingerprint('ana@example.com', 'k2'),
        );
        expect(withKey).not.toBe(
          attemptedEmailFingerprint('ana@example.com', ''),
        );
        expect(attemptedEmailFingerprint('ana@example.com', '')).toBeNull();
      });

      it('sin email válido: ni máscara ni HMAC', async () => {
        const event = await failWith(PASSWORD);

        expect(event.attemptedEmail).toBeNull();
        expect(event.attemptedEmailHash).toBeNull();
      });
    });
  });

  describe('LOGOUT (databaseHooks.session.delete.after)', () => {
    it('la sesión borrada por /sign-out registra LOGOUT con su userId y la IP del request', async () => {
      await auditSessionDeleted(
        { userId: 'user-1', ipAddress: '10.0.0.1' },
        {
          path: '/sign-out',
          headers: headers({ 'x-client-ip': '203.0.113.20' }),
        },
      );

      expect(events).toEqual([
        {
          action: 'LOGOUT',
          userId: 'user-1',
          ip: '203.0.113.20',
          userAgent: undefined,
          endpoint: '/api/auth/sign-out',
        },
      ]);
    });

    it('borrar sesiones por otra causa (reset o cambio de contraseña) no es LOGOUT', async () => {
      await auditSessionDeleted(
        { userId: 'user-1' },
        { path: '/reset-password' },
      );
      await auditSessionDeleted({ userId: 'user-1' }, null);

      expect(events).toEqual([]);
    });
  });

  describe('otros endpoints', () => {
    it('/change-password (server-side desde update-password) no genera eventos: lo audita @Auditable', async () => {
      await auditAuthEndpointResult({
        path: '/change-password',
        body: {},
        returned: { user: { id: 'user-1' } },
        failed: false,
      });

      expect(events).toEqual([]);
    });
  });

  describe('best-effort', () => {
    it('sin sink registrado no falla', async () => {
      setAuthAuditSink(null);

      await expect(
        auditSessionCreated({ userId: 'user-1' }, { path: '/sign-in/email' }),
      ).resolves.toBeUndefined();
    });

    it('un sink que lanza no bloquea el login y se loguea sin datos sensibles', async () => {
      const loggerError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      setAuthAuditSink(() => {
        throw new Error('BD caída: ana@example.com');
      });

      await expect(
        auditAuthEndpointResult({
          path: '/sign-in/email',
          body: { email: 'ana@example.com', password: PASSWORD },
          returned: apiError('INVALID_EMAIL_OR_PASSWORD'),
          failed: true,
        }),
      ).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(loggerError.mock.calls);
      expect(logged).toContain('LOGIN_FAILED');
      expect(logged).not.toContain('ana@example.com');
      expect(logged).not.toContain(PASSWORD);
    });

    it('un sink asíncrono que rechaza tampoco propaga', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      setAuthAuditSink(() => Promise.reject(new Error('timeout')));

      await expect(
        emitAuthAuditEvent({ action: 'LOGOUT', userId: 'user-1' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('normalizeEmail', () => {
    it.each([
      ['  Ana@Example.COM ', 'ana@example.com'],
      ['', undefined],
      ['   ', undefined],
      [42, undefined],
      [undefined, undefined],
    ])('%p -> %p', (input, expected) => {
      expect(normalizeEmail(input)).toBe(expected);
    });

    it('acota el largo a 254 caracteres', () => {
      expect(normalizeEmail(`${'a'.repeat(300)}@x.cl`)).toHaveLength(254);
    });
  });
});
