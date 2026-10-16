import { Test, type TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, FindOperator } from 'typeorm';
import { of, throwError } from 'rxjs';
import { StreamsService } from './streams.service';
import { StreamsController } from './streams.controller';
import { CamerasService } from '../cameras/cameras.service';
import { Camera } from '../cameras/entities/camera.entity';
import { Role } from '../roles/entities/role.entity';
import { LogsService } from '../logs/logs.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { WorkerNotifierService } from '../workers/worker-notifier.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { createMockRepository } from '../test-utils/mock-repository';
import { classMetadata } from '../test-utils/handler-metadata';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEDIAMTX_SECRET = 'Hq4Vt8Zm2Lc7Rx1Nw5Kp9Bd3Fs6Gy0JaTe';
const PREVIOUS_MEDIAMTX_SECRET = process.env.MEDIAMTX_AUTH_SECRET;

/** Restaura `MEDIAMTX_AUTH_SECRET` como estaba antes del spec. */
function restoreMediamtxSecret(): void {
  if (PREVIOUS_MEDIAMTX_SECRET === undefined) {
    delete process.env.MEDIAMTX_AUTH_SECRET;
  } else {
    process.env.MEDIAMTX_AUTH_SECRET = PREVIOUS_MEDIAMTX_SECRET;
  }
}

type Where = Record<string, unknown>;

/**
 * Fase 4 · P5.B: `StreamsService` inyectaba `CamerasService` con el token
 * string 'CamerasService', que ningún módulo provee (`@Optional` →
 * `undefined`): el path de MediaMTX salía siempre del string crudo del
 * cliente. Ahora inyecta la clase real y resuelve el path desde la cámara
 * del condominio del actor.
 */
describe('StreamsService — usa el CamerasService real (P5.B)', () => {
  const rows = [
    { id: CAM_A, organizationId: ORG_A, mountPath: 'porton-a' },
    { id: CAM_B, organizationId: ORG_B, mountPath: 'porton-b' },
  ] as Camera[];
  let post: jest.Mock;
  let ctx: TenantContext;
  let service: StreamsService;
  let moduleRef: TestingModule;

  afterEach(() => {
    restoreMediamtxSecret();
  });

  beforeEach(async () => {
    process.env.MEDIAMTX_AUTH_SECRET = MEDIAMTX_SECRET;
    ctx = { organizationId: ORG_A, isSuperAdmin: false };
    post = jest.fn(() => of({ status: 201, data: 'v=0 answer' }));
    const cameraRepository = createMockRepository<Camera>();
    cameraRepository.findOne.mockImplementation((options: { where: Where }) =>
      Promise.resolve(
        rows.find((row) =>
          Object.entries(options.where).every(([key, expected]) =>
            expected instanceof FindOperator
              ? false
              : (row as unknown as Where)[key] === expected,
          ),
        ) ?? null,
      ),
    );

    moduleRef = await Test.createTestingModule({
      providers: [
        StreamsService,
        CamerasService,
        { provide: getRepositoryToken(Camera), useValue: cameraRepository },
        {
          provide: getRepositoryToken(Role),
          useValue: createMockRepository<Role>(),
        },
        {
          provide: TenantContextService,
          useValue: { getContext: () => Promise.resolve(ctx) },
        },
        { provide: HttpService, useValue: { post } },
        {
          provide: LogsService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: MediamtxService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: WorkerNotifierService, useValue: {} },
      ],
    }).compile();

    service = await moduleRef.resolve(StreamsService);
  });

  it('declara la CLASE CamerasService como dependencia (no un token string)', () => {
    const paramTypes = classMetadata(
      StreamsService,
      'design:paramtypes',
    ) as unknown[];
    expect(paramTypes).toContain(CamerasService);
    const customTokens = classMetadata(StreamsService, 'self:paramtypes') as
      | Array<{ param: unknown }>
      | undefined;
    expect(customTokens ?? []).not.toContainEqual(
      expect.objectContaining({ param: 'CamerasService' }),
    );
  });

  it('cámara pedida por id: negocia con el mountPath de ESA cámara', async () => {
    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).resolves.toBe('v=0 answer');

    expect(post).toHaveBeenCalledWith(
      expect.stringMatching(/\/porton-a\/whep$/),
      'v=0 offer',
      expect.any(Object),
    );
  });

  it('cámara de otro condominio -> 404 sin contactar a MediaMTX', async () => {
    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_B),
    ).rejects.toThrow(NotFoundException);
    expect(post).not.toHaveBeenCalled();
  });

  it('un path que no es una cámara -> 404 (antes se reenviaba tal cual a MediaMTX)', async () => {
    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', 'porton-b'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', 'cualquier/path'),
    ).rejects.toThrow(NotFoundException);
    expect(post).not.toHaveBeenCalled();
  });

  /**
   * Fase 4 · P6.M (D14): MediaMTX corre con `authMethod: http`; el forward se
   * identifica con Basic `vigilia-backend:<MEDIAMTX_AUTH_SECRET>`.
   */
  it('manda Authorization: Basic vigilia-backend:<MEDIAMTX_AUTH_SECRET> y Content-Type SDP', async () => {
    await service.forwardOfferToMediaMtx('v=0 offer', CAM_A);

    const [, , config] = post.mock.calls[0] as [
      string,
      string,
      { headers: Record<string, string> },
    ];
    expect(config.headers['Content-Type']).toBe('application/sdp');
    const authorization = config.headers.Authorization;
    expect(authorization).toMatch(/^Basic /);
    expect(
      Buffer.from(authorization.slice('Basic '.length), 'base64').toString(
        'utf8',
      ),
    ).toBe(`vigilia-backend:${MEDIAMTX_SECRET}`);
  });

  it('sin MEDIAMTX_AUTH_SECRET -> 503 sin contactar a MediaMTX (fail-closed)', async () => {
    delete process.env.MEDIAMTX_AUTH_SECRET;
    // El secreto se lee al construir el servicio: instancia nueva, mismas
    // dependencias.
    const fresh = new StreamsService(
      moduleRef.get(HttpService),
      moduleRef.get(LogsService),
      await moduleRef.resolve(CamerasService),
      moduleRef.get(MediamtxService),
    );

    await expect(
      fresh.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(post).not.toHaveBeenCalled();
  });
});

/** Error de axios con la respuesta de MediaMTX (forma que mira `isAxiosError`). */
function axiosError(status: number, data: unknown): Error {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

/**
 * Fase 4 · P6.M (corrección QA): tras reiniciar MediaMTX los paths se
 * pierden. Si WHEP responde "is not configured", se re-registra la cámara
 * (acotada al condominio) y se reintenta UNA vez; el motivo de MediaMTX
 * (redactado) va al log.
 */
describe('StreamsService — recuperación tras reiniciar MediaMTX', () => {
  const previousEnv = { ...process.env };
  let post: jest.Mock;
  let camerasService: {
    getMountPath: jest.Mock;
    reregisterInMediamtx: jest.Mock;
  };
  let mediamtxService: { waitForPathReady: jest.Mock };
  let logLines: string[];
  let service: StreamsService;

  const NOT_CONFIGURED = axiosError(
    400,
    JSON.stringify({ error: "path 'porton-a' is not configured" }),
  );

  beforeEach(() => {
    process.env.MEDIAMTX_AUTH_SECRET = MEDIAMTX_SECRET;
    process.env.CAMERAS_REGISTER_IN_MEDIAMTX = 'true';
    post = jest.fn();
    camerasService = {
      getMountPath: jest.fn().mockResolvedValue('porton-a'),
      reregisterInMediamtx: jest.fn().mockResolvedValue(true),
    };
    mediamtxService = { waitForPathReady: jest.fn().mockResolvedValue(true) };
    logLines = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          logLines.push(String(message));
        });
    }
    service = new StreamsService(
      { post } as unknown as HttpService,
      { log: jest.fn().mockResolvedValue(undefined) } as unknown as LogsService,
      camerasService as unknown as CamerasService,
      mediamtxService as unknown as MediamtxService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...previousEnv };
  });

  it('"is not configured" -> re-registra la cámara, espera el stream y reintenta una vez', async () => {
    post
      .mockReturnValueOnce(throwError(() => NOT_CONFIGURED))
      .mockReturnValueOnce(of({ status: 201, data: 'v=0 answer' }));

    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).resolves.toBe('v=0 answer');

    expect(camerasService.reregisterInMediamtx).toHaveBeenCalledWith(CAM_A);
    expect(mediamtxService.waitForPathReady).toHaveBeenCalledWith('porton-a');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('si el reintento también falla -> 500, sin un tercer intento', async () => {
    post.mockReturnValue(throwError(() => NOT_CONFIGURED));

    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).rejects.toThrow(InternalServerErrorException);
    expect(post).toHaveBeenCalledTimes(2);
    expect(logLines.join('\n')).toContain('is not configured');
  });

  it('no se pudo re-registrar -> 500 sin reintentar', async () => {
    camerasService.reregisterInMediamtx.mockResolvedValue(false);
    post.mockReturnValue(throwError(() => NOT_CONFIGURED));

    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).rejects.toThrow(InternalServerErrorException);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('con el registro de cámaras desactivado no re-registra', async () => {
    process.env.CAMERAS_REGISTER_IN_MEDIAMTX = 'false';
    post.mockReturnValue(throwError(() => NOT_CONFIGURED));

    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).rejects.toThrow(InternalServerErrorException);
    expect(camerasService.reregisterInMediamtx).not.toHaveBeenCalled();
  });

  it('otro error (p. ej. sin stream) no re-registra; responde 503 y loguea el motivo', async () => {
    post.mockReturnValue(
      throwError(() =>
        axiosError(
          404,
          JSON.stringify({
            error: "no stream is available on path 'porton-a'",
          }),
        ),
      ),
    );

    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(camerasService.reregisterInMediamtx).not.toHaveBeenCalled();
    expect(logLines.join('\n')).toMatch(
      /status=404 error="no stream is available on path 'porton-a'"/,
    );
  });

  it('el motivo logueado no lleva la fuente ni credenciales', async () => {
    post.mockReturnValue(
      throwError(() =>
        axiosError(
          400,
          JSON.stringify({
            error: "invalid source: 'rtsp://admin:Sup3rSecreta@10.0.0.5/s'",
          }),
        ),
      ),
    );

    await expect(
      service.forwardOfferToMediaMtx('v=0 offer', CAM_A),
    ).rejects.toThrow(InternalServerErrorException);
    expect(logLines.join('\n')).not.toMatch(/Sup3rSecreta|admin:/);
    expect(logLines.join('\n')).toContain("invalid source: '[redacted]'");
  });
});

describe('StreamsController.whep — usa la cámara autorizada por CameraViewGuard', () => {
  it('negocia con la cámara del guard, no con el string crudo del body', async () => {
    const forwardOfferToMediaMtx = jest.fn().mockResolvedValue('v=0 answer');
    const controller = new StreamsController({
      forwardOfferToMediaMtx,
    } as unknown as StreamsService);

    await expect(
      controller.whep(
        { offer: 'v=0 offer', cameraMount: 'string-del-cliente' },
        { authorizedCamera: { id: CAM_A, mountPath: 'porton-a' } },
      ),
    ).resolves.toEqual({ answer: 'v=0 answer' });
    expect(forwardOfferToMediaMtx).toHaveBeenCalledWith('v=0 offer', CAM_A);
  });

  it('sin cámara autorizada (sin guard) -> 403, fail-closed', async () => {
    const forwardOfferToMediaMtx = jest.fn();
    const controller = new StreamsController({
      forwardOfferToMediaMtx,
    } as unknown as StreamsService);

    await expect(
      controller.whep({ offer: 'v=0', cameraMount: CAM_A }, {}),
    ).rejects.toThrow(ForbiddenException);
    expect(forwardOfferToMediaMtx).not.toHaveBeenCalled();
  });
});
