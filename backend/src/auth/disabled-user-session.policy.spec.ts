import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  isSessionCreationAllowed,
  USER_DISABLED_LOOKUP_SQL,
  userDisabledFromRows,
} from './disabled-user-session.policy';

/**
 * Fase 4 · P6.R (corrección P6): better-auth no crea sesiones para un usuario
 * deshabilitado (soft-delete); el login falla igual que con una contraseña
 * incorrecta y se audita como LOGIN_FAILED.
 */
describe('disabled-user-session.policy', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('usuario activo: se crea la sesión', async () => {
    await expect(
      isSessionCreationAllowed({ userId: 'u-1' }, () => Promise.resolve(false)),
    ).resolves.toBe(true);
  });

  it('usuario deshabilitado: no se crea (y queda un warn sin datos de login)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(
      isSessionCreationAllowed({ userId: 'u-1' }, () => Promise.resolve(true)),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Sesión rechazada: el usuario u-1 está deshabilitado',
    );
  });

  it('usuario que la consulta no ve (alta en la misma transacción): pasa; la FK garantiza que exista', async () => {
    await expect(
      isSessionCreationAllowed({ userId: 'u-1' }, () => Promise.resolve(null)),
    ).resolves.toBe(true);
  });

  it('fail-closed: sin userId o si la consulta falla, no se crea', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const lookup = jest.fn(() => Promise.resolve(false));

    await expect(isSessionCreationAllowed({}, lookup)).resolves.toBe(false);
    await expect(
      isSessionCreationAllowed({ userId: 42 }, lookup),
    ).resolves.toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    await expect(
      isSessionCreationAllowed({ userId: 'u-1' }, () =>
        Promise.reject(new Error('db down')),
      ),
    ).resolves.toBe(false);
  });

  it('userDisabledFromRows: deletedAt con valor = deshabilitado; null = activo; sin fila = null', () => {
    expect(userDisabledFromRows([{ deletedAt: new Date() }])).toBe(true);
    expect(userDisabledFromRows([{ deletedAt: null }])).toBe(false);
    expect(userDisabledFromRows([])).toBeNull();
    expect(USER_DISABLED_LOOKUP_SQL).toBe(
      'SELECT "deletedAt" FROM "user" WHERE id = $1',
    );
  });

  /**
   * better-auth 1.6.23 REAL (proceso hijo, adaptador en memoria) con
   * `session.create.before` y `hooks.after` cableados como en better-auth.ts.
   */
  describe('con better-auth real (sonda)', () => {
    interface LoginResult {
      status: number;
      body: unknown;
      setsSessionCookie: boolean;
    }
    interface ProbeResult {
      error?: string;
      activeLogin: LoginResult;
      disabledCorrectPassword: LoginResult;
      disabledWrongPassword: LoginResult;
      newSessionsWhileDisabled: number;
      auditWhileDisabled: Array<{
        action: string;
        reason: string | null;
        attemptedEmail: string | null;
      }>;
      reEnabledLogin: LoginResult;
    }
    let probe: ProbeResult;

    beforeAll(() => {
      const output = execFileSync(
        process.execPath,
        [
          join(
            __dirname,
            '..',
            'test-utils',
            'better-auth-disabled-user.probe.cjs',
          ),
        ],
        { encoding: 'utf8', timeout: 90_000 },
      );
      const lastLine = output.trim().split('\n').pop();
      probe = JSON.parse(lastLine ?? '{}') as ProbeResult;
    }, 120_000);

    it('la sonda corrió sin errores y el login activo funciona', () => {
      expect(probe.error).toBeUndefined();
      expect(probe.activeLogin.status).toBe(200);
      expect(probe.activeLogin.setsSessionCookie).toBe(true);
    });

    it('deshabilitado con la contraseña CORRECTA: misma respuesta que una contraseña incorrecta, sin cookie', () => {
      expect(probe.disabledCorrectPassword).toEqual(
        probe.disabledWrongPassword,
      );
      expect(probe.disabledCorrectPassword).toEqual({
        status: 401,
        body: {
          code: 'INVALID_EMAIL_OR_PASSWORD',
          message: 'Invalid email or password',
        },
        setsSessionCookie: false,
      });
    });

    it('no se crea ninguna sesión mientras está deshabilitado', () => {
      expect(probe.newSessionsWhileDisabled).toBe(0);
    });

    it('se audita como LOGIN_FAILED (igual que una contraseña incorrecta)', () => {
      // Corrección P7 (cyber B4): el email intentado va enmascarado.
      expect(probe.auditWhileDisabled).toEqual([
        {
          action: 'LOGIN_FAILED',
          reason: 'INVALID_EMAIL_OR_PASSWORD',
          attemptedEmail: 'c***@probe.cl',
        },
        {
          action: 'LOGIN_FAILED',
          reason: 'INVALID_EMAIL_OR_PASSWORD',
          attemptedEmail: 'c***@probe.cl',
        },
      ]);
    });

    it('al re-habilitarlo vuelve a poder iniciar sesión', () => {
      expect(probe.reEnabledLogin.status).toBe(200);
      expect(probe.reEnabledLogin.setsSessionCookie).toBe(true);
    });
  });
});
