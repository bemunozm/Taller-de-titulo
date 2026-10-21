import { createServer, type Server, type Socket } from 'node:net';

/**
 * Sumidero SMTP para los e2e (Fase 4 · P8): acepta y descarta los emails de
 * activación/reset que manda la app al crear cuentas. Sin él, nodemailer
 * intentaría un SMTP real o tardaría en fallar contra un puerto cerrado.
 *
 * Protocolo mínimo (RFC 5321) sin AUTH ni STARTTLS: nodemailer solo
 * autentica si el servidor anuncia AUTH, y sin STARTTLS envía en claro (es
 * loopback). Guarda los últimos mensajes (acotados) por si un test o un
 * diagnóstico los necesita.
 */
export interface CapturedMail {
  from: string;
  to: string[];
  /** Mensaje crudo (encabezados + cuerpo), recortado a `MAX_MESSAGE_BYTES`. */
  raw: string;
}

export interface FakeSmtpServer {
  readonly host: string;
  readonly port: number;
  readonly messages: readonly CapturedMail[];
  close(): Promise<void>;
}

const MAX_MESSAGES = 50;
const MAX_MESSAGE_BYTES = 256 * 1024;

interface SmtpSession {
  from: string;
  to: string[];
  readingData: boolean;
  data: string[];
  dataBytes: number;
  buffer: string;
}

function addressOf(argument: string): string {
  const match = /<([^>]*)>/.exec(argument);
  return (match ? match[1] : argument).trim();
}

function handleConnection(socket: Socket, messages: CapturedMail[]): void {
  const session: SmtpSession = {
    from: '',
    to: [],
    readingData: false,
    data: [],
    dataBytes: 0,
    buffer: '',
  };
  const reply = (line: string): void => {
    if (!socket.destroyed) {
      socket.write(`${line}\r\n`);
    }
  };

  const onDataLine = (line: string): void => {
    if (line === '.') {
      messages.push({
        from: session.from,
        to: [...session.to],
        raw: session.data.join('\r\n'),
      });
      if (messages.length > MAX_MESSAGES) {
        messages.shift();
      }
      session.readingData = false;
      session.data = [];
      session.dataBytes = 0;
      reply('250 2.0.0 OK: queued');
      return;
    }
    // Dot-stuffing: una línea que empieza con "." llega con un "." extra.
    const content = line.startsWith('..') ? line.slice(1) : line;
    if (session.dataBytes < MAX_MESSAGE_BYTES) {
      session.data.push(content);
      session.dataBytes += content.length + 2;
    }
  };

  const onCommand = (line: string): void => {
    const [verb = '', ...rest] = line.split(' ');
    const argument = rest.join(' ');
    switch (verb.toUpperCase()) {
      case 'EHLO':
        reply('250-e2e.local');
        reply('250-8BITMIME');
        reply('250 SMTPUTF8');
        return;
      case 'HELO':
        reply('250 e2e.local');
        return;
      case 'MAIL':
        session.from = addressOf(argument.replace(/^FROM:/i, ''));
        session.to = [];
        reply('250 2.1.0 OK');
        return;
      case 'RCPT':
        session.to.push(addressOf(argument.replace(/^TO:/i, '')));
        reply('250 2.1.5 OK');
        return;
      case 'DATA':
        session.readingData = true;
        reply('354 End data with <CR><LF>.<CR><LF>');
        return;
      case 'RSET':
        session.from = '';
        session.to = [];
        reply('250 2.0.0 OK');
        return;
      case 'NOOP':
        reply('250 2.0.0 OK');
        return;
      case 'QUIT':
        reply('221 2.0.0 Bye');
        socket.end();
        return;
      default:
        reply('502 5.5.2 Command not implemented');
    }
  };

  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    session.buffer += chunk;
    let newline = session.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = session.buffer.slice(0, newline).replace(/\r$/, '');
      session.buffer = session.buffer.slice(newline + 1);
      if (session.readingData) {
        onDataLine(line);
      } else {
        onCommand(line);
      }
      newline = session.buffer.indexOf('\n');
    }
  });
  socket.on('error', () => socket.destroy());
  reply('220 e2e.local ESMTP sumidero de Vigilia (e2e)');
}

export function startFakeSmtpServer(
  host = '127.0.0.1',
): Promise<FakeSmtpServer> {
  const messages: CapturedMail[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    handleConnection(socket, messages);
  });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('El sumidero SMTP no obtuvo un puerto'));
        return;
      }
      resolve({ host, port: address.port, messages, close });
    });
  });
}
