'use strict';
// Fase 4 · P6.R (D13): sonda de better-auth 1.6.23 REAL (ESM-only, no carga
// en Jest/CJS) para verificar CUÁNDO corre `databaseHooks.session.delete.after`,
// que es lo que corta los sockets del namespace `/`. Conecta el hook con el
// adaptador REAL de la app (`notifySessionDeleted` de
// src/auth/session-ended-events.ts, cargado con ts-node) igual que
// better-auth.ts, y registra un listener como el del gateway. La lanza
// auth/session-ended-events.spec.ts como proceso hijo y lee la ÚLTIMA línea de
// stdout (JSON). Adaptador en memoria: sin BD ni red.
const { pathToFileURL } = require('node:url');

require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: { module: 'commonjs', target: 'es2022' },
});
const sessionEvents = require('../auth/session-ended-events');

const load = (specifier) =>
  import(pathToFileURL(require.resolve(specifier)).href);

const BASE_URL = 'http://localhost:3000';
const BASE_PATH = '/api/auth';
const PASSWORD = 'clave-probe-1234';

async function main() {
  const { betterAuth } = await load('better-auth');
  const { memoryAdapter } = await load('better-auth/adapters/memory');

  const db = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  const emails = {};
  const auth = betterAuth({
    basePath: BASE_PATH,
    baseURL: BASE_URL,
    secret: 'probe-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    database: memoryAdapter(db),
    rateLimit: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ token }) => {
        emails.resetToken = token;
      },
    },
    databaseHooks: {
      session: {
        delete: {
          // Mismo cableado que src/auth/better-auth.ts.
          after: async (session, context) => {
            sessionEvents.notifySessionDeleted(session, context);
          },
        },
      },
    },
  });

  const events = [];
  const remove = sessionEvents.addSessionEndedListener((event) => {
    events.push(event);
  });

  const { user } = await auth.api.signUpEmail({
    body: { email: 'residente@probe.cl', password: PASSWORD, name: 'Residente' },
  });

  /** Inicia sesión y devuelve `{ id, cookie }` de la sesión nueva. */
  async function signIn(password = PASSWORD) {
    const result = await auth.api.signInEmail({
      body: { email: 'residente@probe.cl', password },
      returnHeaders: true,
    });
    const cookie = (result.headers.get('set-cookie') || '').split(';')[0];
    const row = db.session.find((s) => s.token === result.response.token);
    return { id: row.id, cookie };
  }

  /** Ids (ordenados) de las sesiones vivas del usuario, salvo `except`. */
  function liveSessionIds(except = []) {
    return db.session
      .filter((s) => s.userId === user.id && !except.includes(s.id))
      .map((s) => s.id)
      .sort();
  }

  /** Eventos emitidos por `fn` (los ids de sesión, ordenados, y los motivos). */
  async function eventsOf(fn) {
    const start = events.length;
    await fn();
    const produced = events.slice(start);
    return {
      sessionIds: produced.map((e) => e.sessionId).sort(),
      reasons: [...new Set(produced.map((e) => e.reason))].sort(),
      userIds: [...new Set(produced.map((e) => e.userId))],
    };
  }

  const result = { userId: user.id };

  // 1. POST /sign-out por HTTP (logout del navegador).
  {
    const s = await signIn();
    result.signOut = {
      expected: [s.id],
      ...(await eventsOf(() =>
        auth.handler(
          new Request(`${BASE_URL}${BASE_PATH}/sign-out`, {
            method: 'POST',
            headers: { cookie: s.cookie, origin: BASE_URL },
          }),
        ),
      )),
    };
  }

  // 2. changePassword con revokeOtherSessions (ruta Nest update-password):
  //    borra TODAS las sesiones (también la actual) y crea una nueva.
  let currentPassword = PASSWORD;
  {
    const a = await signIn();
    await signIn();
    result.changePassword = {
      expected: liveSessionIds(),
      ...(await eventsOf(() =>
        auth.api.changePassword({
          body: {
            currentPassword,
            newPassword: 'clave-probe-5678',
            revokeOtherSessions: true,
          },
          headers: new Headers({ cookie: a.cookie }),
        }),
      )),
    };
    currentPassword = 'clave-probe-5678';
  }

  // 3. revokeOtherSessions (todas menos la actual).
  {
    const keep = await signIn(currentPassword);
    await signIn(currentPassword);
    result.revokeOtherSessions = {
      expected: liveSessionIds([keep.id]),
      ...(await eventsOf(() =>
        auth.api.revokeOtherSessions({
          headers: new Headers({ cookie: keep.cookie }),
        }),
      )),
    };
  }

  // 4. internalAdapter.deleteUserSessions (UsersService.revokeUserSessions:
  //    cambio de email de otro usuario por el super-admin).
  {
    await signIn(currentPassword);
    await signIn(currentPassword);
    const expected = liveSessionIds();
    const context = await auth.$context;
    result.deleteUserSessions = {
      expected,
      ...(await eventsOf(() =>
        context.internalAdapter.deleteUserSessions(user.id),
      )),
    };
  }

  // 5. resetPassword (revokeSessionsOnPasswordReset).
  {
    await signIn(currentPassword);
    result.resetPassword = {
      expected: liveSessionIds(),
      ...(await eventsOf(async () => {
        await auth.api.requestPasswordReset({
          body: { email: 'residente@probe.cl', redirectTo: '/reset' },
        });
        await auth.api.resetPassword({
          body: { newPassword: 'clave-probe-9012', token: emails.resetToken },
        });
      })),
    };
    currentPassword = 'clave-probe-9012';
  }

  // 6. Sesión vencida: getSession la limpia (motivo `expired`).
  {
    const a = await signIn(currentPassword);
    const row = db.session.find((s) => s.id === a.id);
    row.expiresAt = new Date(Date.now() - 1000);
    result.expiredCleanup = {
      expected: [a.id],
      ...(await eventsOf(() =>
        auth.api.getSession({
          headers: new Headers({ cookie: a.cookie }),
          query: { disableRefresh: true },
        }),
      )),
    };
  }

  // 7. Borrado con SQL directo (respaldo de UsersService): NO hay hook.
  {
    const a = await signIn(currentPassword);
    result.directDelete = {
      expected: [],
      ...(await eventsOf(async () => {
        const index = db.session.findIndex((s) => s.id === a.id);
        db.session.splice(index, 1);
      })),
    };
  }

  remove();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ error: error && error.stack ? error.stack : String(error) })}\n`,
  );
  process.exitCode = 1;
});
