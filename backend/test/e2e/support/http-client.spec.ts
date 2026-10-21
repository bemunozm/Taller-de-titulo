import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { closeServer } from '../harness/fake-openai-server';
import { applySetCookies, E2eHttpClient, randomClientIp } from './http-client';

/**
 * Pieza unitaria del harness e2e (Fase 4 · P8): el cliente HTTP guarda y
 * reenvía la sesión (cookies), manda `Origin` y su IP en `X-Forwarded-For`,
 * y serializa el body. Contra un servidor local que refleja la request.
 */
describe('E2eHttpClient (harness e2e)', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { headers: IncomingHttpHeaders; body: string; url: string };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        lastRequest = {
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          url: req.url ?? '',
        };
        if (req.url === '/login') {
          res.setHeader('set-cookie', [
            'better-auth.session_token=abc.firma; Path=/; HttpOnly; SameSite=Lax',
            'otra=1; Path=/',
          ]);
        }
        if (req.url === '/logout') {
          res.setHeader('set-cookie', [
            'better-auth.session_token=; Max-Age=0; Path=/',
          ]);
        }
        if (req.url === '/texto') {
          res.setHeader('content-type', 'text/plain');
          res.end('hola');
          return;
        }
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('sin puerto');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  it('manda Origin, su IP en X-Forwarded-For y el body como JSON', async () => {
    const client = new E2eHttpClient({
      baseUrl,
      origin: 'http://localhost:5173',
      clientIp: '198.18.0.7',
    });

    const response = await client.post('/eco?x=1', { email: 'a@b.test' });

    expect(response.status).toBe(200);
    expect(response.json).toEqual({ ok: true });
    expect(lastRequest.url).toBe('/eco?x=1');
    expect(lastRequest.headers.origin).toBe('http://localhost:5173');
    expect(lastRequest.headers['x-forwarded-for']).toBe('198.18.0.7');
    expect(lastRequest.headers['content-type']).toBe('application/json');
    expect(lastRequest.body).toBe('{"email":"a@b.test"}');
    expect(lastRequest.headers.cookie).toBeUndefined();
  });

  it('guarda las cookies del login, las reenvía y las borra al expirar', async () => {
    const client = new E2eHttpClient({
      baseUrl,
      origin: 'http://localhost:5173',
    });

    await client.post('/login', {});
    await client.get('/perfil');

    expect(client.hasCookie('better-auth.session_token')).toBe(true);
    expect(lastRequest.headers.cookie).toBe(
      'better-auth.session_token=abc.firma; otra=1',
    );

    await client.post('/logout');
    await client.get('/perfil');

    expect(client.hasCookie('better-auth.session_token')).toBe(false);
    expect(lastRequest.headers.cookie).toBe('otra=1');
  });

  it('withHeaders: mismos encabezados extra e IP, sin las cookies', async () => {
    const client = new E2eHttpClient({
      baseUrl,
      origin: 'http://localhost:5173',
    });
    await client.post('/login', {});

    const device = client.withHeaders({
      'x-hub-id': 'hub-1',
      'x-hub-secret': 's',
    });
    await device.get('/x');

    expect(lastRequest.headers['x-hub-id']).toBe('hub-1');
    expect(lastRequest.headers['x-hub-secret']).toBe('s');
    expect(lastRequest.headers['x-forwarded-for']).toBe(client.clientIp);
    expect(lastRequest.headers.cookie).toBeUndefined();
  });

  it('rawBody se manda literal y una respuesta no JSON deja json en null', async () => {
    const client = new E2eHttpClient({
      baseUrl,
      origin: 'http://localhost:5173',
    });

    const response = await client.request({
      method: 'POST',
      path: '/texto',
      rawBody: '{"a":',
    });

    expect(lastRequest.body).toBe('{"a":');
    expect(lastRequest.headers['content-length']).toBe('5');
    expect(response.text).toBe('hola');
    expect(response.json).toBeNull();
  });
});

describe('applySetCookies (harness e2e)', () => {
  it('borra con Expires en el pasado y conserva con Expires futuro', () => {
    const jar = new Map<string, string>([['s', 'viejo']]);
    const now = Date.parse('2026-10-09T12:00:00Z');

    applySetCookies(
      jar,
      ['s=nuevo; Expires=Fri, 09 Oct 2026 13:00:00 GMT'],
      now,
    );
    expect(jar.get('s')).toBe('nuevo');

    applySetCookies(
      jar,
      ['s=nuevo; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],
      now,
    );
    expect(jar.has('s')).toBe(false);
  });

  it('ignora encabezados mal formados', () => {
    const jar = new Map<string, string>();

    applySetCookies(jar, ['sin-igual', '=valor-sin-nombre'], Date.now());

    expect(jar.size).toBe(0);
  });
});

describe('randomClientIp (harness e2e)', () => {
  it('genera IPs del rango de pruebas 198.18.0.0/15', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomClientIp()).toMatch(/^198\.(18|19)\.\d{1,3}\.\d{1,3}$/);
    }
  });
});
