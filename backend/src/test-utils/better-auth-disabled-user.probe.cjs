'use strict';
// Fase 4 · P6.R: sonda de better-auth 1.6.23 REAL (ESM-only, no carga en
// Jest/CJS) para el bloqueo de sesiones de usuarios deshabilitados. Conecta
// `databaseHooks.session.create.before` con la política REAL
// (src/auth/disabled-user-session.policy.ts) y `hooks.after` con la auditoría
// REAL (src/auth/auth-audit.ts), igual que better-auth.ts; ambos módulos se
// cargan con ts-node. La lanza auth/disabled-user-session.policy.spec.ts como
// proceso hijo y lee la ÚLTIMA línea de stdout (JSON). Adaptador en memoria:
// el soft-delete se simula con `deletedAt` en la fila del usuario.
const { pathToFileURL } = require('node:url');

require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: { module: 'commonjs', target: 'es2022' },
});
const policy = require('../auth/disabled-user-session.policy');
const audit = require('../auth/auth-audit');

const load = (specifier) =>
  import(pathToFileURL(require.resolve(specifier)).href);

const BASE_URL = 'http://localhost:3000';
const BASE_PATH = '/api/auth';
const EMAIL = 'conserje@probe.cl';
const PASSWORD = 'clave-probe-1234';

async function main() {
  const { betterAuth, APIError, BASE_ERROR_CODES } = await load('better-auth');
  const { createAuthMiddleware, isAPIError } = await load('better-auth/api');
  const { memoryAdapter } = await load('better-auth/adapters/memory');

  const db = { user: [], session: [], account: [], verification: [], rateLimit: [] };
  // Como `lookupUserDisabled` de better-auth.ts, sobre la BD en memoria.
  const lookup = async (userId) => {
    const row = db.user.find((u) => u.id === userId);
    if (!row) return null;
    return row.deletedAt !== null && row.deletedAt !== undefined;
  };
  const auth = betterAuth({
    basePath: BASE_PATH,
    baseURL: BASE_URL,
    secret: 'probe-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    database: memoryAdapter(db),
    rateLimit: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: { enabled: true },
    // Mismo cableado que src/auth/better-auth.ts.
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        await audit.auditAuthEndpointResult({
          path: ctx.path,
          body: ctx.body,
          headers: ctx.headers,
          request: ctx.request,
          returned,
          failed: isAPIError(returned),
        });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (!(await policy.isSessionCreationAllowed(session, lookup))) {
              throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
            }
          },
        },
      },
    },
  });

  const auditEvents = [];
  audit.setAuthAuditSink((event) => {
    auditEvents.push({ action: event.action, reason: event.reason ?? null, attemptedEmail: event.attemptedEmail ?? null });
  });

  const { user } = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: 'Conserje' },
  });
  const userRow = db.user.find((u) => u.id === user.id);
  const sessionsOf = () => db.session.filter((s) => s.userId === user.id).length;

  async function signIn(password) {
    const response = await auth.handler(
      new Request(`${BASE_URL}${BASE_PATH}/sign-in/email`, {
        method: 'POST',
        headers: { origin: BASE_URL, 'content-type': 'application/json' },
        body: JSON.stringify({ email: EMAIL, password }),
      }),
    );
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return {
      status: response.status,
      body,
      setsSessionCookie: (response.headers.get('set-cookie') || '').includes('session_token'),
    };
  }

  const result = {};
  result.activeLogin = await signIn(PASSWORD);

  userRow.deletedAt = new Date();
  const sessionsBefore = sessionsOf();
  auditEvents.length = 0;
  result.disabledCorrectPassword = await signIn(PASSWORD);
  result.disabledWrongPassword = await signIn('otra-clave-1234');
  result.newSessionsWhileDisabled = sessionsOf() - sessionsBefore;
  result.auditWhileDisabled = auditEvents.slice();

  userRow.deletedAt = null;
  result.reEnabledLogin = await signIn(PASSWORD);

  audit.setAuthAuditSink(null);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({ error: error && error.stack ? error.stack : String(error) })}\n`,
  );
  process.exitCode = 1;
});
