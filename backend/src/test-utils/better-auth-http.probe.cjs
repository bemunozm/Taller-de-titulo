'use strict';
// Fase 4 · P4.B (ALTO-1, cyber N2): sonda del router HTTP REAL de
// better-auth 1.6.23 (ESM-only, no carga en Jest/CJS) con los MISMOS plugins
// que better-auth.ts y el plugin de lista blanca REAL
// (src/auth/better-auth-http-allowlist.ts, cargado con ts-node). La lanza
// auth/better-auth-http-allowlist.spec.ts como proceso hijo y lee la ÚLTIMA
// línea de stdout (JSON). Adaptador en memoria: sin BD ni red.
//
// 1. Enumera TODOS los endpoints de la instancia (`auth.api`, los que el
//    router expone: con path y sin SERVER_ONLY) y llama a cada uno por HTTP.
// 2. Repite contra una instancia de control SIN la lista blanca.
// 3. Ejecuta server-side los `auth.api.*` que usa la app (onboarding, guards,
//    rutas Nest de cuenta, API keys de servicio).
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Solo transpila (sin type-check) el módulo de la lista blanca, que no tiene
// imports de runtime. `skipProject`: el tsconfig del backend usa opciones de
// `nodenext` que no aplican a este transpilado CJS.
require('ts-node').register({
  transpileOnly: true,
  skipProject: true,
  compilerOptions: { module: 'commonjs', target: 'es2022' },
});
const allowlist = require('../auth/better-auth-http-allowlist');

const load = (specifier) =>
  import(pathToFileURL(require.resolve(specifier)).href);

const BASE_URL = 'http://localhost:3000';
const BASE_PATH = allowlist.BETTER_AUTH_BASE_PATH;

function emptyDatabase() {
  return {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
    organization: [],
    member: [],
    invitation: [],
    apikey: [],
  };
}

async function buildAuth(withAllowlist, emails) {
  const { betterAuth } = await load('better-auth');
  const { memoryAdapter } = await load('better-auth/adapters/memory');
  const { organization } = await load('better-auth/plugins/organization');
  const { customSession } = await load('better-auth/plugins/custom-session');
  const { apiKey } = await load('@better-auth/api-key');

  return betterAuth({
    basePath: BASE_PATH,
    baseURL: BASE_URL,
    secret: 'probe-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
    database: memoryAdapter(emptyDatabase()),
    rateLimit: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ token }) => {
        emails.resetToken = token;
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ token }) => {
        emails.verificationToken = token;
      },
    },
    plugins: [
      ...(withAllowlist ? [allowlist.httpAllowlistPlugin(BASE_PATH)] : []),
      organization({
        allowUserToCreateOrganization: false,
        membershipLimit: 500,
        sendInvitationEmail: async () => {},
      }),
      apiKey({ enableMetadata: true }),
      customSession(async ({ user, session }) => ({
        user: { ...user, roles: [], permissions: [] },
        session,
      })),
    ],
  });
}

/** Endpoints que expone el router: con path y sin `SERVER_ONLY`. */
function routedEndpoints(auth) {
  const routes = [];
  for (const endpoint of Object.values(auth.api)) {
    const options = endpoint.options || {};
    if (!endpoint.path || (options.metadata && options.metadata.SERVER_ONLY)) {
      continue;
    }
    const methods = Array.isArray(options.method)
      ? options.method
      : [options.method];
    for (const method of methods) {
      routes.push({ method, path: endpoint.path });
    }
  }
  return routes;
}

async function callHttp(auth, method, routePath) {
  const concretePath = routePath.replace(/:[^/]+/g, 'probe-param');
  const init = {
    method,
    headers: { origin: BASE_URL },
    redirect: 'manual',
  };
  if (method !== 'GET') {
    init.headers['content-type'] = 'application/json';
    init.body = '{}';
  }
  const response = await auth.handler(
    new Request(`${BASE_URL}${BASE_PATH}${concretePath}`, init),
  );
  return response.status;
}

async function serverSide(auth, emails) {
  const results = {};
  async function check(name, fn) {
    try {
      results[name] = (await fn()) === true;
    } catch (error) {
      results[name] = `error: ${error && error.message ? error.message : String(error)}`;
    }
  }

  const admin = await auth.api.signUpEmail({
    body: { email: 'admin@probe.cl', password: 'clave-admin-1234', name: 'Admin' },
  });
  const resident = await auth.api.signUpEmail({
    body: { email: 'residente@probe.cl', password: 'clave-res-1234', name: 'Residente' },
  });
  let organizationId = null;

  // Onboarding (OnboardingService): crear el condominio y dar de alta miembros.
  await check('createOrganization', async () => {
    const created = await auth.api.createOrganization({
      body: { name: 'Condominio Probe', slug: 'condominio-probe', userId: admin.user.id },
    });
    organizationId = created && created.id;
    return typeof organizationId === 'string';
  });
  await check('addMember', async () => {
    const member = await auth.api.addMember({
      body: { userId: resident.user.id, role: 'member', organizationId },
    });
    return !!member;
  });

  // AuthGuard / NotificationsGateway: sesión desde la cookie.
  const signIn = await auth.api.signInEmail({
    body: { email: 'admin@probe.cl', password: 'clave-admin-1234' },
    returnHeaders: true,
  });
  const cookie = (signIn.headers.get('set-cookie') || '').split(';')[0];
  const sessionHeaders = new Headers({ cookie });
  await check('getSession', async () => {
    const session = await auth.api.getSession({ headers: sessionHeaders });
    return !!session && session.user.id === admin.user.id;
  });

  // Rutas Nest de cuenta (AuthService / UsersService).
  await check('requestPasswordReset+resetPassword', async () => {
    await auth.api.requestPasswordReset({
      body: { email: 'residente@probe.cl', redirectTo: '/auth/new-password' },
    });
    const done = await auth.api.resetPassword({
      body: { newPassword: 'clave-res-nueva-1234', token: emails.resetToken },
    });
    return done.status === true;
  });
  await check('sendVerificationEmail+verifyEmail', async () => {
    await auth.api.sendVerificationEmail({ body: { email: 'residente@probe.cl' } });
    const verified = await auth.api.verifyEmail({
      query: { token: emails.verificationToken },
    });
    return !!verified && verified.status === true;
  });
  await check('verifyPassword', async () => {
    const verified = await auth.api.verifyPassword({
      body: { password: 'clave-admin-1234' },
      headers: sessionHeaders,
    });
    return verified.status === true;
  });
  await check('changePassword', async () => {
    const changed = await auth.api.changePassword({
      body: { currentPassword: 'clave-admin-1234', newPassword: 'clave-admin-5678' },
      headers: sessionHeaders,
    });
    return !!changed.user;
  });

  // API keys de servicio (AuthService.createServiceApiKey / ServiceApiKeyGuard).
  await check('createApiKey+verifyApiKey', async () => {
    const created = await auth.api.createApiKey({
      body: { userId: admin.user.id, name: 'lpr-probe' },
    });
    const verified = await auth.api.verifyApiKey({ body: { key: created.key } });
    return verified.valid === true;
  });

  return results;
}

async function main() {
  const emails = {};
  const auth = await buildAuth(true, emails);
  const control = await buildAuth(false, {});

  const http = {};
  const controlHttp = {};
  for (const { method, path: routePath } of routedEndpoints(auth)) {
    const key = `${method} ${routePath}`;
    http[key] = await callHttp(auth, method, routePath);
    controlHttp[key] = await callHttp(control, method, routePath);
  }

  // Variantes que no deben colarse por la lista blanca.
  const variants = {
    'POST /sign-in/email/': await callHttp(auth, 'POST', '/sign-in/email/'),
    'POST /SIGN-IN/EMAIL': await callHttp(auth, 'POST', '/SIGN-IN/EMAIL'),
    'GET /sign-in/email': await callHttp(auth, 'GET', '/sign-in/email'),
    'POST /reset-password/:token': await callHttp(auth, 'POST', '/reset-password/:token'),
    'GET /reset-password/a/b': await callHttp(auth, 'GET', '/reset-password/a/b'),
    'GET /no-existe': await callHttp(auth, 'GET', '/no-existe'),
  };

  const server = await serverSide(auth, emails);

  process.stdout.write(
    `\n${JSON.stringify({ http, controlHttp, variants, server })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exit(1);
});
