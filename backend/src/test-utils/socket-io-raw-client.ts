import { request as httpRequest } from 'node:http';
import WebSocket from 'ws';

/**
 * Cliente mínimo de socket.io (protocolo engine.io v4 + socket.io v5) sobre
 * `ws`, para las sondas de integración de los gateways contra un servidor
 * REAL (Fase 4 · P6.R). Evita agregar `socket.io-client` como dependencia:
 * `ws` ya viene con socket.io (engine.io).
 *
 * Paquetes engine.io: `0` open, `2` ping, `3` pong, `4` mensaje.
 * Paquetes socket.io (dentro de `4`): `0` CONNECT, `1` DISCONNECT, `2` EVENT,
 * `3` ACK, `4` CONNECT_ERROR; namespace distinto de `/` como `/hub,`.
 */

export interface RawHandshakeOptions {
  origin?: string;
  cookie?: string;
}

/** Respuesta del handshake por polling (sin seguir con la sesión). */
export interface PollingHandshakeResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

/** Handshake de engine.io por HTTP long-polling (primer request de un cliente). */
export function pollingHandshake(
  port: number,
  options: RawHandshakeOptions = {},
): Promise<PollingHandshakeResult> {
  const headers: Record<string, string> = {};
  if (options.origin !== undefined) {
    headers.origin = options.origin;
  }
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/socket.io/?EIO=4&transport=polling',
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Resultado del upgrade a WebSocket. */
export type WebSocketOpenResult =
  | { ok: true; client: RawSocketIoClient }
  | { ok: false; status: number | null; body: string };

interface ReceivedEvent {
  namespace: string;
  event: string;
  data: unknown;
}

interface Waiter<T> {
  match: (value: T) => boolean;
  resolve: (value: T) => void;
}

/** Conexión de engine.io por WebSocket con multiplexado de namespaces. */
export class RawSocketIoClient {
  readonly events: ReceivedEvent[] = [];
  /** Namespaces que el servidor desconectó (paquete DISCONNECT). */
  readonly disconnectedNamespaces: string[] = [];
  private closed = false;
  private readonly closeWaiters: Array<() => void> = [];
  private readonly eventWaiters: Waiter<ReceivedEvent>[] = [];
  private readonly connectWaiters = new Map<
    string,
    (result: NamespaceConnectResult) => void
  >();
  private readonly ackWaiters = new Map<number, (data: unknown) => void>();
  private nextAckId = 0;

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw: WebSocket.RawData) => {
      this.onEnginePacket(rawDataToString(raw));
    });
    ws.on('close', () => {
      this.closed = true;
      for (const waiter of this.closeWaiters.splice(0)) {
        waiter();
      }
    });
  }

  /**
   * Abre la conexión por WebSocket directo (`transport=websocket`). Si el
   * servidor rechaza el upgrade, devuelve el status HTTP.
   */
  static open(
    port: number,
    options: RawHandshakeOptions = {},
  ): Promise<WebSocketOpenResult> {
    const headers: Record<string, string> = {};
    if (options.cookie !== undefined) {
      headers.cookie = options.cookie;
    }
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`,
      {
        headers,
        ...(options.origin !== undefined ? { origin: options.origin } : {}),
      },
    );
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: WebSocketOpenResult): void => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      ws.once('unexpected-response', (_req, res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          settle({
            ok: false,
            status: res.statusCode ?? null,
            body: Buffer.concat(chunks).toString('utf8'),
          });
          ws.terminate();
        });
      });
      ws.once('error', () => settle({ ok: false, status: null, body: '' }));
      // El servidor manda el paquete OPEN (`0{...}`) apenas abre.
      ws.once('message', (raw: WebSocket.RawData) => {
        const packet = rawDataToString(raw);
        if (packet.startsWith('0')) {
          settle({ ok: true, client: new RawSocketIoClient(ws) });
        } else {
          settle({ ok: false, status: null, body: packet });
          ws.terminate();
        }
      });
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** CONNECT a un namespace: `{ ok: true, sid }` o el mensaje de CONNECT_ERROR. */
  connectNamespace(namespace = '/'): Promise<NamespaceConnectResult> {
    return new Promise((resolve) => {
      this.connectWaiters.set(namespace, resolve);
      this.send(`0${namespacePrefix(namespace)}`);
    });
  }

  emit(event: string, data: unknown, namespace = '/'): void {
    this.send(`2${namespacePrefix(namespace)}${JSON.stringify([event, data])}`);
  }

  /** EVENT con ack: resuelve con el primer argumento del ack. */
  emitWithAck(event: string, data: unknown, namespace = '/'): Promise<unknown> {
    const id = this.nextAckId++;
    return new Promise((resolve) => {
      this.ackWaiters.set(id, resolve);
      this.send(
        `2${namespacePrefix(namespace)}${id}${JSON.stringify([event, data])}`,
      );
    });
  }

  /** Espera un evento (ya recibido o futuro). Rechaza tras `timeoutMs`. */
  waitForEvent(event: string, timeoutMs = 2_000): Promise<unknown> {
    const existing = this.events.find((received) => received.event === event);
    if (existing) {
      return Promise.resolve(existing.data);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Evento ${event} no recibido`)),
        timeoutMs,
      );
      this.eventWaiters.push({
        match: (received) => received.event === event,
        resolve: (received) => {
          clearTimeout(timer);
          resolve(received.data);
        },
      });
    });
  }

  /** Espera a que el servidor cierre la conexión. Rechaza tras `timeoutMs`. */
  waitForClose(timeoutMs = 2_000): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('El servidor no cerró la conexión')),
        timeoutMs,
      );
      this.closeWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  eventsNamed(event: string): unknown[] {
    return this.events
      .filter((received) => received.event === event)
      .map((received) => received.data);
  }

  close(): void {
    if (!this.closed) {
      this.ws.terminate();
    }
  }

  /** Envía un paquete de socket.io (`0` CONNECT, `2` EVENT...) dentro de un MESSAGE. */
  private send(packet: string): void {
    // `4` = MESSAGE de engine.io.
    this.ws.send(`4${packet}`);
  }

  private onEnginePacket(packet: string): void {
    if (packet === '2') {
      this.ws.send('3'); // pong
      return;
    }
    if (packet.startsWith('4')) {
      this.onSocketPacket(packet.slice(1));
    }
  }

  private onSocketPacket(packet: string): void {
    const type = packet[0];
    let rest = packet.slice(1);
    let namespace = '/';
    if (rest.startsWith('/')) {
      const comma = rest.indexOf(',');
      namespace = comma === -1 ? rest : rest.slice(0, comma);
      rest = comma === -1 ? '' : rest.slice(comma + 1);
    }
    const ackMatch = /^(\d+)/.exec(rest);
    const ackId = ackMatch ? Number(ackMatch[1]) : null;
    if (ackMatch) {
      rest = rest.slice(ackMatch[1].length);
    }
    const payload: unknown = rest.length > 0 ? JSON.parse(rest) : undefined;

    switch (type) {
      case '0': {
        const sid =
          typeof payload === 'object' && payload !== null
            ? (payload as { sid?: unknown }).sid
            : undefined;
        this.connectWaiters.get(namespace)?.({
          ok: true,
          sid: typeof sid === 'string' ? sid : '',
        });
        this.connectWaiters.delete(namespace);
        return;
      }
      case '4': {
        const message =
          typeof payload === 'object' && payload !== null
            ? (payload as { message?: unknown }).message
            : undefined;
        this.connectWaiters.get(namespace)?.({
          ok: false,
          message: typeof message === 'string' ? message : '',
        });
        this.connectWaiters.delete(namespace);
        return;
      }
      case '1': {
        this.disconnectedNamespaces.push(namespace);
        return;
      }
      case '2': {
        if (!Array.isArray(payload) || typeof payload[0] !== 'string') {
          return;
        }
        const received: ReceivedEvent = {
          namespace,
          event: payload[0],
          data: payload[1],
        };
        this.events.push(received);
        for (const waiter of this.eventWaiters.splice(0)) {
          if (waiter.match(received)) {
            waiter.resolve(received);
          } else {
            this.eventWaiters.push(waiter);
          }
        }
        return;
      }
      case '3': {
        if (ackId !== null && Array.isArray(payload)) {
          this.ackWaiters.get(ackId)?.(payload[0]);
          this.ackWaiters.delete(ackId);
        }
        return;
      }
      default:
        return;
    }
  }
}

export type NamespaceConnectResult =
  | { ok: true; sid: string }
  | { ok: false; message: string };

function namespacePrefix(namespace: string): string {
  return namespace === '/' ? '' : `${namespace},`;
}

function rawDataToString(raw: WebSocket.RawData): string {
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8');
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  return Buffer.from(raw).toString('utf8');
}
