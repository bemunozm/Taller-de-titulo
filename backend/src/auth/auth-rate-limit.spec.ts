import {
  type ExecutionContext,
  type INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { THROTTLER_MODULE_OPTIONS } from '../common/rate-limit/rate-limit.policies';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthorizationGuard } from './guards/authorization.guard';
import { DataExportService } from '../privacy/data-export.service';

/**
 * Fase 4 · P4.B (D9): rate limit de las rutas de cuenta con el
 * `VigiliaThrottlerGuard` y el `ThrottlerModule` REALES.
 *  - `auth-password` (`check-password`, `update-password`): 5 por 15 min por
 *    USUARIO; el throttler corre después de `AuthGuard`.
 *  - `auth-public` (`forgot-password`, `reset-password`, `request-code`,
 *    `confirm-account`): 5 por 15 min por IP.
 *  - `auth-token-validate` (`validate-token`): 20 por 15 min por IP.
 *
 * `AuthGuard` se reemplaza por un doble que lee `x-test-user` (la sesión de
 * better-auth se prueba en auth.guard.spec.ts). `trust proxy = 1`, como con
 * `TRUST_PROXY=1`: `X-Forwarded-For` simula IPs distintas.
 */
describe('AuthController — rate limit (Fase 4 · P4.B)', () => {
  const LIMIT = 5;
  let app: INestApplication<App>;

  const fakeAuthGuard = {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<{
        headers: Record<string, string | undefined>;
        user?: { id: string };
      }>();
      const userId = req.headers['x-test-user'];
      if (!userId) {
        throw new UnauthorizedException();
      }
      req.user = { id: userId };
      return true;
    },
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_MODULE_OPTIONS)],
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            confirmAccount: jest.fn().mockResolvedValue('ok'),
            requestConfirmationCode: jest.fn().mockResolvedValue('ok'),
            forgotPassword: jest.fn().mockResolvedValue('ok'),
            validateToken: jest.fn().mockResolvedValue('ok'),
            updatePasswordWithToken: jest.fn().mockResolvedValue('ok'),
            checkPassword: jest.fn().mockResolvedValue('ok'),
            updateCurrentUserPassword: jest
              .fn()
              .mockResolvedValue({ message: 'ok', setCookieHeaders: [] }),
          },
        },
        // Fase 4 · P7.R: `GET /auth/me/data-export` (privacy/data-export.http.spec.ts).
        { provide: DataExportService, useValue: { exportForUser: jest.fn() } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue(fakeAuthGuard)
      .overrideGuard(AuthorizationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const expressApp =
      moduleRef.createNestApplication<NestExpressApplication>();
    expressApp.set('trust proxy', 1);
    expressApp.setGlobalPrefix('api/v1');
    await expressApp.init();
    app = expressApp;
  });

  afterEach(async () => {
    await app?.close();
  });

  function post(path: string) {
    return request(app.getHttpServer()).post(`/api/v1/auth/${path}`);
  }

  async function statuses(
    count: number,
    send: () => request.Test,
  ): Promise<number[]> {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push((await send()).status);
    }
    return result;
  }

  describe('auth-password (por usuario)', () => {
    it.each(['check-password', 'update-password'])(
      '%s: 5 por usuario; el 6 responde 429 y otro usuario sigue pudiendo',
      async (path) => {
        const results = await statuses(LIMIT + 1, () =>
          post(path).set('x-test-user', 'user-1').send({}),
        );

        expect(results.slice(0, LIMIT).every((code) => code < 300)).toBe(true);
        expect(results[LIMIT]).toBe(429);

        const other = await post(path).set('x-test-user', 'user-2').send({});
        expect(other.status).toBeLessThan(300);
      },
    );

    it('el contador es por usuario, no por IP: misma IP, distinto usuario', async () => {
      await statuses(LIMIT + 1, () =>
        post('check-password')
          .set('x-test-user', 'user-1')
          .set('X-Forwarded-For', '203.0.113.1')
          .send({}),
      );

      const sameIpOtherUser = await post('check-password')
        .set('x-test-user', 'user-2')
        .set('X-Forwarded-For', '203.0.113.1')
        .send({});
      expect(sameIpOtherUser.status).toBeLessThan(300);
    });

    it('sin sesión: 401 de AuthGuard y no cuenta para el límite', async () => {
      const unauthenticated = await statuses(LIMIT + 2, () =>
        post('check-password').send({}),
      );
      expect(unauthenticated.every((code) => code === 401)).toBe(true);

      await post('check-password')
        .set('x-test-user', 'user-1')
        .send({})
        .expect((res) => expect(res.status).toBeLessThan(300));
    });

    it('check-password y update-password tienen contadores separados', async () => {
      await statuses(LIMIT + 1, () =>
        post('check-password').set('x-test-user', 'user-1').send({}),
      );

      const update = await post('update-password')
        .set('x-test-user', 'user-1')
        .send({});
      expect(update.status).toBeLessThan(300);
    });
  });

  describe('auth-public (por IP)', () => {
    it.each([
      'forgot-password',
      'reset-password',
      'request-code',
      'confirm-account',
    ])(
      '%s: 5 por IP; el 6 responde 429 y otra IP sigue pudiendo',
      async (path) => {
        const results = await statuses(LIMIT + 1, () =>
          post(path).set('X-Forwarded-For', '203.0.113.7').send({}),
        );

        expect(results.slice(0, LIMIT).every((code) => code < 300)).toBe(true);
        expect(results[LIMIT]).toBe(429);

        const otherIp = await post(path)
          .set('X-Forwarded-For', '198.51.100.7')
          .send({});
        expect(otherIp.status).toBeLessThan(300);
      },
    );
  });

  describe('auth-token-validate (por IP, QA B5)', () => {
    it('validate-token: 20 por IP (recargar la página no bloquea); el 21 responde 429', async () => {
      const results = await statuses(21, () =>
        post('validate-token').set('X-Forwarded-For', '203.0.113.8').send({}),
      );

      expect(results.slice(0, 20).every((code) => code < 300)).toBe(true);
      expect(results[20]).toBe(429);
    });

    it('validate-token tiene su contador propio: no consume el de reset-password', async () => {
      await statuses(LIMIT + 1, () =>
        post('validate-token').set('X-Forwarded-For', '203.0.113.9').send({}),
      );

      const reset = await post('reset-password')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({});
      expect(reset.status).toBeLessThan(300);
    });
  });
});
