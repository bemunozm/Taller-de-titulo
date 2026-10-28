import {
  type CallHandler,
  type ExecutionContext,
  type INestApplication,
  type NestInterceptor,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hashPassword } from '../auth/utils/auth.util';
import { THROTTLER_MODULE_OPTIONS } from '../common/rate-limit/rate-limit.policies';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { Hub, HubType } from '../hub/entities/hub.entity';
import { HubAuthGuard } from '../hub/guards/hub-auth.guard';
import { HubAuthFailureLimiter } from '../hub/hub-auth-failure-limiter';
import { HubCredentialCache } from '../hub/hub-credential-cache';
import { KioskQrController } from './kiosk-qr.controller';
import { KioskQrService } from './services/kiosk-qr.service';

/**
 * Contrato HTTP de `POST /concierge/qr/redeem` con el `HubAuthGuard`, el
 * `ValidationPipe` global y el `VigiliaThrottlerGuard` REALES; el servicio
 * está mockeado (su lógica se prueba en `kiosk-qr.service.spec.ts`).
 */
describe('POST /concierge/qr/redeem', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const HUB_SECRET = 'secret-del-kiosko';
  const VALID_QR = 'AbC123xyz789';
  const URL = '/api/v1/concierge/qr/redeem';

  let app: INestApplication<App>;
  let hubs: Record<string, Hub>;
  let redeem: jest.Mock;
  let secretHash: string;

  /** Réplica de `TenantInterceptor`: solo puebla si el guard no lo hizo. */
  class FakeTenantInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler) {
      const req = context
        .switchToHttp()
        .getRequest<{ tenantContext?: TenantContext }>();
      req.tenantContext ??= { organizationId: null, isSuperAdmin: false };
      return next.handle();
    }
  }

  function asHub(hubId: string): Record<string, string> {
    return { 'X-Hub-Id': hubId, 'X-Hub-Secret': HUB_SECRET };
  }

  function post(headers: Record<string, string>, body: object) {
    return request(app.getHttpServer()).post(URL).set(headers).send(body);
  }

  beforeAll(async () => {
    secretHash = await hashPassword(HUB_SECRET);
  });

  beforeEach(async () => {
    const base = { secretHash, active: true };
    hubs = {
      'kiosk-1': {
        ...base,
        hubId: 'kiosk-1',
        type: HubType.WEB_KIOSK,
        organizationId: ORG,
      } as Hub,
      'kiosk-sin-org': {
        ...base,
        hubId: 'kiosk-sin-org',
        type: HubType.WEB_KIOSK,
        organizationId: null,
      } as Hub,
      'hub-fisico-1': {
        ...base,
        hubId: 'hub-fisico-1',
        type: HubType.PHYSICAL_HUB,
        organizationId: ORG,
      } as Hub,
    };
    redeem = jest.fn().mockResolvedValue({
      status: 'granted',
      access: 'pedestrian',
      doorOpened: true,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_MODULE_OPTIONS)],
      controllers: [KioskQrController],
      providers: [
        HubAuthGuard,
        HubAuthFailureLimiter,
        HubCredentialCache,
        { provide: KioskQrService, useValue: { redeem } },
        {
          provide: getRepositoryToken(Hub),
          useValue: {
            findOne: jest.fn(({ where }: { where: { hubId: string } }) => {
              const hub = hubs[where.hubId];
              return Promise.resolve(hub?.active ? hub : null);
            }),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(new FakeTenantInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('kiosko válido -> 200 con la respuesta del servicio y el hub/condominio autenticados', async () => {
    const response = await post(asHub('kiosk-1'), { qrCode: VALID_QR }).expect(
      200,
    );

    expect(response.body).toEqual({
      status: 'granted',
      access: 'pedestrian',
      doorOpened: true,
    });
    expect(redeem).toHaveBeenCalledWith(
      { hubId: 'kiosk-1', organizationId: ORG },
      VALID_QR,
    );
  });

  it('denegado -> 200 con { status: denied, reason } (no un 4xx)', async () => {
    redeem.mockResolvedValue({ status: 'denied', reason: 'already_inside' });

    const response = await post(asHub('kiosk-1'), { qrCode: VALID_QR }).expect(
      200,
    );

    expect(response.body).toEqual({
      status: 'denied',
      reason: 'already_inside',
    });
  });

  it('sin credencial de hub -> 401 sin llamar al servicio', async () => {
    await post({}, { qrCode: VALID_QR }).expect(401);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('secret inválido -> 401 sin llamar al servicio', async () => {
    await post(
      { 'X-Hub-Id': 'kiosk-1', 'X-Hub-Secret': 'otro' },
      { qrCode: VALID_QR },
    ).expect(401);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('sesión humana (cookie) sin credencial de hub -> 401', async () => {
    await request(app.getHttpServer())
      .post(URL)
      .set({ Cookie: 'session=conserje-1' })
      .send({ qrCode: VALID_QR })
      .expect(401);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('hub físico -> 403 sin llamar al servicio', async () => {
    await post(asHub('hub-fisico-1'), { qrCode: VALID_QR }).expect(403);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('kiosko sin condominio -> 403 sin llamar al servicio', async () => {
    await post(asHub('kiosk-sin-org'), { qrCode: VALID_QR }).expect(403);
    expect(redeem).not.toHaveBeenCalled();
  });

  describe('validación del DTO -> 400', () => {
    it.each([
      ['ausente', {}],
      ['vacío', { qrCode: '' }],
      ['corto (7)', { qrCode: 'abcdefg' }],
      ['largo (65)', { qrCode: 'a'.repeat(65) }],
      ['con espacios', { qrCode: 'abcd efgh1' }],
      ['con guion', { qrCode: 'abcd-efgh1' }],
      ['no alfanumérico', { qrCode: 'abcdefgh%1' }],
      ['número', { qrCode: 12345678 }],
      ['campo extra', { qrCode: VALID_QR, otro: 'x' }],
    ])('qrCode %s', async (_label, body) => {
      await post(asHub('kiosk-1'), body).expect(400);
      expect(redeem).not.toHaveBeenCalled();
    });

    it.each([8, 64])('longitud límite %i -> 200', async (length) => {
      await post(asHub('kiosk-1'), { qrCode: 'A'.repeat(length) }).expect(200);
    });
  });

  it('rate limit: el undécimo canje del mismo hub en un minuto -> 429', async () => {
    for (let i = 0; i < 10; i += 1) {
      await post(asHub('kiosk-1'), { qrCode: VALID_QR }).expect(200);
    }
    await post(asHub('kiosk-1'), { qrCode: VALID_QR }).expect(429);
  });
});
