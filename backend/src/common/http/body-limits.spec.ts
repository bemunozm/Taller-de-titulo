import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  type INestApplication,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { IsEmail } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import { Readable } from 'node:stream';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AnomaliesController } from '../../anomalies/anomalies.controller';
import {
  ServiceApiKeyGuard,
  type ServiceKeyRequest,
} from '../../auth/guards/service-api-key.guard';
import {
  SERVICE_API_KEY_VERIFICATION,
  type ServiceApiKeyVerification,
  type ServiceApiKeyVerificationCarrier,
  verifyServiceApiKey,
} from '../../auth/service-api-key.verification';
import { DetectionsController } from '../../detections/detections.controller';
import {
  bodyErrorResponse,
  createBodyParserMiddleware,
  isLargeBodyRoute,
  LARGE_BODY_ROUTES,
  largeBodyApiKey,
} from './body-limits';

// `DetectionsController` arrastra el AI SDK (ESM-only) por sus imports: no
// se usa acá, solo se leen los metadatos de sus rutas.
jest.mock('ai', () => ({ tool: jest.fn(), ToolLoopAgent: jest.fn() }));
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn() }));

const KB = 1024;
const MB = KB * KB;
const ORG_A = '11111111-1111-4111-8111-111111111111';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Keys del doble de better-auth. */
const VALID_KEY = 'vk_valida';
const FAILING_KEY = 'vk_bd_caida';

/** JSON de ~`bytes` bytes con muchas claves (la forma del ataque). */
function bodyOf(bytes: number): Record<string, string> {
  const body: Record<string, string> = {};
  let size = 2;
  for (let i = 0; size < bytes; i++) {
    const key = `k${i}`;
    body[key] = 'x'.repeat(32);
    size += key.length + 32 + 6;
  }
  return body;
}

class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

@Injectable()
class FakeSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.headers['x-test-user'] !== 'ana') {
      throw new UnauthorizedException();
    }
    return true;
  }
}

/** Respuesta de una ruta de ingesta: claves del body y condominio de la key. */
function ingestionResponse(
  body: Record<string, unknown>,
  req: ServiceKeyRequest,
): { keys: number; organizationId: string | undefined } {
  return {
    keys: Object.keys(body).length,
    organizationId: req.serviceKey?.organizationId,
  };
}

@Controller()
class FakeRoutesController {
  @Post('auth/forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return { ok: dto.email };
  }

  @Post('visits')
  @UseGuards(FakeSessionGuard)
  createVisit(@Body() body: Record<string, unknown>) {
    return { keys: Object.keys(body).length };
  }

  // Las rutas de ingesta con el guard REAL, como en los controllers.
  @Post('detections/plates')
  @UseGuards(ServiceApiKeyGuard)
  ingestPlate(
    @Body() body: Record<string, unknown>,
    @Req() req: ServiceKeyRequest,
  ) {
    return ingestionResponse(body, req);
  }

  @Post('detections/plates/attempts')
  @UseGuards(ServiceApiKeyGuard)
  ingestAttempt(
    @Body() body: Record<string, unknown>,
    @Req() req: ServiceKeyRequest,
  ) {
    return ingestionResponse(body, req);
  }

  @Post('anomalies')
  @UseGuards(ServiceApiKeyGuard)
  ingestAnomaly(
    @Body() body: Record<string, unknown>,
    @Req() req: ServiceKeyRequest,
  ) {
    return ingestionResponse(body, req);
  }
}

/**
 * Fase 4 · P7 (corrección cyber ALTO): 100 kb en general y 10 MB solo en la
 * ingesta del LPR. Fase 4 · P9 (corrección cyber BAJO): los 10 MB exigen una
 * API key VERIFICADA (antes bastaba cualquier `x-api-key`), y el guard real
 * reutiliza esa verificación (una sola por request). Con la app de Nest real
 * (`bodyParser: false` como en main.ts), `ValidationPipe` global y una ruta
 * cruda bajo `/api/auth` que lee su propio stream (como better-auth).
 */
describe('Límites del body (Fase 4 · P7 / P9)', () => {
  let app: INestApplication<App>;
  const verifyApiKey = jest.fn();
  const query = jest.fn();
  const betterAuth = { api: { verifyApiKey } };
  /** ¿El parser llenó `req.body` en la última request? */
  let lastBodyParsed: boolean | null = null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FakeRoutesController],
      providers: [
        FakeSessionGuard,
        ServiceApiKeyGuard,
        { provide: BetterAuthService, useValue: betterAuth },
        { provide: getDataSourceToken(), useValue: { query } },
      ],
    }).compile();
    const expressApp = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    expressApp.use(
      createBodyParserMiddleware({
        skipPathPrefix: '/api/auth',
        verifyServiceApiKey: (apiKey) =>
          verifyServiceApiKey(betterAuth as never, apiKey),
      }),
    );
    expressApp.use((req: Request, _res: Response, next: NextFunction) => {
      lastBodyParsed = req.body !== undefined;
      next();
    });
    // Como better-auth: lee el stream crudo (si alguien lo hubiera consumido,
    // no llegaría nada).
    expressApp.use('/api/auth', (req: Request, res: Response) => {
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
      });
      req.on('end', () => {
        res.json({ received, parsed: req.body !== undefined });
      });
    });
    expressApp.setGlobalPrefix('api/v1');
    expressApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await expressApp.init();
    app = expressApp;
  });

  beforeEach(() => {
    lastBodyParsed = null;
    verifyApiKey.mockReset();
    verifyApiKey.mockImplementation(({ body }: { body: { key: string } }) => {
      if (body.key === FAILING_KEY) {
        return Promise.reject(new Error('db down'));
      }
      if (body.key === VALID_KEY) {
        return Promise.resolve({
          valid: true,
          error: null,
          key: {
            id: 'key-1',
            referenceId: OWNER,
            permissions: { service: ['lpr'], org: [ORG_A] },
          },
        });
      }
      return Promise.resolve({
        valid: false,
        error: { code: 'INVALID_API_KEY' },
        key: null,
      });
    });
    query.mockReset();
    // El dueño de la key es miembro activo del condominio.
    query.mockResolvedValue([{ ok: 1 }]);
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string) {
    return request(app.getHttpServer()).post(path);
  }

  describe('413 con más de 100 kb fuera de la ingesta', () => {
    it('ruta pública (forgot-password): 413 JSON, sin llegar a class-transformer', async () => {
      const response = await post('/api/v1/auth/forgot-password').send(
        bodyOf(150 * KB),
      );

      expect(response.status).toBe(413);
      expect(response.body).toEqual({
        statusCode: 413,
        message: 'El cuerpo de la solicitud supera el tamaño permitido',
        error: 'Payload Too Large',
      });
    });

    it('ruta con sesión: 413 (el parser corre antes que la autenticación)', async () => {
      const response = await post('/api/v1/visits')
        .set('x-test-user', 'ana')
        .send(bodyOf(150 * KB));

      expect(response.status).toBe(413);
    });

    it('una ruta de ingesta sin x-api-key usa los 100 kb (sin verificar nada)', async () => {
      const response = await post('/api/v1/detections/plates').send(
        bodyOf(150 * KB),
      );

      expect(response.status).toBe(413);
      expect(verifyApiKey).not.toHaveBeenCalled();
    });

    it('plates/attempts (sin imágenes) mantiene los 100 kb aunque traiga una key válida', async () => {
      const response = await post('/api/v1/detections/plates/attempts')
        .set('x-api-key', VALID_KEY)
        .send(bodyOf(150 * KB));

      expect(response.status).toBe(413);
      expect(verifyApiKey).not.toHaveBeenCalled();
    });

    it('urlencoded también tiene 100 kb', async () => {
      const response = await post('/api/v1/visits')
        .set('x-test-user', 'ana')
        .type('form')
        .send(`a=${'x'.repeat(150 * KB)}`);

      expect(response.status).toBe(413);
    });
  });

  describe('por debajo del límite todo sigue igual', () => {
    it('ruta pública con un body chico: 201', async () => {
      const response = await post('/api/v1/auth/forgot-password').send({
        email: 'ana@example.com',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ ok: 'ana@example.com' });
    });

    it('ruta con sesión con ~90 kb: aceptada', async () => {
      const response = await post('/api/v1/visits')
        .set('x-test-user', 'ana')
        .send(bodyOf(90 * KB));

      expect(response.status).toBe(201);
    });

    it('plates/attempts con key válida: el guard verifica una vez por su cuenta', async () => {
      const response = await post('/api/v1/detections/plates/attempts')
        .set('x-api-key', VALID_KEY)
        .send({ plate: 'ABCD12' });

      expect(response.status).toBe(201);
      expect(verifyApiKey).toHaveBeenCalledTimes(1);
    });
  });

  describe('ingesta del LPR con API key VERIFICADA: hasta 10 MB', () => {
    it.each(['/api/v1/detections/plates', '/api/v1/anomalies'])(
      '%s acepta ~2 MB (foto en base64) y verifica la key UNA vez',
      async (path) => {
        const snapshot = 'A'.repeat(2 * MB);
        const response = await post(path)
          .set('x-api-key', VALID_KEY)
          .send({ cameraId: 'cam-1', snapshot_jpeg_b64: snapshot });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ keys: 2, organizationId: ORG_A });
        // El middleware verificó y el guard reutilizó el resultado.
        expect(verifyApiKey).toHaveBeenCalledTimes(1);
        expect(verifyApiKey).toHaveBeenCalledWith({
          body: { key: VALID_KEY, permissions: { service: ['lpr'] } },
        });
      },
    );

    it('acepta ~9 MB (cerca del tope de 10 MB)', async () => {
      const response = await post('/api/v1/detections/plates')
        .set('x-api-key', VALID_KEY)
        .send({ snapshot: 'A'.repeat(9 * MB) });

      expect(response.status).toBe(201);
      expect(verifyApiKey).toHaveBeenCalledTimes(1);
    });

    it('más de 10 MB: 413 también en la ingesta', async () => {
      const response = await post('/api/v1/anomalies')
        .set('x-api-key', VALID_KEY)
        .send({ snapshot: 'A'.repeat(11 * MB) });

      expect(response.status).toBe(413);
      expect(verifyApiKey).toHaveBeenCalledTimes(1);
    });

    it('la key válida sigue pasando por el guard: dueño sin membresía -> 403', async () => {
      query.mockResolvedValue([]);

      const response = await post('/api/v1/anomalies')
        .set('x-api-key', VALID_KEY)
        .send({ snapshot: 'A'.repeat(2 * MB) });

      expect(response.status).toBe(403);
      expect(verifyApiKey).toHaveBeenCalledTimes(1);
    });

    it('JSON mal formado con key válida: 400 genérico', async () => {
      const response = await post('/api/v1/detections/plates')
        .set('x-api-key', VALID_KEY)
        .set('Content-Type', 'application/json')
        .send('{"snapshot": "AAAA",');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        message: 'El cuerpo de la solicitud no es válido',
      });
    });
  });

  describe('key inválida o error al verificar: 401 SIN parsear el body', () => {
    it.each(['/api/v1/detections/plates', '/api/v1/anomalies'])(
      '%s con x-api-key inválida y 2 MB: 401, body sin leer, una verificación',
      async (path) => {
        const response = await post(path)
          .set('x-api-key', 'a')
          .send({ snapshot: 'A'.repeat(2 * MB) });

        expect(response.status).toBe(401);
        expect(response.body).toMatchObject({
          message: 'API key de servicio inválida o expirada',
        });
        expect(lastBodyParsed).toBe(false);
        expect(verifyApiKey).toHaveBeenCalledTimes(1);
      },
    );

    it('urlencoded extendido con key inválida: 401 sin parsear', async () => {
      const response = await post('/api/v1/anomalies')
        .set('x-api-key', 'a')
        .type('form')
        .send(`a[b][c]=${'x'.repeat(2 * MB)}`);

      expect(response.status).toBe(401);
      expect(lastBodyParsed).toBe(false);
    });

    it('key inválida con un body chico: también 401 sin parsear', async () => {
      const response = await post('/api/v1/detections/plates')
        .set('x-api-key', 'a')
        .send({ plate: 'ABCD12' });

      expect(response.status).toBe(401);
      expect(lastBodyParsed).toBe(false);
    });

    it('el verificador falla (BD caída): fail-closed, 401 sin parsear y sin reintentar', async () => {
      const response = await post('/api/v1/detections/plates')
        .set('x-api-key', FAILING_KEY)
        .send({ snapshot: 'A'.repeat(2 * MB) });

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        message: 'API key de servicio inválida',
      });
      expect(lastBodyParsed).toBe(false);
      expect(verifyApiKey).toHaveBeenCalledTimes(1);
    });
  });

  it('JSON mal formado: 400 JSON genérico, sin repetir el contenido', async () => {
    const response = await post('/api/v1/visits')
      .set('x-test-user', 'ana')
      .set('Content-Type', 'application/json')
      .send('{"secreto": "12.345.678-5",');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      statusCode: 400,
      message: 'El cuerpo de la solicitud no es válido',
      error: 'Bad Request',
    });
    expect(JSON.stringify(response.body)).not.toContain('12.345.678-5');
  });

  it('better-auth (/api/auth) recibe el stream intacto, sin límite propio de este parser', async () => {
    const payload = JSON.stringify(bodyOf(150 * KB));
    const response = await post('/api/auth/sign-in/email')
      .set('Content-Type', 'application/json')
      .set('x-api-key', VALID_KEY)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: Buffer.byteLength(payload),
      parsed: false,
    });
    expect(verifyApiKey).not.toHaveBeenCalled();
  });
});

describe('createBodyParserMiddleware (sin HTTP)', () => {
  /** Request de ingesta con un body de `chunks` (un stream real). */
  function ingestionRequest(apiKey: string, chunks: string[] = []): Request {
    return Object.assign(Readable.from(chunks), {
      method: 'POST',
      originalUrl: '/api/v1/anomalies',
      headers: { 'x-api-key': apiKey },
    }) as unknown as Request;
  }

  async function run(
    verify: (apiKey: string) => Promise<ServiceApiKeyVerification>,
    req: Request,
  ): Promise<unknown[]> {
    const middleware = createBodyParserMiddleware({
      skipPathPrefix: '/api/auth',
      verifyServiceApiKey: verify,
    });
    return new Promise((resolve) => {
      void middleware(req, {} as Response, (...args: unknown[]) =>
        resolve(args),
      );
    });
  }

  it('un verificador que rechaza la promesa cuenta como fallo: next() sin parsear y resultado guardado', async () => {
    const req = ingestionRequest('k');

    const nextArgs = await run(() => Promise.reject(new Error('boom')), req);

    expect(nextArgs).toEqual([]);
    expect(req.body).toBeUndefined();
    expect(
      (req as unknown as ServiceApiKeyVerificationCarrier)[
        SERVICE_API_KEY_VERIFICATION
      ],
    ).toEqual({ apiKey: 'k', result: { status: 'failed', reason: 'boom' } });
  });

  it('un verificador que lanza sincrónicamente también es fail-closed', async () => {
    const req = ingestionRequest('k');

    const nextArgs = await run(() => {
      throw new Error('sync');
    }, req);

    expect(nextArgs).toEqual([]);
    expect(req.body).toBeUndefined();
  });

  it('key rechazada: lee el body hasta el final sin guardarlo y recién ahí sigue', async () => {
    const req = ingestionRequest('k', ['{"a":', '"b"}']);

    const nextArgs = await run(
      () => Promise.resolve({ status: 'rejected', code: 'INVALID_API_KEY' }),
      req,
    );

    expect(nextArgs).toEqual([]);
    expect(req.readableEnded).toBe(true);
    expect(req.body).toBeUndefined();
  });
});

describe('isLargeBodyRoute / largeBodyApiKey', () => {
  it.each([
    ['POST', '/api/v1/detections/plates', true],
    ['POST', '/api/v1/anomalies', true],
    ['POST', '/api/v1/anomalies/', true],
    ['POST', '/api/v1/Anomalies?x=1', true],
    ['post', '/api/v1/detections/plates', true],
    ['PUT', '/api/v1/detections/plates', false],
    ['POST', '/api/v1/detections/plates/attempts', false],
    ['POST', '/api/v1/auth/forgot-password', false],
    ['POST', '/api/v1/anomalies/cameras/x/zones', false],
  ] as const)('%s %s -> %p', (method, originalUrl, expected) => {
    expect(isLargeBodyRoute({ method, originalUrl })).toBe(expected);
  });

  it.each([
    [{ 'x-api-key': 'k' }, 'k'],
    [{}, undefined],
    [{ 'x-api-key': '' }, undefined],
    [{ 'x-api-key': ['k1', 'k2'] }, undefined],
  ] as const)(
    'en una ruta de ingesta, headers %p -> key %p',
    (headers, expected) => {
      expect(
        largeBodyApiKey({
          method: 'POST',
          originalUrl: '/api/v1/anomalies',
          headers: headers as Request['headers'],
        }),
      ).toBe(expected);
    },
  );

  it('fuera de la ingesta no hay key que verificar aunque venga el header', () => {
    expect(
      largeBodyApiKey({
        method: 'POST',
        originalUrl: '/api/v1/detections/plates/attempts',
        headers: { 'x-api-key': 'k' },
      }),
    ).toBeUndefined();
  });

  it('las rutas grandes existen en los controllers reales y exigen ServiceApiKeyGuard', () => {
    const handlers: Array<[object, string, string]> = [
      [DetectionsController, 'detections', 'createDetection'],
      [AnomaliesController, 'anomalies', 'handleAnomaly'],
    ];
    const found = handlers.map(([controller, prefix, method]) => {
      const handler = Object.getOwnPropertyDescriptor(
        (controller as { prototype: object }).prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(PATH_METADATA, controller)).toBe(prefix);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        RequestMethod.POST,
      );
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        ServiceApiKeyGuard,
      );
      const path = String(Reflect.getMetadata(PATH_METADATA, handler));
      return `/api/v1/${prefix}${path === '/' ? '' : `/${path}`}`;
    });
    expect(found.sort()).toEqual(
      LARGE_BODY_ROUTES.map((route) => route.path).sort(),
    );
  });

  it('bodyErrorResponse: solo errores 4xx de body-parser; el resto sigue su curso', () => {
    expect(
      bodyErrorResponse({ status: 413, type: 'entity.too.large' }),
    ).toMatchObject({ statusCode: 413 });
    expect(
      bodyErrorResponse({ status: 415, type: 'charset.unsupported' }),
    ).toMatchObject({ statusCode: 415 });
    expect(bodyErrorResponse(new Error('boom'))).toBeNull();
    expect(
      bodyErrorResponse({ status: 500, type: 'stream.encoding.set' }),
    ).toBeNull();
  });
});
