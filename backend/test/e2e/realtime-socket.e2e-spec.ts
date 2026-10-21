// Utilidad pura de pruebas (node:http + ws): no arrastra código del backend.
import {
  pollingHandshake,
  RawSocketIoClient,
  type NamespaceConnectResult,
} from '../../src/test-utils/socket-io-raw-client';
import { E2eScenario, SESSION_COOKIE } from './support/scenario';

/**
 * Socket.io del namespace `/` (Fase 4 · P8; reglas de la P6.R): el handshake
 * exige la cookie de sesión de better-auth (sin ella, CONNECT_ERROR
 * `unauthorized`) y un `Origin` de la lista (si no, 403).
 */
const CONNECT_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label}: sin respuesta en ${CONNECT_TIMEOUT_MS} ms`),
        ),
      CONNECT_TIMEOUT_MS,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe('Socket `/` (e2e)', () => {
  let scenario: E2eScenario;
  const openClients: RawSocketIoClient[] = [];

  beforeAll(async () => {
    scenario = await E2eScenario.start();
  });

  afterEach(() => {
    for (const client of openClients.splice(0)) {
      client.close();
    }
  });

  /** Abre el WebSocket con el `Origin` del frontend y pide el CONNECT a `/`. */
  async function connectRoot(cookie?: string): Promise<NamespaceConnectResult> {
    const opened = await withTimeout(
      RawSocketIoClient.open(scenario.state.port, {
        origin: scenario.state.frontendOrigin,
        ...(cookie !== undefined ? { cookie } : {}),
      }),
      'upgrade a WebSocket',
    );
    if (!opened.ok) {
      throw new Error(
        `El upgrade a WebSocket falló (${String(opened.status)}): ${opened.body}`,
      );
    }
    openClients.push(opened.client);
    return withTimeout(opened.client.connectNamespace('/'), 'CONNECT a /');
  }

  it('sin sesión se rechaza con unauthorized', async () => {
    await expect(connectRoot()).resolves.toEqual({
      ok: false,
      message: 'unauthorized',
    });
  });

  it('con una cookie de sesión inválida se rechaza con unauthorized', async () => {
    await expect(
      connectRoot(`${SESSION_COOKIE}=sesion-inventada.firma-falsa`),
    ).resolves.toEqual({ ok: false, message: 'unauthorized' });
  });

  it('control: con la sesión del super-admin conecta', async () => {
    const cookie = scenario.superAdmin.http.cookieHeader();
    expect(cookie).toBeDefined();

    const result = await connectRoot(cookie);

    expect(result.ok).toBe(true);
  });

  it('un Origin ajeno se rechaza en el handshake (403)', async () => {
    const response = await withTimeout(
      pollingHandshake(scenario.state.port, { origin: 'http://evil.example' }),
      'handshake por polling',
    );

    expect(response.status).toBe(403);
  });
});
