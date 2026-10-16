import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  isAllowedSocketOrigin,
  normalizeAllowedOrigins,
  VigiliaIoAdapter,
} from './vigilia-io.adapter';
import {
  pollingHandshake,
  RawSocketIoClient,
} from '../../test-utils/socket-io-raw-client';

const FRONTEND_ORIGIN = 'http://localhost:5173';
const FOREIGN_ORIGIN = 'https://evil.example';

/**
 * Gateways de prueba. El de `/probe` declara `cors: { origin: '*' }` a
 * propósito: el adapter debe imponerse a lo que diga el decorador.
 */
@WebSocketGateway()
class RootProbeGateway {
  @SubscribeMessage('ping')
  ping(): string {
    return 'pong';
  }
}

@WebSocketGateway({ namespace: '/probe', cors: { origin: '*' } })
class OpenCorsProbeGateway {
  @SubscribeMessage('ping')
  ping(): string {
    return 'pong-probe';
  }
}

describe('normalizeAllowedOrigins / isAllowedSocketOrigin', () => {
  it('normaliza a la serialización de origen (sin ruta ni / final) y deduplica', () => {
    expect(
      normalizeAllowedOrigins([
        'http://localhost:5173/',
        'http://localhost:5173/app',
        'https://app.vigilia.cl',
      ]),
    ).toEqual(['http://localhost:5173', 'https://app.vigilia.cl']);
  });

  it.each([[['no-es-url']], [['ftp://archivos.cl']], [[]]])(
    'falla rápido con %p',
    (origins) => {
      expect(() => normalizeAllowedOrigins(origins)).toThrow();
    },
  );

  it('acepta Origin ausente o exacto; rechaza null, vacío, subdominios y variantes', () => {
    const allowed = new Set([FRONTEND_ORIGIN]);
    expect(isAllowedSocketOrigin(undefined, allowed)).toBe(true);
    expect(isAllowedSocketOrigin(FRONTEND_ORIGIN, allowed)).toBe(true);
    for (const origin of [
      'null',
      '',
      FOREIGN_ORIGIN,
      'http://localhost:5174',
      'http://localhost:5173.evil.example',
      'http://LOCALHOST:5173',
      `${FRONTEND_ORIGIN}/`,
    ]) {
      expect(isAllowedSocketOrigin(origin, allowed)).toBe(false);
    }
  });
});

/**
 * Sonda REAL (Fase 4 · P6.R, D13): app Nest escuchando en un puerto efímero
 * con `VigiliaIoAdapter`, handshakes por HTTP long-polling y por WebSocket
 * directo. Antes `cors: { origin: '*' }` y ningún chequeo de `Origin`: una
 * página ajena abría el socket con la cookie de la víctima.
 */
describe('VigiliaIoAdapter (servidor real)', () => {
  let app: INestApplication | undefined;
  let port: number;
  const openClients: RawSocketIoClient[] = [];

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const moduleRef = await Test.createTestingModule({
      providers: [RootProbeGateway, OpenCorsProbeGateway],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useWebSocketAdapter(new VigiliaIoAdapter(app, [FRONTEND_ORIGIN]));
    await app.listen(0, '127.0.0.1');
    const httpServer = app.getHttpServer() as HttpServer;
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(() => {
    for (const client of openClients.splice(0)) {
      client.close();
    }
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  async function openWebSocket(origin?: string) {
    const result = await RawSocketIoClient.open(port, { origin });
    if (result.ok) {
      openClients.push(result.client);
    }
    return result;
  }

  describe('polling', () => {
    it('Origin ajeno -> 403 (sin sid ni cabeceras CORS para él)', async () => {
      const response = await pollingHandshake(port, { origin: FOREIGN_ORIGIN });

      expect(response.status).toBe(403);
      expect(response.body).not.toContain('"sid"');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('Origin "null" (iframe con sandbox, file://) -> 403', async () => {
      const response = await pollingHandshake(port, { origin: 'null' });
      expect(response.status).toBe(403);
    });

    it('Origin del frontend -> 200 con CORS exacto y credenciales (nunca *)', async () => {
      const response = await pollingHandshake(port, {
        origin: FRONTEND_ORIGIN,
      });

      expect(response.status).toBe(200);
      expect(response.body.startsWith('0{')).toBe(true);
      expect(response.headers['access-control-allow-origin']).toBe(
        FRONTEND_ORIGIN,
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('sin Origin (cliente Node, p. ej. vigilia-hub) -> 200', async () => {
      const response = await pollingHandshake(port);

      expect(response.status).toBe(200);
      expect(response.body.startsWith('0{')).toBe(true);
    });
  });

  describe('WebSocket directo', () => {
    it('Origin ajeno -> upgrade rechazado por allowRequest (engine.io responde 400 + motivo)', async () => {
      const result = await openWebSocket(FOREIGN_ORIGIN);
      // engine.io (`abortUpgrade`) siempre contesta un upgrade rechazado con
      // 400 y el mensaje de `allowRequest` como cuerpo.
      expect(result).toEqual({
        ok: false,
        status: 400,
        body: 'origin not allowed',
      });
    });

    it('Origin "null" -> upgrade rechazado', async () => {
      const result = await openWebSocket('null');
      expect(result).toEqual(
        expect.objectContaining({ ok: false, body: 'origin not allowed' }),
      );
    });

    it('Origin del frontend -> abre y conecta al namespace /', async () => {
      const result = await openWebSocket(FRONTEND_ORIGIN);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      await expect(result.client.connectNamespace('/')).resolves.toEqual(
        expect.objectContaining({ ok: true }),
      );
      await expect(result.client.emitWithAck('ping', {})).resolves.toBe('pong');
    });

    it('sin Origin -> abre (clientes Node)', async () => {
      const result = await openWebSocket(undefined);
      expect(result.ok).toBe(true);
    });
  });

  it('el cors "*" de un decorador no abre nada: rige para todos los namespaces', async () => {
    expect((await openWebSocket(FOREIGN_ORIGIN)).ok).toBe(false);

    const result = await openWebSocket(FRONTEND_ORIGIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.client.connectNamespace('/probe')).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    await expect(result.client.emitWithAck('ping', {}, '/probe')).resolves.toBe(
      'pong-probe',
    );

    const polling = await pollingHandshake(port, { origin: FRONTEND_ORIGIN });
    expect(polling.headers['access-control-allow-origin']).toBe(
      FRONTEND_ORIGIN,
    );
  });
});
