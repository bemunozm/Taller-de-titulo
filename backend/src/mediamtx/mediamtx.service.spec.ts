import { BadRequestException, Logger } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import type { LogsService } from '../logs/logs.service';
import { classMetadata, handlerMetadata } from '../test-utils/handler-metadata';
import { MediamtxController } from './mediamtx.controller';
import { MediamtxService, type MediamtxHealth } from './mediamtx.service';

const CAMERA_SOURCE = 'rtsp://admin:Sup3rSecreta@10.0.0.5:554/Streaming/101';

/** Error de axios con la respuesta de la Control API (forma que mira `isAxiosError`). */
function axiosError(status: number, data: unknown): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

const MEDIAMTX_SECRET = 'Hq4Vt8Zm2Lc7Rx1Nw5Kp9Bd3Fs6Gy0JaTe';
const EXPECTED_BASIC = `Basic ${Buffer.from(
  `vigilia-backend:${MEDIAMTX_SECRET}`,
).toString('base64')}`;

/** Headers del config de axios de la llamada `index` de un mock. */
function headersOf(mock: jest.Mock, index = 0): Record<string, string> {
  const call = mock.mock.calls[index] as unknown[];
  const config = call[call.length - 1] as { headers?: Record<string, string> };
  return config.headers ?? {};
}

/**
 * Fase 4 · P6.M: los cuerpos de error de MediaMTX pueden citar la URL de
 * origen de la cámara (con credenciales). Ni el logger ni `system_logs` deben
 * recibirlos crudos. Corrección cyber: toda llamada a la Control API lleva el
 * Basic del backend; el registro usa `paths/replace` (idempotente) y solo
 * acepta fuentes rtsp(s).
 */
describe('MediamtxService — Control API (Fase 4 · P6.M)', () => {
  const previousEnv = { ...process.env };
  let post: jest.Mock;
  let del: jest.Mock;
  let get: jest.Mock;
  let logMediaMTX: jest.Mock;
  let logged: string[];
  let service: MediamtxService;

  beforeEach(() => {
    process.env.MEDIAMTX_MAX_ATTEMPTS = '2';
    process.env.MEDIAMTX_BACKOFF_BASE_MS = '1';
    process.env.MEDIAMTX_AUTH_SECRET = MEDIAMTX_SECRET;
    post = jest.fn();
    del = jest.fn();
    get = jest.fn();
    logMediaMTX = jest.fn().mockResolvedValue(undefined);
    logged = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          logged.push(String(message));
        });
    }
    service = new MediamtxService(
      { post, delete: del, get } as unknown as HttpService,
      { logMediaMTX } as unknown as LogsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...previousEnv };
  });

  /** Todo lo que salió a logs: líneas del logger y lo que se guarda en BD. */
  function everythingLogged(): string {
    return JSON.stringify({
      logged,
      system: logMediaMTX.mock.calls.map(([entry]: [{ error?: Error }]) => ({
        ...entry,
        error: entry.error?.message,
      })),
    });
  }

  it('registro fallido con un cuerpo que cita la fuente: ni el logger ni system_logs ven las credenciales', async () => {
    post.mockReturnValue(
      throwError(() =>
        axiosError(400, {
          error: `invalid source '${CAMERA_SOURCE}'`,
          source: CAMERA_SOURCE,
        }),
      ),
    );

    await expect(
      service.registerSource('porton-a', CAMERA_SOURCE),
    ).rejects.toThrow('No se pudo registrar la fuente en MediaMTX');

    const output = everythingLogged();
    expect(output).not.toContain('Sup3rSecreta');
    expect(output).not.toContain('admin:');
    expect(output).toContain('status=400');
    expect(output).toContain('invalid source');
    // Un 4xx no es transitorio: sin reintentos.
    expect(post).toHaveBeenCalledTimes(1);
    expect(logMediaMTX).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        details: expect.objectContaining({
          mountPath: 'porton-a',
          statusCode: 400,
          errorSummary: "invalid source '[redacted]'",
        }) as unknown,
      }),
    );
    // Nunca el cuerpo crudo (`errorData`).
    expect(output).not.toContain('errorData');
  });

  it('cuerpo real de MediaMTX con una fuente que no es URL: tampoco filtra la clave', async () => {
    // Verificado contra v1.15.2.
    post.mockReturnValue(
      throwError(() =>
        axiosError(400, { error: "invalid source: 'rtsp//admin:secreta@x'" }),
      ),
    );

    await expect(
      service.registerSource('porton-a', CAMERA_SOURCE),
    ).rejects.toThrow();

    expect(everythingLogged()).not.toMatch(/secreta|admin:/);
  });

  it('falla de red o 5xx: reintenta', async () => {
    post
      .mockReturnValueOnce(throwError(() => axiosError(503, {})))
      .mockReturnValueOnce(of({ status: 200, data: {} }));

    await service.registerSource('porton-a', CAMERA_SOURCE);

    expect(post).toHaveBeenCalledTimes(2);
  });

  it('registro: paths/replace (idempotente) con { source } y el Basic del backend, sin loguear la fuente', async () => {
    post.mockReturnValue(of({ status: 200, data: {} }));

    await service.registerSource('porton-a', CAMERA_SOURCE);

    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/\/v3\/config\/paths\/replace\/porton-a$/),
      { source: CAMERA_SOURCE },
      expect.any(Object),
    );
    expect(headersOf(post).Authorization).toBe(EXPECTED_BASIC);
    expect(everythingLogged()).not.toContain('Sup3rSecreta');
  });

  it.each([
    'udp+mpegts://0.0.0.0:9000',
    'publisher',
    'http://10.0.0.5/stream.m3u8',
    'rtsp://',
  ])('rechaza la fuente %s sin llamar a MediaMTX', async (source) => {
    await expect(service.registerSource('porton-a', source)).rejects.toThrow(
      BadRequestException,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('deregistro: lleva el Basic; 404 (el path ya no existe) no es un error', async () => {
    del.mockReturnValue(
      throwError(() =>
        axiosError(404, { error: `path not found; source=${CAMERA_SOURCE}` }),
      ),
    );

    await expect(service.deregisterSource('porton-a')).resolves.toBeNull();

    expect(headersOf(del).Authorization).toBe(EXPECTED_BASIC);
    expect(del).toHaveBeenCalledTimes(1);
    expect(logMediaMTX).not.toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(everythingLogged()).not.toContain('Sup3rSecreta');
  });

  it('deregistro fallido (5xx): no loguea el cuerpo y no lanza', async () => {
    del.mockReturnValue(
      throwError(() =>
        axiosError(500, { error: `boom; source=${CAMERA_SOURCE}` }),
      ),
    );

    await expect(service.deregisterSource('porton-a')).resolves.toBeNull();

    const output = everythingLogged();
    expect(output).not.toContain('Sup3rSecreta');
    expect(output).toContain('status=500');
  });

  it('health: /v3/info con el Basic del backend', async () => {
    get.mockReturnValue(of({ status: 200, data: '{"version":"v1.15.2"}' }));

    await expect(service.getHealth()).resolves.toMatchObject({ ok: true });

    expect(headersOf(get).Authorization).toBe(EXPECTED_BASIC);
  });

  it('waitForPathReady: consulta paths/get con Basic hasta ready: true', async () => {
    get
      .mockReturnValueOnce(of({ status: 200, data: { ready: false } }))
      .mockReturnValueOnce(of({ status: 200, data: { ready: true } }));

    await expect(service.waitForPathReady('porton-a', 1000, 1)).resolves.toBe(
      true,
    );

    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(/\/v3\/paths\/get\/porton-a$/),
      expect.any(Object),
    );
    expect(headersOf(get, 1).Authorization).toBe(EXPECTED_BASIC);
  });

  it('waitForPathReady: false si no queda listo a tiempo', async () => {
    get.mockReturnValue(of({ status: 200, data: { ready: false } }));

    await expect(service.waitForPathReady('porton-a', 5, 1)).resolves.toBe(
      false,
    );
  });

  it('sin MEDIAMTX_AUTH_SECRET no inventa credenciales (MediaMTX negará)', async () => {
    delete process.env.MEDIAMTX_AUTH_SECRET;
    const withoutSecret = new MediamtxService(
      { post, delete: del, get } as unknown as HttpService,
      { logMediaMTX } as unknown as LogsService,
    );
    post.mockReturnValue(of({ status: 200, data: {} }));

    await withoutSecret.registerSource('porton-a', CAMERA_SOURCE);

    expect(headersOf(post).Authorization).toBeUndefined();
  });
});

describe('MediamtxService.getHealth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('interpreta /v3/info', async () => {
    const get = jest.fn().mockReturnValue(
      of({
        status: 200,
        data: '{"version":"v1.15.2","started":"2026-10-09T12:00:00Z"}',
      }),
    );
    const service = new MediamtxService(
      { get } as unknown as HttpService,
      {} as LogsService,
    );

    await expect(service.getHealth()).resolves.toEqual({
      ok: true,
      status: 'running',
      details: {
        version: 'v1.15.2',
        started: '2026-10-09T12:00:00Z',
        raw: { version: 'v1.15.2', started: '2026-10-09T12:00:00Z' },
      },
    });
  });

  it('caído: mensaje genérico, sin la dirección interna', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const get = jest
      .fn()
      .mockReturnValue(
        throwError(() => new Error('connect ECONNREFUSED 127.0.0.1:9997')),
      );
    const service = new MediamtxService(
      { get } as unknown as HttpService,
      {} as LogsService,
    );

    await expect(service.getHealth()).resolves.toEqual({
      ok: false,
      status: 'unavailable',
      message: 'MediaMTX no disponible',
    });
  });
});

/**
 * Fase 4 · P6.M: `GET /mediamtx/health` era público y devolvía el `/v3/info`
 * crudo. Ahora exige sesión con `cameras.read` y recorta la respuesta; el
 * detalle es solo para el super-admin.
 */
describe('MediamtxController.getHealth (Fase 4 · P6.M)', () => {
  const RUNNING: MediamtxHealth = {
    ok: true,
    status: 'running',
    details: {
      version: 'v1.15.2',
      started: '2026-10-09T12:00:00Z',
      raw: { version: 'v1.15.2', started: '2026-10-09T12:00:00Z' },
    },
  };

  function controllerReturning(health: MediamtxHealth): MediamtxController {
    return new MediamtxController({
      getHealth: jest.fn().mockResolvedValue(health),
    } as unknown as MediamtxService);
  }

  function requestAs(isSuperAdmin: boolean) {
    return {
      tenantContext: { organizationId: null, isSuperAdmin },
    } as unknown as Parameters<MediamtxController['getHealth']>[0];
  }

  it('protegido: AuthGuard + AuthorizationGuard y el permiso cameras.read', () => {
    expect(classMetadata(MediamtxController, GUARDS_METADATA)).toEqual([
      AuthGuard,
      AuthorizationGuard,
    ]);
    expect(
      handlerMetadata(MediamtxController, 'getHealth', PERMISSIONS_KEY),
    ).toEqual(['cameras.read']);
  });

  it('usuario con cameras.read: solo ok, status y version', async () => {
    await expect(
      controllerReturning(RUNNING).getHealth(requestAs(false)),
    ).resolves.toEqual({ ok: true, status: 'running', version: 'v1.15.2' });
  });

  it('super-admin: además started, uptime y la respuesta cruda', async () => {
    const response = await controllerReturning(RUNNING).getHealth(
      requestAs(true),
    );

    expect(response).toEqual({
      ok: true,
      status: 'running',
      version: 'v1.15.2',
      started: '2026-10-09T12:00:00.000Z',
      uptimeSeconds: expect.any(Number) as number,
      details: RUNNING.details.raw,
    });
  });

  it('caído: ok false con el mensaje genérico (también para el super-admin)', async () => {
    const down = controllerReturning({
      ok: false,
      status: 'unavailable',
      message: 'MediaMTX no disponible',
    });

    await expect(down.getHealth(requestAs(true))).resolves.toEqual({
      ok: false,
      status: 'unavailable',
      version: null,
      message: 'MediaMTX no disponible',
    });
  });
});
