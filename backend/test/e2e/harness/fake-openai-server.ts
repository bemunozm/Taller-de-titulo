import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * Servidor falso de OpenAI para los e2e (Fase 4 · P8). La app de prueba lo
 * usa vía `OPENAI_API_BASE_URL` (token de voz) y `OPENAI_BASE_URL` (SDK).
 *
 *  - `POST /v1/realtime/client_secrets`: con `Authorization: Bearer <key>`
 *    correcta responde un token efímero ficticio (forma GA: `{ value,
 *    expires_at }`); con otra, 401.
 *  - `GET /__e2e/requests`: las requests recibidas (método, ruta y si traía la
 *    key correcta; nunca la key), para que los tests verifiquen que la app
 *    habló con este servidor y no con la API real.
 *  - Cualquier otra ruta: 404 (queda registrada: una llamada inesperada se ve).
 */
export const CLIENT_SECRETS_PATH = '/v1/realtime/client_secrets';
export const REQUESTS_PATH = '/__e2e/requests';

export interface FakeOpenAiRequest {
  method: string;
  path: string;
  /** `true` si traía `Authorization: Bearer <apiKey esperada>`. */
  authorized: boolean;
}

export interface FakeOpenAiServer {
  readonly url: string;
  readonly port: number;
  readonly ephemeralToken: string;
  readonly requests: readonly FakeOpenAiRequest[];
  close(): Promise<void>;
}

export interface FakeOpenAiOptions {
  expectedApiKey: string;
  host?: string;
  /** Default: `ek_e2e_<hex>` aleatorio por servidor. */
  ephemeralToken?: string;
  /** Segundos de validez del token (default 60, como el real). */
  tokenTtlSeconds?: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Consume el body (sin guardarlo) antes de responder. */
function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    req.on('data', () => undefined);
    req.on('end', () => resolve());
    req.on('error', () => resolve());
  });
}

function pathOf(req: IncomingMessage): string {
  const [path = '/'] = (req.url ?? '/').split('?');
  return path;
}

export function startFakeOpenAiServer(
  options: FakeOpenAiOptions,
): Promise<FakeOpenAiServer> {
  const host = options.host ?? '127.0.0.1';
  const ephemeralToken =
    options.ephemeralToken ?? `ek_e2e_${randomBytes(12).toString('hex')}`;
  const ttlSeconds = options.tokenTtlSeconds ?? 60;
  const expectedAuthorization = `Bearer ${options.expectedApiKey}`;
  const requests: FakeOpenAiRequest[] = [];

  const server: Server = createServer((req, res) => {
    void drain(req).then(() => {
      const path = pathOf(req);
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'GET' && path === REQUESTS_PATH) {
        sendJson(res, 200, { requests });
        return;
      }

      const authorized = req.headers.authorization === expectedAuthorization;
      requests.push({ method, path, authorized });

      if (method === 'POST' && path === CLIENT_SECRETS_PATH) {
        if (!authorized) {
          sendJson(res, 401, {
            error: {
              message: 'Incorrect API key provided',
              code: 'invalid_api_key',
            },
          });
          return;
        }
        sendJson(res, 200, {
          value: ephemeralToken,
          expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
          session: { type: 'realtime', model: 'gpt-realtime-mini' },
        });
        return;
      }

      sendJson(res, 404, {
        error: {
          message: `Servidor falso de OpenAI: ${method} ${path} no está simulado`,
        },
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('El servidor falso de OpenAI no obtuvo un puerto'));
        return;
      }
      resolve({
        url: `http://${host}:${address.port}`,
        port: address.port,
        ephemeralToken,
        requests,
        close: () => closeServer(server),
      });
    });
  });
}

/** Cierra el servidor y sus conexiones keep-alive (las del `fetch` del backend). */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
