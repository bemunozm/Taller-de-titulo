import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { IncomingMessage } from 'http';
import type { Server, ServerOptions } from 'socket.io';

/** Callback de `allowRequest` de engine.io: `(error, aceptar)`. */
type AllowRequestCallback = (
  error: string | null | undefined,
  success: boolean,
) => void;

/**
 * Normaliza la lista de orígenes permitidos a su serialización de origen
 * (`esquema://host[:puerto]`, sin ruta ni `/` final), que es lo que el
 * navegador manda en `Origin`. Lanza si alguno no es una URL http(s) válida o
 * si la lista queda vacía: el backend no arranca con el WebSocket abierto.
 */
export function normalizeAllowedOrigins(
  origins: readonly string[],
): readonly string[] {
  const normalized = origins.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Origen de WebSocket inválido: "${value}"`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Origen de WebSocket sin http(s): "${value}"`);
    }
    return url.origin;
  });
  if (normalized.length === 0) {
    throw new Error('Sin orígenes permitidos para el WebSocket');
  }
  return [...new Set(normalized)];
}

/**
 * ¿Se acepta un handshake con este `Origin`?
 *  - ausente: sí. Lo omiten los clientes que no son navegadores (vigilia-hub
 *    en Node); un navegador SIEMPRE lo manda en el upgrade a WebSocket y en
 *    el polling entre orígenes, que es donde está el riesgo (CSWSH: otra
 *    página usando la cookie de la víctima). Esos clientes igual tienen que
 *    autenticarse en el namespace (sesión o credencial de hub);
 *  - presente: solo si es EXACTAMENTE uno de la lista (`null`, vacío o
 *    cualquier otro valor se rechaza).
 */
export function isAllowedSocketOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (origin === undefined) {
    return true;
  }
  return allowedOrigins.has(origin);
}

/**
 * Fase 4 · P6.R (D13): adapter de socket.io de la app. Fija las opciones de
 * seguridad del servidor para TODOS los namespaces (`/` y `/hub`), sin
 * importar lo que digan los decoradores `@WebSocketGateway`:
 *  - CORS del polling: solo los orígenes del frontend, con `credentials`
 *    (la cookie de sesión de better-auth viaja en el handshake);
 *  - `allowRequest`: rechaza (403) el handshake, por polling o por
 *    WebSocket, cuyo `Origin` no está en la lista. CORS solo le impide al
 *    navegador LEER la respuesta del polling y no aplica al WebSocket, así
 *    que sin este chequeo una página ajena podía abrir el socket con la
 *    cookie de la víctima.
 *
 * Antes: `cors: { origin: '*' }` en los decoradores y nadie validaba `Origin`.
 */
export class VigiliaIoAdapter extends IoAdapter {
  private readonly logger = new Logger(VigiliaIoAdapter.name);
  private readonly allowedOrigins: readonly string[];
  private readonly allowedOriginSet: ReadonlySet<string>;

  constructor(
    appOrHttpServer: INestApplicationContext | object,
    allowedOrigins: readonly string[],
  ) {
    super(appOrHttpServer);
    this.allowedOrigins = normalizeAllowedOrigins(allowedOrigins);
    this.allowedOriginSet = new Set(this.allowedOrigins);
  }

  override createIOServer(
    port: number,
    options?: Partial<ServerOptions>,
  ): Server {
    const secured: Partial<ServerOptions> = {
      ...options,
      cors: {
        origin: [...this.allowedOrigins],
        credentials: true,
        methods: ['GET', 'POST'],
      },
      allowRequest: (req: IncomingMessage, callback: AllowRequestCallback) => {
        this.allowRequest(req, callback);
      },
    };
    return super.createIOServer(port, secured) as Server;
  }

  private allowRequest(
    req: IncomingMessage,
    callback: AllowRequestCallback,
  ): void {
    const origin = req.headers.origin;
    if (isAllowedSocketOrigin(origin, this.allowedOriginSet)) {
      callback(null, true);
      return;
    }
    // Header que controla el cliente: truncado y escapado (sin saltos de
    // línea ni caracteres de control en el log).
    this.logger.warn(
      `Handshake de WebSocket rechazado por origen no permitido: ${JSON.stringify(String(origin).slice(0, 100))}`,
    );
    callback('origin not allowed', false);
  }
}
