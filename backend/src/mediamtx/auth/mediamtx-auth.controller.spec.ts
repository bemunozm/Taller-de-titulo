import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { FindOperator } from 'typeorm';
import { Camera } from '../../cameras/entities/camera.entity';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  RATE_LIMIT_POLICIES,
  THROTTLER_MODULE_OPTIONS,
} from '../../common/rate-limit/rate-limit.policies';
import { VigiliaThrottlerGuard } from '../../common/rate-limit/vigilia-throttler.guard';
import { handlerMetadata } from '../../test-utils/handler-metadata';
import { MEDIAMTX_AUTH_USER } from '../mediamtx-credentials';
import { MediamtxAuthController } from './mediamtx-auth.controller';
import { MediamtxAuthService } from './mediamtx-auth.service';
import {
  isAllowedMediamtxCaller,
  MediamtxCallerGuard,
} from './mediamtx-caller.guard';

const SECRET = 'Hq4Vt8Zm2Lc7Rx1Nw5Kp9Bd3Fs6Gy0JaTe';
const CAM_NO_MOUNT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

type Where = Record<string, unknown>;

/** Cámaras de la BD simulada: mount propio, inactiva y sin mount (usa el id). */
const CAMERAS: Array<Pick<Camera, 'id' | 'mountPath' | 'active'>> = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    mountPath: 'porton-a',
    active: true,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    mountPath: 'porton-b',
    active: false,
  },
  { id: CAM_NO_MOUNT, mountPath: null as unknown as string, active: true },
];

/** Réplica mínima del `findOne` de TypeORM (`where` objeto o lista; IsNull). */
function matches(camera: Where, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) =>
    expected instanceof FindOperator
      ? expected.type === 'isNull' && camera[key] == null
      : camera[key] === expected,
  );
}

function findOneCamera(options: {
  where: Where | Where[];
}): Promise<Pick<Camera, 'id'> | null> {
  const conditions = Array.isArray(options.where)
    ? options.where
    : [options.where];
  const found = CAMERAS.find((camera) =>
    conditions.some((where) => matches(camera, where)),
  );
  return Promise.resolve(found ? { id: found.id } : null);
}

/** Cuerpo tal como lo manda MediaMTX v1.15.2 (verificado contra el binario). */
function mediamtxBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ip: '127.0.0.1',
    user: MEDIAMTX_AUTH_USER,
    password: SECRET,
    token: '',
    action: 'read',
    path: 'porton-a',
    protocol: 'webrtc',
    id: '9c32a201-1338-42f1-bca7-89d3cbda3fbe',
    query: '',
    ...overrides,
  };
}

/**
 * Fase 4 · P6.M (D14): `POST /api/v1/internal/mediamtx/auth`. 200 solo para
 * una lectura WebRTC de una cámara activa con el secreto; todo lo demás 401
 * (fail-closed), con el mismo `ValidationPipe` global que main.ts.
 */
describe('POST /internal/mediamtx/auth (Fase 4 · P6.M)', () => {
  const previousSecret = process.env.MEDIAMTX_AUTH_SECRET;
  const previousAllowedIps = process.env.MEDIAMTX_AUTH_ALLOWED_IPS;
  let app: INestApplication<App>;
  let cameraRepository: { findOne: jest.Mock };

  async function createApp(
    secret: string | undefined,
    allowedIps?: string,
  ): Promise<void> {
    if (secret === undefined) {
      delete process.env.MEDIAMTX_AUTH_SECRET;
    } else {
      process.env.MEDIAMTX_AUTH_SECRET = secret;
    }
    if (allowedIps === undefined) {
      delete process.env.MEDIAMTX_AUTH_ALLOWED_IPS;
    } else {
      process.env.MEDIAMTX_AUTH_ALLOWED_IPS = allowedIps;
    }
    cameraRepository = { findOne: jest.fn(findOneCamera) };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLER_MODULE_OPTIONS)],
      controllers: [MediamtxAuthController],
      providers: [
        MediamtxAuthService,
        { provide: getRepositoryToken(Camera), useValue: cameraRepository },
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
    await app.init();
  }

  function authorize(body: unknown) {
    return request(app.getHttpServer())
      .post('/api/v1/internal/mediamtx/auth')
      .send(body as object);
  }

  afterEach(async () => {
    await app?.close();
    if (previousSecret === undefined) {
      delete process.env.MEDIAMTX_AUTH_SECRET;
    } else {
      process.env.MEDIAMTX_AUTH_SECRET = previousSecret;
    }
    if (previousAllowedIps === undefined) {
      delete process.env.MEDIAMTX_AUTH_ALLOWED_IPS;
    } else {
      process.env.MEDIAMTX_AUTH_ALLOWED_IPS = previousAllowedIps;
    }
  });

  describe('con MEDIAMTX_AUTH_SECRET configurado', () => {
    beforeEach(async () => {
      await createApp(SECRET);
    });

    it('lectura WebRTC de una cámara activa con el secreto -> 200 sin cuerpo', async () => {
      const response = await authorize(mediamtxBody()).expect(200);

      expect(response.text).toBe('');
    });

    it('cámara sin mountPath: su mount es el id -> 200', async () => {
      await authorize(mediamtxBody({ path: CAM_NO_MOUNT })).expect(200);
    });

    it('Control API (action api, path y protocol vacíos) con el secreto -> 200', async () => {
      // Corrección cyber P6: la API ya no está excluida del auth. Forma real
      // verificada en v1.15.2.
      await authorize(
        mediamtxBody({ action: 'api', path: '', protocol: '', id: null }),
      ).expect(200);
      expect(cameraRepository.findOne).not.toHaveBeenCalled();
    });

    it.each([
      [
        'anónima (CSRF / DNS rebinding desde un navegador)',
        { user: '', password: '' },
      ],
      ['secreto incorrecto', { password: 'otro-secreto-cualquiera' }],
      ['usuario distinto', { user: 'admin' }],
    ])('Control API %s -> 401', async (_case, overrides) => {
      await authorize(
        mediamtxBody({
          action: 'api',
          path: '',
          protocol: '',
          id: null,
          ...overrides,
        }),
      ).expect(401);
    });

    it('campos extra de una versión nueva de MediaMTX no rompen (se ignoran)', async () => {
      await authorize(mediamtxBody({ newField: 'x' })).expect(200);
    });

    it.each([
      ['secreto incorrecto', { password: `${SECRET.slice(0, -1)}X` }],
      ['secreto con un carácter de más', { password: `${SECRET}X` }],
      ['sin contraseña (lector anónimo)', { user: '', password: '' }],
      ['usuario distinto con el secreto correcto', { user: 'admin' }],
      ['action publish', { action: 'publish' }],
      ['action playback', { action: 'playback' }],
      ['action metrics', { action: 'metrics' }],
      ['action pprof', { action: 'pprof' }],
      ['protocolo rtsp', { protocol: 'rtsp' }],
      ['protocolo hls', { protocol: 'hls' }],
      ['path que no es una cámara', { path: 'no-existe' }],
      ['cámara inactiva', { path: 'porton-b' }],
      [
        'id de una cámara que tiene mountPath propio',
        { path: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      ],
      ['path vacío', { path: '' }],
    ])('%s -> 401', async (_case, overrides) => {
      const response = await authorize(mediamtxBody(overrides)).expect(401);

      expect(JSON.stringify(response.body)).not.toContain(SECRET);
    });

    it.each([
      ['cuerpo vacío', {}],
      ['sin action', mediamtxBody({ action: undefined })],
      ['action de otro tipo', mediamtxBody({ action: 42 })],
      ['password de otro tipo', mediamtxBody({ password: ['x'] })],
      ['path demasiado largo', mediamtxBody({ path: 'a'.repeat(300) })],
    ])('cuerpo inválido (%s) -> 401, no 400', async (_case, body) => {
      await authorize(body).expect(401);
    });

    it('el secreto se valida ANTES de consultar la BD', async () => {
      await authorize(mediamtxBody({ password: 'otro' })).expect(401);
      await authorize(mediamtxBody({ action: 'publish' })).expect(401);

      expect(cameraRepository.findOne).not.toHaveBeenCalled();
    });

    it('error de BD al verificar el path -> 401 (fail-closed)', async () => {
      cameraRepository.findOne.mockRejectedValueOnce(new Error('db caída'));

      await authorize(mediamtxBody()).expect(401);
    });
  });

  it('sin MEDIAMTX_AUTH_SECRET niega todo, también con cualquier contraseña', async () => {
    await createApp(undefined);

    await authorize(mediamtxBody()).expect(401);
    await authorize(mediamtxBody({ password: '' })).expect(401);
    expect(cameraRepository.findOne).not.toHaveBeenCalled();
  });

  /**
   * Corrección cyber P6: solo desde la IP del socket de MediaMTX
   * (`MEDIAMTX_AUTH_ALLOWED_IPS`, default loopback) y sin headers de proxy,
   * ANTES del rate limit.
   */
  describe('origen de la petición (MediamtxCallerGuard)', () => {
    it('el guard de origen corre antes del throttler', () => {
      expect(
        handlerMetadata(MediamtxAuthController, 'authorize', GUARDS_METADATA),
      ).toEqual([MediamtxCallerGuard, VigiliaThrottlerGuard]);
    });

    it.each([
      ['X-Forwarded-For', 'x-forwarded-for', '203.0.113.7'],
      ['Forwarded', 'forwarded', 'for=203.0.113.7'],
      ['X-Real-IP', 'x-real-ip', '203.0.113.7'],
    ])(
      'con %s (pasó por el reverse proxy) -> 401 aunque el cuerpo sea válido',
      async (_header, name, value) => {
        await createApp(SECRET);

        await authorize(mediamtxBody()).set(name, value).expect(401);
        expect(cameraRepository.findOne).not.toHaveBeenCalled();
      },
    );

    it('desde una IP que no está en MEDIAMTX_AUTH_ALLOWED_IPS -> 401', async () => {
      await createApp(SECRET, '10.0.0.5');

      await authorize(mediamtxBody()).expect(401);
      expect(cameraRepository.findOne).not.toHaveBeenCalled();
    });

    it('una IP de la lista -> pasa', async () => {
      await createApp(SECRET, '10.0.0.5, 127.0.0.1');

      await authorize(mediamtxBody()).expect(200);
    });

    it('las peticiones rechazadas por origen NO consumen el rate limit de MediaMTX', async () => {
      await createApp(SECRET);
      const limit = RATE_LIMIT_POLICIES['mediamtx-auth'].limit;

      for (let i = 0; i <= limit; i++) {
        await authorize(mediamtxBody())
          .set('x-forwarded-for', '203.0.113.7')
          .expect(401);
      }

      // Si se hubieran contado, esta sería la n.º limit + 2 -> 429.
      await authorize(mediamtxBody()).expect(200);
    }, 60_000);
  });
});

/** `isAllowedMediamtxCaller`: IP del socket normalizada y sin headers de proxy. */
describe('isAllowedMediamtxCaller', () => {
  const loopback = new Set(['127.0.0.1', '::1']);

  it.each([
    ['127.0.0.1', true],
    ['::ffff:127.0.0.1', true],
    ['::1', true],
    ['0:0:0:0:0:0:0:1', true],
    ['10.0.0.5', false],
    ['::ffff:10.0.0.5', false],
  ])('socket %s -> %s', (remoteAddress, expected) => {
    expect(
      isAllowedMediamtxCaller(
        { headers: {}, socket: { remoteAddress } },
        loopback,
      ),
    ).toBe(expected);
  });

  it('sin socket o con header de proxy -> false', () => {
    expect(isAllowedMediamtxCaller({ headers: {} }, loopback)).toBe(false);
    expect(
      isAllowedMediamtxCaller(
        {
          headers: { 'x-forwarded-for': '127.0.0.1' },
          socket: { remoteAddress: '127.0.0.1' },
        },
        loopback,
      ),
    ).toBe(false);
  });
});
