import { Logger } from '@nestjs/common';
import type { LogsService } from '../../logs/logs.service';
import { RealtimeVoiceTokenService } from './realtime-voice-token.service';

/**
 * Fase 4 · P7.L: el `client_secret` de OpenAI Realtime (una credencial para
 * abrir una sesión de voz) nunca llega a los logs: ni el payload completo ni
 * un prefijo del token.
 */
describe('RealtimeVoiceTokenService — sin el client_secret en los logs (Fase 4 · P7.L)', () => {
  const SECRET = 'ek_68af1e9b5c3d7f2a90e4b1c6d8f0a2b3';
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  let lines: string[];
  let logsService: { log: jest.Mock };
  let service: RealtimeVoiceTokenService;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    lines = [];
    const capture = (message: unknown, ...rest: unknown[]): void => {
      lines.push([message, ...rest].map(String).join(' '));
    };
    for (const level of ['log', 'debug', 'error', 'warn'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(capture);
    }
    logsService = { log: jest.fn().mockResolvedValue(undefined) };
    service = new RealtimeVoiceTokenService(
      logsService as unknown as LogsService,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    jest.restoreAllMocks();
  });

  function mockFetchJson(body: unknown): void {
    const fetchMock: jest.Mock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    });
    global.fetch = fetchMock;
  }

  function persisted(): string {
    return JSON.stringify(logsService.log.mock.calls);
  }

  it('respuesta estándar: devuelve el token y no lo loguea (ni su prefijo)', async () => {
    mockFetchJson({
      client_secret: { value: SECRET, expires_at: 1_791_500_000 },
      session: { model: 'gpt-realtime-mini' },
    });

    const result = await service.generateEphemeralToken();

    expect(result.token).toBe(SECRET);
    expect(result.expiresAt).toEqual(new Date(1_791_500_000 * 1000));
    const all = lines.join('\n') + persisted();
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(SECRET.slice(0, 10));
  });

  it('respuesta simplificada ({ value, expires_at }) también funciona', async () => {
    mockFetchJson({ value: SECRET, expires_at: 1_791_500_000 });

    await expect(service.generateEphemeralToken()).resolves.toEqual({
      token: SECRET,
      expiresAt: new Date(1_791_500_000 * 1000),
    });
    expect(lines.join('\n')).not.toContain(SECRET.slice(0, 10));
  });

  it('sin client_secret: falla y el error solo nombra los campos recibidos', async () => {
    mockFetchJson({
      session: { id: 'sess_1', instructions: 'datos internos' },
    });

    await expect(service.generateEphemeralToken()).rejects.toThrow(
      'Failed to generate OpenAI ephemeral token',
    );

    const all = lines.join('\n') + persisted();
    expect(all).toContain('campos: session');
    expect(all).not.toContain('datos internos');
    expect(all).not.toContain('sess_1');
  });
});

/**
 * Fase 4 · P8: la base de la API es configurable (`OPENAI_API_BASE_URL`) para
 * que los e2e apunten a un servidor falso local; por defecto, la oficial.
 */
describe('RealtimeVoiceTokenService — OPENAI_API_BASE_URL (Fase 4 · P8)', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalBaseUrl = process.env.OPENAI_API_BASE_URL;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    delete process.env.OPENAI_API_BASE_URL;
    for (const level of ['log', 'debug', 'error', 'warn'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ value: 'ek_test', expires_at: 1_791_500_000 }),
      text: () => Promise.resolve(''),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENAI_API_KEY = originalKey;
    if (originalBaseUrl === undefined) {
      delete process.env.OPENAI_API_BASE_URL;
    } else {
      process.env.OPENAI_API_BASE_URL = originalBaseUrl;
    }
    jest.restoreAllMocks();
  });

  function buildService(): RealtimeVoiceTokenService {
    const logsService = { log: jest.fn().mockResolvedValue(undefined) };
    return new RealtimeVoiceTokenService(logsService as unknown as LogsService);
  }

  function requestedUrl(): unknown {
    const [url] = fetchMock.mock.calls[0] as [unknown, unknown];
    return url;
  }

  it('sin la variable usa la API oficial', async () => {
    await buildService().generateEphemeralToken();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestedUrl()).toBe(
      'https://api.openai.com/v1/realtime/client_secrets',
    );
  });

  it('con la variable usa esa base (sin duplicar la "/" final) y manda la API key', async () => {
    process.env.OPENAI_API_BASE_URL = 'http://127.0.0.1:43123/';

    await buildService().generateEphemeralToken();

    expect(requestedUrl()).toBe(
      'http://127.0.0.1:43123/v1/realtime/client_secrets',
    );
    const [, init] = fetchMock.mock.calls[0] as [
      unknown,
      { method?: string; headers?: Record<string, string> },
    ];
    expect(init.method).toBe('POST');
    expect(init.headers?.Authorization).toBe('Bearer sk-test-key');
  });

  it('respeta una ruta base (proxy) delante de /v1', async () => {
    process.env.OPENAI_API_BASE_URL = 'https://proxy.interno/openai';

    await buildService().generateEphemeralToken();

    expect(requestedUrl()).toBe(
      'https://proxy.interno/openai/v1/realtime/client_secrets',
    );
  });

  it('una base inválida detiene la construcción (fail-closed)', () => {
    process.env.OPENAI_API_BASE_URL = 'ftp://api.openai.com';

    expect(() => buildService()).toThrow(/OPENAI_API_BASE_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
