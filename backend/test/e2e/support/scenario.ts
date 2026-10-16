import { randomInt } from 'node:crypto';
import { Client } from 'pg';
import {
  REQUESTS_PATH,
  type FakeOpenAiRequest,
} from '../harness/fake-openai-server';
import { readRunState, type E2eRunState } from '../harness/run-state';
import { E2eHttpClient } from './http-client';
import { arrayAt, asObject, ensureStatus, objectAt, stringAt } from './json';
import {
  randomPassword,
  randomPhone,
  randomRut,
  uniqueEmail,
  uniqueSuffix,
} from './test-data';

/**
 * Datos de los e2e creados POR ENDPOINTS (Fase 4 · P8; preferencia de
 * Benjamin: nada a mano en la BD). Única excepción: el token del email de
 * activación se lee de la tabla `verification` (hace de "bandeja de
 * entrada"); con él la cuenta se activa por `POST /auth/reset-password`, como
 * lo haría el usuario desde el link.
 */
export type SystemRoleName =
  | 'Super Administrador'
  | 'Administrador'
  | 'Conserje'
  | 'Residente'
  | 'Seguridad'
  | 'Desarrollador';

export const API = '/api/v1';
export const SIGN_IN_PATH = '/api/auth/sign-in/email';
export const SESSION_COOKIE = 'better-auth.session_token';

/** Usuario activado y con sesión abierta en `http`. */
export interface E2eActor {
  id: string;
  name: string;
  email: string;
  password: string;
  http: E2eHttpClient;
}

export interface E2eCondominium {
  id: string;
  name: string;
  admin: E2eActor;
}

/** Unidad + familia asociada (la "casa" que busca el conserje). */
export interface E2eHousehold {
  unitId: string;
  /** Código exacto de la casa (`unit.identifier`). */
  house: string;
  familyId: string;
}

export interface E2eHub {
  hubId: string;
  organizationId: string;
  /** Cliente con `X-Hub-Id`/`X-Hub-Secret` (sin cookie). */
  http: E2eHttpClient;
}

export interface E2eCamera {
  id: string;
  sourceUrl: string;
}

export interface CreateMemberOptions {
  label: string;
  roles: readonly SystemRoleName[];
  familyId?: string;
}

export class E2eScenario {
  private readonly roleIds = new Map<string, string>();

  private constructor(
    readonly state: E2eRunState,
    readonly superAdmin: E2eActor,
  ) {}

  /** Lee el estado de la corrida e inicia sesión como el super-admin sembrado. */
  static async start(): Promise<E2eScenario> {
    const state = readRunState();
    const http = new E2eHttpClient({
      baseUrl: state.baseUrl,
      origin: state.frontendOrigin,
    });
    await signIn(http, state.superAdmin.email, state.superAdmin.password);
    const me = ensureStatus(
      await http.get(`${API}/auth/user`),
      [200],
      'leer el super-admin',
    );
    const superAdmin: E2eActor = {
      id: stringAt(me.json, 'id', 'GET /auth/user'),
      name: 'Super Admin E2E',
      email: state.superAdmin.email,
      password: state.superAdmin.password,
      http,
    };
    return new E2eScenario(state, superAdmin);
  }

  /** Cliente nuevo (otra IP, sin cookies). */
  newClient(headers?: Record<string, string>): E2eHttpClient {
    return new E2eHttpClient({
      baseUrl: this.state.baseUrl,
      origin: this.state.frontendOrigin,
      headers,
    });
  }

  /** Id de un rol del sistema (sembrado por la app al arrancar). */
  async roleId(name: SystemRoleName): Promise<string> {
    const cached = this.roleIds.get(name);
    if (cached) {
      return cached;
    }
    const response = ensureStatus(
      await this.superAdmin.http.get(`${API}/roles`),
      [200],
      'listar roles',
    );
    if (!Array.isArray(response.json)) {
      throw new Error('GET /roles: se esperaba un arreglo');
    }
    for (const role of response.json) {
      this.roleIds.set(
        stringAt(role, 'name', 'rol'),
        stringAt(role, 'id', 'rol'),
      );
    }
    const id = this.roleIds.get(name);
    if (!id) {
      throw new Error(`No existe el rol "${name}"`);
    }
    return id;
  }

  /** Condominio + su Administrador (activado y con sesión). */
  async createCondominium(label: string): Promise<E2eCondominium> {
    const suffix = uniqueSuffix();
    const name = `Condominio ${label} ${suffix}`;
    const adminEmail = uniqueEmail(`admin.${label}`);
    const response = ensureStatus(
      await this.superAdmin.http.post(`${API}/onboarding/condominiums`, {
        name,
        slug: `e2e-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
        admin: {
          rut: randomRut(),
          name: `Admin ${label}`,
          email: adminEmail,
          phone: randomPhone(),
          age: 40,
        },
      }),
      [201],
      `crear el condominio ${label}`,
    );
    const organizationId = stringAt(
      objectAt(response.json, 'organization', 'onboarding'),
      'id',
      'organization',
    );
    const adminId = stringAt(
      objectAt(response.json, 'admin', 'onboarding'),
      'id',
      'admin',
    );
    const admin = await this.activate(adminId, `Admin ${label}`, adminEmail);
    return { id: organizationId, name, admin };
  }

  /** Unidad y familia (dueña de la unidad) en el condominio del admin. */
  async createHousehold(admin: E2eActor, label: string): Promise<E2eHousehold> {
    const number = String(randomInt(100, 10_000));
    const unit = ensureStatus(
      await admin.http.post(`${API}/units`, {
        block: `E${uniqueSuffix().slice(-4).toUpperCase()}`,
        number,
        type: 'casa',
      }),
      [201],
      `crear la unidad de ${label}`,
    );
    const unitId = stringAt(unit.json, 'id', 'unidad');
    const house = stringAt(unit.json, 'identifier', 'unidad');
    const family = ensureStatus(
      await admin.http.post(`${API}/families`, {
        name: `Familia ${label} ${uniqueSuffix()}`,
        unitId,
      }),
      [201],
      `crear la familia de ${label}`,
    );
    return { unitId, house, familyId: stringAt(family.json, 'id', 'familia') };
  }

  /** Usuario del condominio del admin (con roles y familia), activado y con sesión. */
  async createMember(
    admin: E2eActor,
    options: CreateMemberOptions,
  ): Promise<E2eActor> {
    const roleIds = await Promise.all(
      options.roles.map((role) => this.roleId(role)),
    );
    const email = uniqueEmail(options.label);
    const name = `${options.label} E2E`;
    const response = ensureStatus(
      await admin.http.post(`${API}/users/create-by-admin`, {
        rut: randomRut(),
        name,
        email,
        phone: randomPhone(),
        age: 30,
        roleIds,
        ...(options.familyId ? { familyId: options.familyId } : {}),
      }),
      [201],
      `crear el usuario ${options.label}`,
    );
    const userId = stringAt(
      objectAt(response.json, 'user', 'usuario'),
      'id',
      'user',
    );
    return this.activate(userId, name, email);
  }

  /** Hub del condominio (lo provisiona el super-admin; el secret llega una vez). */
  async createHub(
    organizationId: string,
    type: 'physical-hub' | 'web-kiosk' = 'physical-hub',
  ): Promise<E2eHub> {
    const hubId = `e2e-hub-${uniqueSuffix()}`;
    const response = ensureStatus(
      await this.superAdmin.http.post(`${API}/hubs`, {
        hubId,
        location: 'Portón E2E',
        organizationId,
        type,
      }),
      [201],
      'provisionar el hub',
    );
    const secret = stringAt(response.json, 'secret', 'hub');
    return {
      hubId,
      organizationId,
      http: this.newClient({ 'x-hub-id': hubId, 'x-hub-secret': secret }),
    };
  }

  /** API key del LPR, emitida por el admin del condominio (queda vinculada a él). */
  async createServiceApiKey(admin: E2eActor): Promise<string> {
    const response = ensureStatus(
      await admin.http.post(`${API}/auth/service-api-keys`, {
        name: `LPR E2E ${uniqueSuffix()}`,
        duration: '30d',
      }),
      [201],
      'emitir la API key del LPR',
    );
    return stringAt(response.json, 'key', 'service api key');
  }

  /** Cliente del worker LPR (solo `x-api-key`). */
  lprClient(apiKey: string): E2eHttpClient {
    return this.newClient({ 'x-api-key': apiKey });
  }

  /** Cámara del condominio del admin (sin MediaMTX ni LPR manager en los e2e). */
  async createCamera(admin: E2eActor, label: string): Promise<E2eCamera> {
    const sourceUrl = `rtsp://e2e:clave-${uniqueSuffix()}@192.0.2.10:554/stream1`;
    const response = ensureStatus(
      await admin.http.post(`${API}/cameras`, {
        name: `Cámara ${label} ${uniqueSuffix()}`,
        location: 'Acceso vehicular',
        sourceUrl,
        active: true,
        enableLpr: false,
      }),
      [201],
      `crear la cámara de ${label}`,
    );
    return { id: stringAt(response.json, 'id', 'cámara'), sourceUrl };
  }

  /** Requests que recibió el servidor falso de OpenAI en esta corrida. */
  async fakeOpenAiRequests(): Promise<FakeOpenAiRequest[]> {
    const client = new E2eHttpClient({
      baseUrl: this.state.fakeOpenAi.url,
      origin: this.state.frontendOrigin,
    });
    const response = ensureStatus(
      await client.get(REQUESTS_PATH),
      [200],
      'leer el servidor falso de OpenAI',
    );
    return arrayAt(response.json, 'requests', 'fake OpenAI').map((entry) => {
      const request = asObject(entry, 'request');
      return {
        method: stringAt(request, 'method', 'request'),
        path: stringAt(request, 'path', 'request'),
        authorized: request.authorized === true,
      };
    });
  }

  /** Activa la cuenta con el token del email (vía endpoint) e inicia sesión. */
  private async activate(
    userId: string,
    name: string,
    email: string,
  ): Promise<E2eActor> {
    const token = await this.activationTokenFor(userId);
    const password = randomPassword();
    const http = this.newClient();
    ensureStatus(
      await http.post(`${API}/auth/reset-password`, { token, password }),
      [200, 201],
      `activar la cuenta ${email}`,
    );
    await signIn(http, email, password);
    return { id: userId, name, email, password, http };
  }

  /** Token del último link de activación/reset del usuario (tabla `verification`). */
  private async activationTokenFor(userId: string): Promise<string> {
    const client = new Client({
      ...this.state.database,
      connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    try {
      const { rows } = await client.query<{ identifier: string }>(
        `SELECT identifier FROM verification
          WHERE value = $1 AND identifier LIKE 'reset-password:%' AND "expiresAt" > now()
          ORDER BY "createdAt" DESC LIMIT 1`,
        [userId],
      );
      const identifier = rows[0]?.identifier;
      if (!identifier) {
        throw new Error(
          `No hay token de activación para el usuario ${userId} (¿la app no llamó a requestPasswordReset?)`,
        );
      }
      return identifier.slice('reset-password:'.length);
    } finally {
      await client.end();
    }
  }
}

/** `POST /api/auth/sign-in/email` (better-auth nativo): deja la cookie en `http`. */
export async function signIn(
  http: E2eHttpClient,
  email: string,
  password: string,
): Promise<void> {
  ensureStatus(
    await http.post(SIGN_IN_PATH, { email, password }),
    [200],
    `iniciar sesión como ${email}`,
  );
  if (!http.hasCookie(SESSION_COOKIE)) {
    throw new Error(
      `El login de ${email} no devolvió la cookie ${SESSION_COOKIE}`,
    );
  }
}
