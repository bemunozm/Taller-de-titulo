import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Repository } from 'typeorm';
import { WorkersController } from './workers.controller';
import { WorkerNotifierService } from './worker-notifier.service';
import { CamerasService } from '../cameras/cameras.service';
import { Camera } from '../cameras/entities/camera.entity';
import type { LprSettings } from '../cameras/lpr-settings';
import { Role } from '../roles/entities/role.entity';
import {
  ServiceApiKeyGuard,
  ServiceKeyRequest,
} from '../auth/guards/service-api-key.guard';
import { createMockRepository } from '../test-utils/mock-repository';
import { encryptString } from '../utils/crypto.util';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAM_A_OFF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CAM_A_NO_SOURCE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CAM_A_CORRUPT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function camera(overrides: Partial<Camera>): Camera {
  return {
    id: CAM_A,
    organizationId: ORG_A,
    name: 'Porton',
    location: 'Acceso',
    encryptedSourceUrl: '',
    mountPath: 'porton',
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

function requestFor(organizationId: string): ServiceKeyRequest {
  return {
    serviceKey: { keyId: 'key-1', organizationId, ownerUserId: 'owner-1' },
  };
}

interface FindOptions {
  where: {
    organizationId?: string;
    active?: boolean;
    id?: string;
    mountPath?: string;
  };
}

describe('WorkersController (camaras acotadas por service key)', () => {
  const originalKey = process.env.CAMERAS_ENCRYPTION_KEY;
  const cameraRepository = createMockRepository<Camera>();
  const store: Camera[] = [];
  let controller: WorkersController;

  beforeAll(() => {
    process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
    store.push(
      camera({
        id: CAM_A,
        organizationId: ORG_A,
        mountPath: 'porton-a',
        encryptedSourceUrl: encryptString('rtsp://a/stream'),
      }),
      camera({
        id: CAM_B,
        organizationId: ORG_B,
        name: 'Camara B',
        mountPath: 'porton-b',
        encryptedSourceUrl: encryptString('rtsp://b/stream'),
      }),
      camera({
        id: CAM_A_OFF,
        organizationId: ORG_A,
        name: 'Apagada',
        mountPath: 'apagada-a',
        active: false,
        encryptedSourceUrl: encryptString('rtsp://off/stream'),
      }),
      camera({
        id: CAM_A_NO_SOURCE,
        organizationId: ORG_A,
        name: 'Sin source',
        mountPath: 'sin-source-a',
        encryptedSourceUrl: '',
      }),
      camera({
        id: CAM_A_CORRUPT,
        organizationId: ORG_A,
        name: 'Corrupta',
        mountPath: 'corrupta-a',
        // Cifrada con OTRA clave: el descifrado falla (tag GCM inválido).
        encryptedSourceUrl: Buffer.alloc(48, 9).toString('base64'),
      }),
    );
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.CAMERAS_ENCRYPTION_KEY;
    else process.env.CAMERAS_ENCRYPTION_KEY = originalKey;
  });

  beforeEach(() => {
    // Repositorio en memoria minimo: find por organizationId (+ active si se
    // pide), findOne por id/mountPath.
    cameraRepository.find.mockImplementation((options: FindOptions) =>
      Promise.resolve(
        store.filter(
          (c) =>
            c.organizationId === options.where.organizationId &&
            (options.where.active === undefined ||
              c.active === options.where.active),
        ),
      ),
    );
    cameraRepository.findOne.mockImplementation((options: FindOptions) =>
      Promise.resolve(
        store.find(
          (c) =>
            c.id === options.where.id ||
            c.mountPath === options.where.mountPath,
        ) ?? null,
      ),
    );
    cameraRepository.find.mockClear();

    const camerasService = new CamerasService(
      cameraRepository as unknown as Repository<Camera>,
      createMockRepository<Role>() as unknown as Repository<Role>,
      {} as never,
    );
    controller = new WorkersController(
      {} as WorkerNotifierService,
      camerasService,
    );
  });

  describe('GET /workers/cameras', () => {
    it('lista solo las camaras ACTIVAS del condominio de la key', async () => {
      const result = await controller.listCameras(requestFor(ORG_A));

      expect(result.map((c) => c.id).sort()).toEqual(
        [CAM_A, CAM_A_NO_SOURCE, CAM_A_CORRUPT].sort(),
      );
      expect(result.map((c) => c.id)).not.toContain(CAM_A_OFF);
      expect(cameraRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, active: true },
        }),
      );
    });

    it('una key de otro condominio no ve las camaras ajenas', async () => {
      const result = await controller.listCameras(requestFor(ORG_B));

      expect(result.map((c) => c.id)).toEqual([CAM_B]);
    });

    it('no expone la URL cifrada ni los roles', async () => {
      const [view] = await controller.listCameras(requestFor(ORG_A));

      expect(Object.keys(view).sort()).toEqual([
        'enableGuardian',
        'enableLpr',
        'id',
        'mountPath',
        'name',
      ]);
    });

    it('key sin organizacion -> 403 (fail-closed) y no consulta camaras', async () => {
      await expect(controller.listCameras(requestFor(''))).rejects.toThrow(
        ForbiddenException,
      );
      expect(cameraRepository.find).not.toHaveBeenCalled();
    });

    it('request sin serviceKey -> 403', async () => {
      await expect(controller.listCameras({})).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('GET /workers/cameras/:id/lpr-settings', () => {
    const SETTINGS: LprSettings = {
      action: 'register',
      direction: 'both',
      zone: [
        [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.5, y: 0.9 },
        ],
      ],
      detectorImgsz: 1920,
      sampleFps: 8,
      crop: { minWidth: 60, maxWidth: 250, minRatio: 0.8, maxRatio: 6 },
      confirmReads: 3,
    };

    afterEach(() => {
      store[0].lprSettings = null;
    });

    it('cámara sin configuración -> { cameraId, enableLpr, lprSettings: null }', async () => {
      await expect(
        controller.getCameraLprSettings(requestFor(ORG_A), CAM_A),
      ).resolves.toEqual({
        cameraId: CAM_A,
        enableLpr: true,
        lprSettings: null,
      });
    });

    it('con configuración: contrato exacto, por id o mountPath, sin URL cifrada ni roles', async () => {
      store[0].lprSettings = { ...SETTINGS };

      const byId = await controller.getCameraLprSettings(
        requestFor(ORG_A),
        CAM_A,
      );
      const byMount = await controller.getCameraLprSettings(
        requestFor(ORG_A),
        'porton-a',
      );

      expect(byId).toEqual({
        cameraId: CAM_A,
        enableLpr: true,
        lprSettings: SETTINGS,
      });
      expect(byMount).toEqual(byId);
      expect(Object.keys(byId).sort()).toEqual([
        'cameraId',
        'enableLpr',
        'lprSettings',
      ]);
      expect(JSON.stringify(byId)).not.toContain('rtsp');
      expect(JSON.stringify(byId)).not.toContain('encryptedSourceUrl');
    });

    it('una camara de otro condominio responde 404 (por id y por mountPath)', async () => {
      await expect(
        controller.getCameraLprSettings(requestFor(ORG_A), CAM_B),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.getCameraLprSettings(requestFor(ORG_A), 'porton-b'),
      ).rejects.toThrow(NotFoundException);
    });

    it('key sin organizacion -> 403', async () => {
      await expect(
        controller.getCameraLprSettings(requestFor(''), CAM_A),
      ).rejects.toThrow(ForbiddenException);
      await expect(controller.getCameraLprSettings({}, CAM_A)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('la ruta exige ServiceApiKeyGuard', () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- solo se lee la metadata del handler
      const handler = WorkersController.prototype.getCameraLprSettings;
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
      expect(guards).toEqual([ServiceApiKeyGuard]);
    });
  });

  describe('GET /workers/cameras/:id/source', () => {
    it('devuelve la URL descifrada de una camara del propio condominio (por id o mountPath)', async () => {
      await expect(
        controller.getCameraSource(requestFor(ORG_A), CAM_A),
      ).resolves.toEqual({
        sourceUrl: 'rtsp://a/stream',
      });
      await expect(
        controller.getCameraSource(requestFor(ORG_A), 'porton-a'),
      ).resolves.toEqual({
        sourceUrl: 'rtsp://a/stream',
      });
    });

    it('una camara de otro condominio responde 404, sin filtrar su URL', async () => {
      await expect(
        controller.getCameraSource(requestFor(ORG_A), CAM_B),
      ).rejects.toThrow(NotFoundException);
      await expect(
        controller.getCameraSource(requestFor(ORG_A), 'porton-b'),
      ).rejects.toThrow(NotFoundException);
    });

    it('key sin organizacion -> 403', async () => {
      await expect(
        controller.getCameraSource(requestFor(''), CAM_A),
      ).rejects.toThrow(ForbiddenException);
      await expect(controller.getCameraSource({}, CAM_A)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('camara sin encryptedSourceUrl -> { sourceUrl: null }', async () => {
      await expect(
        controller.getCameraSource(requestFor(ORG_A), CAM_A_NO_SOURCE),
      ).resolves.toEqual({ sourceUrl: null });
    });

    it('fallo al descifrar -> 500 generico, sin exponer el payload ni el error', async () => {
      const error = await controller
        .getCameraSource(requestFor(ORG_A), CAM_A_CORRUPT)
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InternalServerErrorException);
      const message = (error as InternalServerErrorException).message;
      expect(message).toBe('Error al desencriptar sourceUrl');
      expect(JSON.stringify(error)).not.toContain(
        Buffer.alloc(48, 9).toString('base64'),
      );
    });
  });

  describe('guards', () => {
    it.each(['listCameras', 'getCameraSource'] as const)(
      '%s sigue protegido con ServiceApiKeyGuard',
      (handler) => {
        // @UseGuards guarda la metadata en la función del handler.
        const descriptor = Object.getOwnPropertyDescriptor(
          WorkersController.prototype,
          handler,
        );
        const guards = Reflect.getMetadata(
          GUARDS_METADATA,
          descriptor?.value as object,
        ) as unknown[];
        expect(guards).toEqual([ServiceApiKeyGuard]);
      },
    );
  });
});

/**
 * Corrección P5 (cyber B4): `GET /workers/ia-health` devolvía los workers
 * (cameraId, estado) de TODOS los condominios. Ahora se acotan a las cámaras
 * del condominio del actor.
 */
describe('WorkersController — GET /workers/ia-health acotado (corrección P5)', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';
  const OWN_CAMERA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const OTHER_CAMERA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const managerDetails = {
    ok: true,
    running_workers: 3,
    workers: [
      { cameraId: OWN_CAMERA, alive: true, mode: 'lpr' },
      { cameraId: `${OWN_CAMERA}_guardia`, alive: false, mode: 'guardia' },
      { cameraId: OTHER_CAMERA, alive: true, mode: 'lpr' },
    ],
  };
  let findIdsByOrganization: jest.Mock;
  let getHealth: jest.Mock;
  let controller: WorkersController;

  beforeEach(() => {
    findIdsByOrganization = jest.fn().mockResolvedValue([OWN_CAMERA]);
    getHealth = jest.fn().mockResolvedValue({
      ok: true,
      status: 'running',
      details: managerDetails,
    });
    controller = new WorkersController(
      { getHealth } as unknown as WorkerNotifierService,
      { findIdsByOrganization } as unknown as CamerasService,
    );
  });

  it('actor de un condominio: solo los workers de sus cámaras (incluido el Guardián) y running_workers recalculado', async () => {
    const result = await controller.getIaHealth({
      organizationId: ORG,
      isSuperAdmin: false,
    });

    expect(findIdsByOrganization).toHaveBeenCalledWith(ORG);
    expect(result.details).toEqual({
      ok: true,
      running_workers: 1,
      workers: [
        { cameraId: OWN_CAMERA, alive: true, mode: 'lpr' },
        { cameraId: `${OWN_CAMERA}_guardia`, alive: false, mode: 'guardia' },
      ],
    });
  });

  it('actor sin condominio: ningún worker, sin consultar cámaras', async () => {
    const result = await controller.getIaHealth({
      organizationId: null,
      isSuperAdmin: false,
    });

    expect(findIdsByOrganization).not.toHaveBeenCalled();
    expect(result.details).toEqual(
      expect.objectContaining({ workers: [], running_workers: 0 }),
    );
  });

  it('super-admin: todos los workers', async () => {
    const result = await controller.getIaHealth({
      organizationId: null,
      isSuperAdmin: true,
    });

    expect(result.details).toEqual(managerDetails);
  });

  it('un details con otra forma (error del manager) solo lo ve el super-admin', async () => {
    getHealth.mockResolvedValue({
      ok: false,
      status: 'error',
      details: { error: 'traza interna' },
    });

    const result = await controller.getIaHealth({
      organizationId: ORG,
      isSuperAdmin: false,
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, status: 'error', details: null }),
    );
  });
});
