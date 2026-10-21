import { randomInt } from 'node:crypto';
import { request, type IncomingHttpHeaders } from 'node:http';

/**
 * Cliente HTTP de los e2e (Fase 4 · P8), sobre `node:http` (sin dependencias
 * nuevas ni keep-alive: cada request abre y cierra su conexión).
 *
 *  - Guarda las cookies que responde el backend (la sesión de better-auth) y
 *    las reenvía: un cliente = un actor con su sesión.
 *  - Manda `Origin` = `FRONTEND_URL` en todo request, como el navegador
 *    (better-auth valida el origen de las requests con cookie).
 *  - Manda su propia IP en `X-Forwarded-For`. La app de prueba corre con
 *    `TRUST_PROXY=1` (como detrás del reverse proxy de producción), así cada
 *    actor tiene sus propios contadores de rate limit por IP (login de
 *    better-auth, rutas públicas) y los tests no se bloquean entre sí.
 */
export interface E2eResponse {
  status: number;
  headers: IncomingHttpHeaders;
  /** Cuerpo crudo. */
  text: string;
  /** JSON parseado si el cuerpo es JSON; si no, `null`. */
  json: unknown;
}

export interface E2eRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  /** Se serializa como JSON. */
  body?: unknown;
  /** Cuerpo literal (p. ej. para probar el límite de tamaño). */
  rawBody?: Buffer | string;
  headers?: Record<string, string>;
}

export interface E2eHttpClientOptions {
  baseUrl: string;
  origin: string;
  /** IP del actor (default: una aleatoria del rango de documentación 198.18.0.0/15). */
  clientIp?: string;
  /** Encabezados fijos (credenciales de hub o API key del LPR). */
  headers?: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 30_000;

/** IP aleatoria del rango reservado para pruebas de red (RFC 2544, 198.18.0.0/15). */
export function randomClientIp(): string {
  return `198.${18 + randomInt(2)}.${randomInt(256)}.${1 + randomInt(254)}`;
}

/**
 * Aplica los `Set-Cookie` de una respuesta al tarro. Una cookie vacía, con
 * `Max-Age<=0` o con `Expires` en el pasado se borra.
 */
export function applySetCookies(
  jar: Map<string, string>,
  setCookie: readonly string[] | undefined,
  now: number = Date.now(),
): void {
  for (const header of setCookie ?? []) {
    const [pair = '', ...attributes] = header.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    let expired = value === '';
    for (const attribute of attributes) {
      const [rawKey = '', rawValue = ''] = attribute.split('=');
      const key = rawKey.trim().toLowerCase();
      if (key === 'max-age' && Number(rawValue.trim()) <= 0) {
        expired = true;
      }
      if (key === 'expires') {
        const expiresAt = Date.parse(rawValue.trim());
        if (!Number.isNaN(expiresAt) && expiresAt <= now) {
          expired = true;
        }
      }
    }
    if (expired) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
}

function parseJson(text: string, headers: IncomingHttpHeaders): unknown {
  const contentType = headers['content-type'] ?? '';
  if (!contentType.includes('json') || text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class E2eHttpClient {
  readonly clientIp: string;
  private readonly cookies = new Map<string, string>();
  private readonly url: URL;

  constructor(private readonly options: E2eHttpClientOptions) {
    this.url = new URL(options.baseUrl);
    this.clientIp = options.clientIp ?? randomClientIp();
  }

  /** `Cookie` con la sesión actual (para el handshake del socket), o `undefined`. */
  cookieHeader(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }

  /** Copia SIN cookies, con la misma IP y encabezados extra. */
  withHeaders(headers: Record<string, string>): E2eHttpClient {
    return new E2eHttpClient({
      ...this.options,
      clientIp: this.clientIp,
      headers: { ...this.options.headers, ...headers },
    });
  }

  get(path: string, headers?: Record<string, string>): Promise<E2eResponse> {
    return this.request({ method: 'GET', path, headers });
  }

  post(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<E2eResponse> {
    return this.request({ method: 'POST', path, body, headers });
  }

  patch(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<E2eResponse> {
    return this.request({ method: 'PATCH', path, body, headers });
  }

  delete(path: string, headers?: Record<string, string>): Promise<E2eResponse> {
    return this.request({ method: 'DELETE', path, headers });
  }

  request(input: E2eRequest): Promise<E2eResponse> {
    const payload =
      input.rawBody !== undefined
        ? Buffer.isBuffer(input.rawBody)
          ? input.rawBody
          : Buffer.from(input.rawBody, 'utf8')
        : input.body !== undefined
          ? Buffer.from(JSON.stringify(input.body), 'utf8')
          : null;

    const headers: Record<string, string> = {
      accept: 'application/json',
      origin: this.options.origin,
      'x-forwarded-for': this.clientIp,
      ...this.options.headers,
      ...input.headers,
    };
    const cookie = this.cookieHeader();
    if (cookie !== undefined && headers.cookie === undefined) {
      headers.cookie = cookie;
    }
    if (payload !== null) {
      headers['content-type'] ??= 'application/json';
      headers['content-length'] = String(payload.length);
    }

    return new Promise((resolve, reject) => {
      const req = request(
        {
          protocol: this.url.protocol,
          hostname: this.url.hostname,
          port: this.url.port,
          path: input.path,
          method: input.method,
          headers,
          agent: false,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            applySetCookies(this.cookies, res.headers['set-cookie']);
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              text,
              json: parseJson(text, res.headers),
            });
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () =>
        req.destroy(new Error(`${input.method} ${input.path}: timeout`)),
      );
      req.on('error', reject);
      if (payload !== null) {
        req.write(payload);
      }
      req.end();
    });
  }
}
