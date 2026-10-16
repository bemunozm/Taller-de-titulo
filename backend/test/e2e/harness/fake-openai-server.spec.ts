import { E2eHttpClient } from '../support/http-client';
import {
  CLIENT_SECRETS_PATH,
  REQUESTS_PATH,
  startFakeOpenAiServer,
  type FakeOpenAiServer,
} from './fake-openai-server';

/**
 * Pieza unitaria del harness e2e (Fase 4 · P8): el servidor falso de OpenAI
 * responde lo que `RealtimeVoiceTokenService` espera (forma GA `{ value,
 * expires_at }`) solo con la API key correcta, y registra lo que recibe.
 */
describe('startFakeOpenAiServer (harness e2e)', () => {
  const API_KEY = 'sk-e2e-unit-test';
  let server: FakeOpenAiServer;
  let client: E2eHttpClient;

  beforeEach(async () => {
    server = await startFakeOpenAiServer({ expectedApiKey: API_KEY });
    client = new E2eHttpClient({
      baseUrl: server.url,
      origin: 'http://localhost:5173',
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('escucha en loopback con un puerto propio y un token ek_e2e_ aleatorio', () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.ephemeralToken).toMatch(/^ek_e2e_[0-9a-f]{24}$/);
  });

  it('client_secrets con la key correcta: 200 con el token y su vencimiento', async () => {
    const before = Math.floor(Date.now() / 1000);

    const response = await client.post(
      CLIENT_SECRETS_PATH,
      {},
      { authorization: `Bearer ${API_KEY}` },
    );

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      value: server.ephemeralToken,
      expires_at: expect.any(Number) as unknown,
      session: { type: 'realtime', model: 'gpt-realtime-mini' },
    });
    const expiresAt = (response.json as { expires_at: number }).expires_at;
    expect(expiresAt).toBeGreaterThanOrEqual(before + 59);
    expect(server.requests).toEqual([
      { method: 'POST', path: CLIENT_SECRETS_PATH, authorized: true },
    ]);
  });

  it('client_secrets con otra key o sin key: 401', async () => {
    const wrong = await client.post(
      CLIENT_SECRETS_PATH,
      {},
      { authorization: 'Bearer sk-otra' },
    );
    const missing = await client.post(CLIENT_SECRETS_PATH, {});

    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(server.requests.map((request) => request.authorized)).toEqual([
      false,
      false,
    ]);
  });

  it('una ruta no simulada responde 404 y queda registrada', async () => {
    const response = await client.post(
      '/v1/chat/completions',
      { model: 'x' },
      { authorization: `Bearer ${API_KEY}` },
    );

    expect(response.status).toBe(404);
    expect(server.requests).toEqual([
      { method: 'POST', path: '/v1/chat/completions', authorized: true },
    ]);
  });

  it(`${REQUESTS_PATH} devuelve lo recibido sin registrarse a sí mismo y sin la key`, async () => {
    await client.post(
      `${CLIENT_SECRETS_PATH}?beta=1`,
      {},
      { authorization: `Bearer ${API_KEY}` },
    );

    const response = await client.get(REQUESTS_PATH);

    expect(response.status).toBe(200);
    expect(response.json).toEqual({
      requests: [
        { method: 'POST', path: CLIENT_SECRETS_PATH, authorized: true },
      ],
    });
    expect(response.text).not.toContain(API_KEY);
  });

  it('close() es idempotente', async () => {
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });
});
