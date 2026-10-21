import { Logger, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FindOperator, type Repository } from 'typeorm';
import { CamerasService } from './cameras.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { Camera } from './entities/camera.entity';
import { isAllowedCameraSourceUrl } from './camera-source-url';
import {
  MEDIAMTX_SYNC_INITIAL_DELAY_MS,
  MEDIAMTX_SYNC_INTERVAL_MS,
  MEDIAMTX_SYNC_MAX_BACKOFF_MS,
  MediamtxSyncService,
} from './mediamtx-sync.service';
import type { Role } from '../roles/entities/role.entity';
import type { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type {
  MediamtxHealth,
  MediamtxService,
} from '../mediamtx/mediamtx.service';
import type { WorkerNotifierService } from '../workers/worker-notifier.service';
import { createMockRepository } from '../test-utils/mock-repository';
import { createTenantContextDouble } from '../test-utils/tenant-context.double';
import { encryptString } from '../utils/crypto.util';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAM_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAM_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CTX_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };
const SOURCE_A = 'rtsp://admin:Sup3rSecreta@10.0.0.1/a';

type Where = Record<string, unknown>;

function matchesWhere(row: Camera, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (expected instanceof FindOperator) {
      return expected.type === 'isNull' ? actual === null : false;
    }
    return actual === expected;
  });
}

const previousKey = process.env.CAMERAS_ENCRYPTION_KEY;
const previousRegister = process.env.CAMERAS_REGISTER_IN_MEDIAMTX;

beforeAll(() => {
  process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

afterAll(() => {
  for (const [name, value] of [
    ['CAMERAS_ENCRYPTION_KEY', previousKey],
    ['CAMERAS_REGISTER_IN_MEDIAMTX', previousRegister],
  ] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

function camera(overrides: Partial<Camera>): Camera {
  return {
    id: CAM_A,
    organizationId: ORG_A,
    name: 'Cámara',
    location: 'Portón',
    encryptedSourceUrl: encryptString(SOURCE_A),
    mountPath: 'cam-a',
    registeredInMediamtx: false,
    enableLpr: true,
    enableGuardian: false,
    guardianZones: [],
    lprSettings: null,
    active: true,
    roles: [],
    ...overrides,
  };
}

/**
 * Fase 4 · P6.M (corrección QA): el forward WHEP re-registra una cámara que
 * MediaMTX perdió al reiniciarse. Acotado al condominio del actor y sin avisar
 * al manager LPR.
 */
describe('CamerasService.reregisterInMediamtx', () => {
  let rows: Camera[];
  let repo: { findOne: jest.Mock; update: jest.Mock };
  let mediamtx: { registerSource: jest.Mock };
  let workerNotifier: { registerCamera: jest.Mock };
  let service: CamerasService;

  beforeEach(() => {
    rows = [
      camera({ id: CAM_A, organizationId: ORG_A, mountPath: 'cam-a' }),
      camera({ id: CAM_B, organizationId: ORG_B, mountPath: 'cam-b' }),
      camera({
        id: CAM_C,
        organizationId: ORG_A,
        mountPath: 'cam-c',
        active: false,
      }),
    ];
    repo = {
      findOne: jest.fn((options: { where: Where }) =>
        Promise.resolve(
          rows.find((row) => matchesWhere(row, options.where)) ?? null,
        ),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mediamtx = { registerSource: jest.fn().mockResolvedValue(undefined) };
    workerNotifier = { registerCamera: jest.fn() };
    service = new CamerasService(
      repo as unknown as Repository<Camera>,
      createMockRepository<Role>() as unknown as Repository<Role>,
      createTenantContextDouble(CTX_A) as unknown as TenantContextService,
      mediamtx as unknown as MediamtxService,
      undefined,
      workerNotifier as unknown as WorkerNotifierService,
    );
  });

  it('cámara activa del condominio: registra con su URL descifrada y marca registeredInMediamtx', async () => {
    await expect(service.reregisterInMediamtx(CAM_A)).resolves.toBe(true);

    expect(mediamtx.registerSource).toHaveBeenCalledWith('cam-a', SOURCE_A);
    expect(repo.update).toHaveBeenCalledWith(
      { id: CAM_A },
      { registeredInMediamtx: true },
    );
    // La cámara no cambió: el manager LPR no se entera.
    expect(workerNotifier.registerCamera).not.toHaveBeenCalled();
  });

  it('cámara de otro condominio -> 404 sin tocar MediaMTX', async () => {
    await expect(service.reregisterInMediamtx(CAM_B)).rejects.toThrow(
      NotFoundException,
    );
    expect(mediamtx.registerSource).not.toHaveBeenCalled();
  });

  it('cámara inactiva -> false sin tocar MediaMTX', async () => {
    await expect(service.reregisterInMediamtx(CAM_C)).resolves.toBe(false);
    expect(mediamtx.registerSource).not.toHaveBeenCalled();
  });

  it('MediaMTX falla -> false (el flag ya estaba en false: no se escribe)', async () => {
    mediamtx.registerSource.mockRejectedValue(new Error('caído'));

    await expect(service.reregisterInMediamtx(CAM_A)).resolves.toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

/**
 * Fase 4 · P6.M (corrección QA): resincronización de todas las cámaras al
 * arrancar y cuando MediaMTX vuelve o se reinicia.
 */
describe('MediamtxSyncService', () => {
  let rows: Camera[];
  let repo: { find: jest.Mock; update: jest.Mock };
  let mediamtx: { getHealth: jest.Mock; registerSource: jest.Mock };
  let logged: string[];
  let service: MediamtxSyncService;

  const UP = (started = '2026-10-09T12:00:00Z'): MediamtxHealth => ({
    ok: true,
    status: 'running',
    details: { version: 'v1.15.2', started, raw: {} },
  });
  const DOWN: MediamtxHealth = {
    ok: false,
    status: 'unavailable',
    message: 'MediaMTX no disponible',
  };

  beforeEach(() => {
    process.env.CAMERAS_REGISTER_IN_MEDIAMTX = 'true';
    rows = [
      camera({ id: CAM_A, mountPath: 'cam-a', registeredInMediamtx: true }),
      camera({
        id: CAM_B,
        organizationId: ORG_B,
        mountPath: '',
        registeredInMediamtx: false,
        encryptedSourceUrl: encryptString('rtsps://u:p@10.0.0.2/b'),
      }),
      camera({
        id: CAM_C,
        mountPath: 'cam-c',
        encryptedSourceUrl: null as unknown as string,
      }),
      camera({
        id: CAM_D,
        mountPath: 'cam-d',
        encryptedSourceUrl: encryptString('udp+mpegts://0.0.0.0:9000'),
      }),
    ];
    repo = {
      find: jest.fn(() => Promise.resolve(rows)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mediamtx = {
      getHealth: jest.fn().mockResolvedValue(UP()),
      registerSource: jest.fn().mockResolvedValue(undefined),
    };
    logged = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((message: unknown) => {
          logged.push(String(message));
        });
    }
    service = new MediamtxSyncService(
      repo as unknown as Repository<Camera>,
      mediamtx as unknown as MediamtxService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('primer chequeo OK (arranque): registra las cámaras activas rtsp(s) y omite el resto', async () => {
    await expect(service.tick()).resolves.toBe(MEDIAMTX_SYNC_INTERVAL_MS);

    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
    expect(mediamtx.registerSource).toHaveBeenCalledTimes(2);
    expect(mediamtx.registerSource).toHaveBeenCalledWith('cam-a', SOURCE_A);
    // Sin mountPath: el mount es el id.
    expect(mediamtx.registerSource).toHaveBeenCalledWith(
      CAM_B,
      'rtsps://u:p@10.0.0.2/b',
    );
    // Solo se escribe el flag que cambió.
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      { id: CAM_B },
      { registeredInMediamtx: true },
    );
    expect(logged.join('\n')).toContain(
      'Resincronización con MediaMTX: 2 registradas, 0 fallidas, 2 omitidas',
    );
    expect(logged.join('\n')).not.toMatch(/Sup3rSecreta|u:p@/);
  });

  it('con MediaMTX estable no vuelve a resincronizar', async () => {
    await service.tick();
    mediamtx.registerSource.mockClear();

    await service.tick();

    expect(mediamtx.registerSource).not.toHaveBeenCalled();
  });

  it('MediaMTX caído: backoff creciente con tope, un solo warn; al volver, resincroniza', async () => {
    await service.tick();
    mediamtx.registerSource.mockClear();
    mediamtx.getHealth.mockResolvedValue(DOWN);

    const delays: number[] = [];
    for (let i = 0; i < 6; i++) {
      delays.push(await service.tick());
    }

    expect(delays).toEqual([
      MEDIAMTX_SYNC_INTERVAL_MS,
      MEDIAMTX_SYNC_INTERVAL_MS * 2,
      MEDIAMTX_SYNC_INTERVAL_MS * 4,
      MEDIAMTX_SYNC_INTERVAL_MS * 8,
      MEDIAMTX_SYNC_MAX_BACKOFF_MS,
      MEDIAMTX_SYNC_MAX_BACKOFF_MS,
    ]);
    expect(
      logged.filter((line) => line.includes('MediaMTX no responde')),
    ).toHaveLength(1);

    mediamtx.getHealth.mockResolvedValue(UP());
    await service.tick();

    expect(mediamtx.registerSource).toHaveBeenCalledTimes(2);
    expect(logged.join('\n')).toContain('MediaMTX volvió a responder');
  });

  it('MediaMTX se reinició entre dos chequeos (cambió started): resincroniza', async () => {
    await service.tick();
    mediamtx.registerSource.mockClear();
    mediamtx.getHealth.mockResolvedValue(UP('2026-10-09T13:00:00Z'));

    await service.tick();

    expect(mediamtx.registerSource).toHaveBeenCalledTimes(2);
  });

  it('si alguna cámara falla, se reintenta en el próximo chequeo y el flag queda en false', async () => {
    mediamtx.registerSource.mockImplementation((mount: string) =>
      mount === 'cam-a'
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve(),
    );

    await service.tick();

    expect(repo.update).toHaveBeenCalledWith(
      { id: CAM_A },
      { registeredInMediamtx: false },
    );
    mediamtx.registerSource.mockClear();
    mediamtx.registerSource.mockResolvedValue(undefined);

    await service.tick();

    expect(mediamtx.registerSource).toHaveBeenCalledTimes(2);
  });

  it('al arrancar programa el primer chequeo (con el registro activo)', async () => {
    jest.useFakeTimers();

    service.onApplicationBootstrap();
    expect(mediamtx.getHealth).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(MEDIAMTX_SYNC_INITIAL_DELAY_MS);

    expect(mediamtx.getHealth).toHaveBeenCalledTimes(1);
  });

  it('sin CAMERAS_REGISTER_IN_MEDIAMTX=true no hace nada', async () => {
    process.env.CAMERAS_REGISTER_IN_MEDIAMTX = 'false';
    jest.useFakeTimers();

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(MEDIAMTX_SYNC_INTERVAL_MS * 2);

    expect(mediamtx.getHealth).not.toHaveBeenCalled();
  });
});

/**
 * Fase 4 · P6.M (corrección cyber): la fuente de una cámara solo puede ser
 * `rtsp://` o `rtsps://` (POST y PATCH).
 */
describe('sourceUrl de cámaras: solo rtsp:// y rtsps://', () => {
  async function sourceErrors(
    dtoClass: typeof CreateCameraDto | typeof UpdateCameraDto,
    sourceUrl: unknown,
  ): Promise<string[]> {
    const dto = plainToInstance(dtoClass, { name: 'Portón', sourceUrl });
    const errors = await validate(dto);
    return errors
      .filter((error) => error.property === 'sourceUrl')
      .flatMap((error) => Object.keys(error.constraints ?? {}));
  }

  it.each([
    'rtsp://admin:clave@10.0.0.5:554/Streaming/101',
    'RTSPS://cam.local/live',
  ])('acepta %s', async (url) => {
    await expect(sourceErrors(CreateCameraDto, url)).resolves.toEqual([]);
    await expect(sourceErrors(UpdateCameraDto, url)).resolves.toEqual([]);
  });

  it.each([
    'udp://0.0.0.0:9000',
    'udp+mpegts://0.0.0.0:9000',
    'http://10.0.0.5/stream.m3u8',
    'rtmp://10.0.0.5/live',
    'whep://10.0.0.5/cam',
    'publisher',
    'rtsp://',
    'rtsp:// espacio',
  ])('rechaza %s (creación y edición)', async (url) => {
    await expect(sourceErrors(CreateCameraDto, url)).resolves.toContain(
      'isCameraSourceUrl',
    );
    await expect(sourceErrors(UpdateCameraDto, url)).resolves.toContain(
      'isCameraSourceUrl',
    );
  });

  it('PATCH sin sourceUrl sigue siendo válido', async () => {
    await expect(sourceErrors(UpdateCameraDto, undefined)).resolves.toEqual([]);
  });

  it('isAllowedCameraSourceUrl exige host', () => {
    expect(isAllowedCameraSourceUrl('rtsp://10.0.0.5/a')).toBe(true);
    expect(isAllowedCameraSourceUrl('rtsp:///a')).toBe(false);
  });
});
