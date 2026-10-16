import type { IncomingHttpHeaders } from 'http';
import express, { type Request, type Response } from 'express';
import type { AddressInfo } from 'net';
import {
  CLIENT_IP_HEADER,
  applyClientIpHeader,
  buildBetterAuthHeaders,
  clientIpHeaderMiddleware,
} from './client-ip.middleware';

describe('client-ip.middleware (M1: IP real para better-auth)', () => {
  describe('applyClientIpHeader', () => {
    it('borra los headers de IP del cliente y escribe x-client-ip con la IP de Express', () => {
      const headers: IncomingHttpHeaders = {
        'x-forwarded-for': '6.6.6.6, 10.0.0.1',
        'x-real-ip': '6.6.6.6',
        'x-client-ip': '6.6.6.6',
        forwarded: 'for=6.6.6.6',
        'cf-connecting-ip': '6.6.6.6',
        'true-client-ip': '6.6.6.6',
        cookie: 'better-auth.session_token=abc',
        'x-forwarded-proto': 'https',
      };

      applyClientIpHeader(headers, '203.0.113.9');

      expect(headers).toEqual({
        cookie: 'better-auth.session_token=abc',
        'x-forwarded-proto': 'https',
        [CLIENT_IP_HEADER]: '203.0.113.9',
      });
    });

    it('sin IP conocida no inventa una (better-auth decide su fallback)', () => {
      const headers: IncomingHttpHeaders = { 'x-client-ip': '6.6.6.6' };

      applyClientIpHeader(headers, undefined);

      expect(headers).toEqual({});
    });
  });

  describe('clientIpHeaderMiddleware', () => {
    it('lee req.ip ANTES de borrar x-forwarded-for y llama a next()', () => {
      const headers: IncomingHttpHeaders = {
        'x-forwarded-for': '198.51.100.4',
      };
      // Simula el getter de Express: con trust proxy, req.ip sale de XFF.
      const req = {
        headers,
        get ip(): string | undefined {
          const xff = headers['x-forwarded-for'];
          return typeof xff === 'string' ? xff : '10.0.0.2';
        },
      } as unknown as Request;
      const next = jest.fn();

      clientIpHeaderMiddleware(req, {} as Response, next);

      expect(headers[CLIENT_IP_HEADER]).toBe('198.51.100.4');
      expect(headers['x-forwarded-for']).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    });

    /** Levanta Express real con `trust proxy` y devuelve los headers que ve el handler. */
    async function headersSeenByHandler(
      trustProxy: boolean | number,
      requestHeaders: Record<string, string>,
    ): Promise<IncomingHttpHeaders> {
      const app = express();
      app.set('trust proxy', trustProxy);
      app.use('/api/auth', clientIpHeaderMiddleware, (req, res) => {
        res.json(req.headers);
      });
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server.once('listening', resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const response = await fetch(
          `http://127.0.0.1:${port}/api/auth/sign-in/email`,
          { headers: requestHeaders },
        );
        return (await response.json()) as IncomingHttpHeaders;
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    it('sin TRUST_PROXY: ignora x-forwarded-for del cliente (no se puede falsificar la IP)', async () => {
      const seen = await headersSeenByHandler(false, {
        'x-forwarded-for': '6.6.6.6',
        'x-client-ip': '7.7.7.7',
      });

      expect(seen['x-forwarded-for']).toBeUndefined();
      expect(seen[CLIENT_IP_HEADER]).toMatch(/127\.0\.0\.1$/);
    });

    it('con TRUST_PROXY=1: toma la IP del cliente que agregó el proxy (último salto)', async () => {
      const seen = await headersSeenByHandler(1, {
        // El cliente intenta inyectar 6.6.6.6; el proxy agrega la IP real.
        'x-forwarded-for': '6.6.6.6, 198.51.100.7',
      });

      expect(seen[CLIENT_IP_HEADER]).toBe('198.51.100.7');
      expect(seen['x-forwarded-for']).toBeUndefined();
    });
  });

  describe('buildBetterAuthHeaders', () => {
    it('conserva la cookie de sesión, aplica la misma higiene de IP y no muta la request', () => {
      const original: IncomingHttpHeaders = {
        cookie: 'better-auth.session_token=abc',
        'x-forwarded-for': '6.6.6.6',
      };

      const headers = buildBetterAuthHeaders({
        headers: original,
        ip: '10.0.0.7',
      });

      expect(headers.get('cookie')).toBe('better-auth.session_token=abc');
      expect(headers.get('x-forwarded-for')).toBeNull();
      expect(headers.get(CLIENT_IP_HEADER)).toBe('10.0.0.7');
      expect(original['x-forwarded-for']).toBe('6.6.6.6');
    });
  });
});
