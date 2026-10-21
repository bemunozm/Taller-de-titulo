import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MailerService } from '@nestjs-modules/mailer';
import {
  isSandboxSmsDomain,
  SMS_GATEWAY_DOMAIN,
  SmsService,
} from './sms.service';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): los logs del envío
 * del QR no llevan el nombre del visitante ni el teléfono completo.
 *
 * Corrección P7 (cyber B6, decisión de Nova): el "SMS" (un email al sandbox
 * de Mailtrap con el teléfono y el QR) está detrás de
 * `VISITOR_QR_SMS_ENABLED`, apagado por defecto.
 */
describe('SmsService (Fase 4 · P7)', () => {
  const PHONE = '+56 9 1234 5678';
  const VISITOR = 'Juan Pérez';
  const QR_PARAMS = {
    phone: PHONE,
    visitorName: VISITOR,
    qrDataUrl: 'data:image/png;base64,AAAA',
    visitId: 'visit-1',
  };
  let sendMail: jest.Mock;
  let lines: string[];
  let warnings: string[];

  function serviceWith(env: Record<string, string | undefined>): SmsService {
    const config = {
      get: (key: string): string | undefined => env[key],
    } as unknown as ConfigService;
    return new SmsService({ sendMail } as unknown as MailerService, config);
  }

  beforeEach(() => {
    lines = [];
    warnings = [];
    const capture = (message: unknown, ...rest: unknown[]): void => {
      lines.push([message, ...rest].map(String).join(' '));
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(capture);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(capture);
    jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((message: unknown): void => {
        warnings.push(String(message));
        capture(message);
      });
    sendMail = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectNoPii(): void {
    const all = lines.join('\n');
    expect(all).not.toContain('Juan');
    expect(all).not.toContain('Pérez');
    expect(all).not.toMatch(/1234\s?5678|12345678/);
  }

  describe('VISITOR_QR_SMS_ENABLED apagado (default)', () => {
    it.each([
      ['sin la variable', {}],
      ['false', { VISITOR_QR_SMS_ENABLED: 'false' }],
    ])('%s: no envía nada ni registra el teléfono', async (_case, env) => {
      const service = serviceWith(env);

      expect(service.isEnabled()).toBe(false);
      await expect(service.sendQRCodeSMS(QR_PARAMS)).resolves.toBe(false);
      await expect(service.sendSimpleSMS(PHONE, 'Hola')).resolves.toBe(false);

      expect(sendMail).not.toHaveBeenCalled();
      expect(lines.join('\n')).not.toMatch(/\*\*\*\d{4}|5678/);
      expectNoPii();
    });

    it('un valor inválido no se interpreta como encendido: lanza (fail-closed)', () => {
      expect(() => serviceWith({ VISITOR_QR_SMS_ENABLED: 'si' })).toThrow(
        /VISITOR_QR_SMS_ENABLED/,
      );
    });
  });

  describe('VISITOR_QR_SMS_ENABLED=true', () => {
    const ENABLED = {
      VISITOR_QR_SMS_ENABLED: 'true',
      FRONTEND_URL: 'https://vigilia.example',
    };

    it('envía con el teléfono enmascarado en los logs, sin nombre, y avisa que es un sandbox', async () => {
      const service = serviceWith(ENABLED);

      await expect(service.sendQRCodeSMS(QR_PARAMS)).resolves.toBe(true);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(lines.join('\n')).toContain('***5678');
      expect(lines.join('\n')).toContain('visit-1');
      expect(warnings.join('\n')).toContain(SMS_GATEWAY_DOMAIN);
      expect(warnings.join('\n')).toContain('sandbox');
      expectNoPii();
    });

    it('escapa el nombre del visitante en el HTML del mensaje', async () => {
      const service = serviceWith(ENABLED);

      await service.sendQRCodeSMS({
        ...QR_PARAMS,
        visitorName: '<img src=x onerror=alert(1)>',
      });

      const [[mail]] = sendMail.mock.calls as Array<[{ html: string }]>;
      expect(mail.html).not.toContain('<img src=x');
      expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('error del transporte: tampoco repite el destinatario', async () => {
      const service = serviceWith(ENABLED);
      sendMail.mockRejectedValue(
        new Error('Destinatario inválido: sms+56912345678@sandbox.mailtrap.io'),
      );

      await expect(service.sendQRCodeSMS(QR_PARAMS)).rejects.toThrow(
        'Destinatario inválido',
      );

      expect(lines.join('\n')).toContain('s***@sandbox.mailtrap.io');
      expectNoPii();
    });

    it('SMS simple: teléfono enmascarado, también en el error', async () => {
      const service = serviceWith(ENABLED);

      await expect(service.sendSimpleSMS(PHONE, 'Hola')).resolves.toBe(true);
      sendMail.mockRejectedValue(new Error('fallo sms+56912345678@x.io'));
      await expect(service.sendSimpleSMS(PHONE, 'Hola')).rejects.toThrow();

      expect(lines.join('\n')).toContain('***5678');
      expectNoPii();
    });
  });

  it('isSandboxSmsDomain', () => {
    expect(isSandboxSmsDomain('sandbox.mailtrap.io')).toBe(true);
    expect(isSandboxSmsDomain('SANDBOX.MAILTRAP.IO')).toBe(true);
    expect(isSandboxSmsDomain('sms.proveedor-real.cl')).toBe(false);
  });
});
