import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  addSessionEndedListener,
  notifySessionDeleted,
  sessionEndReasonOf,
  type SessionEndedEvent,
} from './session-ended-events';

/**
 * Fase 4 · P6.R (D13): puente entre `databaseHooks.session.delete.after` de
 * better-auth y el gateway de tiempo real (corte de sockets al terminar la
 * sesión).
 */
describe('session-ended-events', () => {
  const FUTURE = new Date(Date.now() + 3_600_000);
  let received: SessionEndedEvent[];
  let remove: () => void;

  beforeEach(() => {
    received = [];
    remove = addSessionEndedListener((event) => {
      received.push(event);
    });
  });

  afterEach(() => {
    remove();
    jest.restoreAllMocks();
  });

  it('el logout (/sign-out) llega al listener con motivo logout', () => {
    notifySessionDeleted(
      { id: 'sess-1', userId: 'user-1', expiresAt: FUTURE },
      { path: '/sign-out' },
    );

    expect(received).toEqual([
      { sessionId: 'sess-1', userId: 'user-1', reason: 'logout' },
    ]);
  });

  it('una revocación (otra ruta o sin contexto) es revoked; una fila ya vencida, expired', () => {
    notifySessionDeleted(
      { id: 's-a', userId: 'u', expiresAt: FUTURE },
      { path: '/change-password' },
    );
    notifySessionDeleted({ id: 's-b', userId: 'u', expiresAt: FUTURE }, null);
    notifySessionDeleted(
      { id: 's-c', userId: 'u', expiresAt: new Date(Date.now() - 1_000) },
      { path: '/get-session' },
    );

    expect(received.map((event) => event.reason)).toEqual([
      'revoked',
      'revoked',
      'expired',
    ]);
  });

  it('sessionEndReasonOf: /sign-out gana aunque la fila esté vencida; expiresAt inválido = revoked', () => {
    const past = new Date(Date.now() - 1_000);
    expect(sessionEndReasonOf({ expiresAt: past }, { path: '/sign-out' })).toBe(
      'logout',
    );
    expect(sessionEndReasonOf({ expiresAt: 'no-es-fecha' }, null)).toBe(
      'revoked',
    );
    expect(sessionEndReasonOf({ expiresAt: past.toISOString() }, null)).toBe(
      'expired',
    );
  });

  it('una fila sin id o sin userId no notifica', () => {
    notifySessionDeleted({ userId: 'u' }, null);
    notifySessionDeleted({ id: 's' }, null);
    notifySessionDeleted({ id: 42, userId: 'u' }, null);

    expect(received).toEqual([]);
  });

  it('un listener que lanza no rompe el hook ni a los demás listeners', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const removeFailing = addSessionEndedListener(() => {
      throw new Error('boom');
    });
    const later: SessionEndedEvent[] = [];
    const removeLater = addSessionEndedListener((event) => later.push(event));

    expect(() =>
      notifySessionDeleted({ id: 's', userId: 'u', expiresAt: FUTURE }, null),
    ).not.toThrow();
    expect(received).toHaveLength(1);
    expect(later).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);

    removeFailing();
    removeLater();
  });

  it('quitar el listener deja de notificarlo', () => {
    remove();
    notifySessionDeleted({ id: 's', userId: 'u', expiresAt: FUTURE }, null);

    expect(received).toEqual([]);
  });

  /**
   * better-auth 1.6.23 REAL (proceso hijo, adaptador en memoria) con el
   * adaptador `notifySessionDeleted` cableado como en better-auth.ts: el hook
   * corre en el logout y en TODAS las revocaciones que usa la app, con una
   * notificación por sesión borrada.
   */
  describe('con better-auth real (sonda)', () => {
    interface ProbeCase {
      expected: string[];
      sessionIds: string[];
      reasons: string[];
      userIds: string[];
    }
    type ProbeResult = { userId: string; error?: string } & Record<
      string,
      ProbeCase | string | undefined
    >;
    let probe: ProbeResult;

    beforeAll(() => {
      const output = execFileSync(
        process.execPath,
        [
          join(
            __dirname,
            '..',
            'test-utils',
            'better-auth-session-events.probe.cjs',
          ),
        ],
        { encoding: 'utf8', timeout: 90_000 },
      );
      const lastLine = output.trim().split('\n').pop();
      probe = JSON.parse(lastLine ?? '{}') as ProbeResult;
    }, 120_000);

    function probeCase(name: string): ProbeCase {
      expect(probe.error).toBeUndefined();
      const value = probe[name];
      if (typeof value !== 'object' || value === undefined) {
        throw new Error(`La sonda no devolvió el caso ${name}`);
      }
      return value;
    }

    it.each([
      ['signOut', 'logout'],
      ['changePassword', 'revoked'],
      ['revokeOtherSessions', 'revoked'],
      ['deleteUserSessions', 'revoked'],
      ['resetPassword', 'revoked'],
      ['expiredCleanup', 'expired'],
    ])('%s: un evento por cada sesión borrada, motivo %s', (name, reason) => {
      const result = probeCase(name);
      expect(result.expected.length).toBeGreaterThan(0);
      expect(result.sessionIds).toEqual(result.expected);
      expect(result.reasons).toEqual([reason]);
      expect(result.userIds).toEqual([probe.userId]);
    });

    it('changePassword con revokeOtherSessions borra también la sesión actual (más de una)', () => {
      expect(probeCase('changePassword').sessionIds.length).toBeGreaterThan(1);
    });

    it('un borrado fuera de better-auth (SQL directo) NO notifica: lo cubre la revalidación del gateway', () => {
      expect(probeCase('directDelete').sessionIds).toEqual([]);
    });
  });
});
