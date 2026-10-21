import * as nodemailer from 'nodemailer';
import { startFakeSmtpServer, type FakeSmtpServer } from './fake-smtp-server';

/**
 * Pieza unitaria del harness e2e (Fase 4 · P8): el sumidero SMTP acepta lo
 * que envía nodemailer con la MISMA configuración que la app
 * (`better-auth.ts`: `secure: false`, `auth` con usuario/clave sin definir).
 */
describe('startFakeSmtpServer (harness e2e)', () => {
  let server: FakeSmtpServer;

  beforeEach(async () => {
    server = await startFakeSmtpServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function appLikeTransport(): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: server.host,
      port: server.port,
      secure: false,
      auth: { user: undefined, pass: undefined },
    });
  }

  it('acepta un email como los de activación y lo guarda', async () => {
    const transport = appLikeTransport();
    try {
      const info = await transport.sendMail({
        from: 'UpTask <admin@uptask.com>',
        to: 'residente.e2e@vigilia.test',
        subject: 'Establece tu contraseña',
        html: '<p>Hola</p>\n<p>.línea con punto inicial</p>\n.\n<a href="http://x/reset-password/abc">link</a>',
      });

      expect(info.accepted).toEqual(['residente.e2e@vigilia.test']);
    } finally {
      transport.close();
    }
    expect(server.messages).toHaveLength(1);
    const [message] = server.messages;
    expect(message.from).toBe('admin@uptask.com');
    expect(message.to).toEqual(['residente.e2e@vigilia.test']);
    expect(message.raw).toContain('Subject:');
  });

  it('acepta varios envíos seguidos en conexiones distintas', async () => {
    for (const to of ['a@vigilia.test', 'b@vigilia.test']) {
      const transport = appLikeTransport();
      try {
        await transport.sendMail({ from: 'x@vigilia.test', to, text: 'hola' });
      } finally {
        transport.close();
      }
    }

    expect(server.messages.map((message) => message.to)).toEqual([
      ['a@vigilia.test'],
      ['b@vigilia.test'],
    ]);
  });

  it('close() corta las conexiones abiertas y es idempotente', async () => {
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });
});
