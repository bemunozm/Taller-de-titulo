import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, FindOperator, type Repository } from 'typeorm';
import { CamerasService } from './cameras.service';
import { Camera } from './entities/camera.entity';
import { UpdateLprSettingsDto } from './dto/lpr-settings.dto';
import { Role } from '../roles/entities/role.entity';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { WorkerNotifierService } from '../workers/worker-notifier.service';
import { createMockRepository } from '../test-utils/mock-repository';
import { encryptString } from '../utils/crypto.util';
import {
  createTenantContextDouble,
  type TenantContextDouble,
} from '../test-utils/tenant-context.double';

describe('CamerasService', () => {
  let service: CamerasService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CamerasService,
        {
          provide: getRepositoryToken(Camera),
          useValue: createMockRepository<Camera>(),
        },
        {
          provide: getRepositoryToken(Role),
          useValue: createMockRepository<Role>(),
        },
        { provide: TenantContextService, useValue: {} },
        { provide: MediamtxService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: WorkerNotifierService, useValue: {} },
      ],
    }).compile();

    service = await module.resolve<CamerasService>(CamerasService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CTX_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };
const SUPER_ADMIN: TenantContext = { organizationId: null, isSuperAdmin: true };

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

/**
 * Fase 4 · P5.B: toda lectura o escritura de una cámara por id o mountPath
 * desde una request se acota al condominio del actor. Una cámara de otro
 * condominio responde 404, igual que una inexistente; el super-admin ve
 * todas.
 */
describe('CamerasService — aislamiento por condominio (P5.B)', () => {
  const previousKey = process.env.CAMERAS_ENCRYPTION_KEY;
  let rows: Camera[];
  let repo: {
    findOne: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
  };
  let tenantContext: TenantContextDouble;
  let mediamtx: { registerSource: jest.Mock; deregisterSource: jest.Mock };
  let workerNotifier: {
    registerCamera: jest.Mock;
    unregisterCamera: jest.Mock;
  };
  let service: CamerasService;

  beforeAll(() => {
    process.env.CAMERAS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(() => {
    if (previousKey === undefined) {
      delete process.env.CAMERAS_ENCRYPTION_KEY;
    } else {
      process.env.CAMERAS_ENCRYPTION_KEY = previousKey;
    }
  });

  function camera(overrides: Partial<Camera>): Camera {
    return {
      id: CAM_A,
      organizationId: ORG_A,
      name: 'Cámara',
      location: 'Portón',
      encryptedSourceUrl: encryptString('rtsp://admin:secreto@10.0.0.1/a'),
      mountPath: 'cam-a',
      registeredInMediamtx: true,
      enableLpr: false,
      enableGuardian: false,
      guardianZones: [],
      lprSettings: null,
      active: true,
      roles: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    rows = [
      camera({ id: CAM_A, organizationId: ORG_A, mountPath: 'cam-a' }),
      camera({
        id: CAM_B,
        organizationId: ORG_B,
        mountPath: 'cam-b',
        encryptedSourceUrl: encryptString('rtsp://admin:otro@10.0.0.2/b'),
      }),
    ];
    repo = {
      findOne: jest.fn((options: { where: Where }) =>
        Promise.resolve(
          rows.find((row) => matchesWhere(row, options.where)) ?? null,
        ),
      ),
      save: jest.fn((entity: Camera) => Promise.resolve(entity)),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((data: Partial<Camera>) => ({ ...data }) as Camera),
    };
    tenantContext = createTenantContextDouble(CTX_A, [ORG_A, ORG_B]);
    mediamtx = {
      registerSource: jest.fn().mockResolvedValue(undefined),
      deregisterSource: jest.fn().mockResolvedValue(undefined),
    };
    workerNotifier = {
      registerCamera: jest.fn().mockResolvedValue(undefined),
      unregisterCamera: jest.fn().mockResolvedValue(undefined),
    };
    service = new CamerasService(
      repo as unknown as Repository<Camera>,
      createMockRepository<Role>() as unknown as Repository<Role>,
      tenantContext as unknown as TenantContextService,
      mediamtx as unknown as MediamtxService,
      undefined,
      workerNotifier as unknown as WorkerNotifierService,
    );
  });

  describe('POST /cameras: creación estricta (P5.C)', () => {
    const SOURCE = 'rtsp://admin:clave@10.0.0.9/stream';

    it('del actor: la cámara queda en SU condominio', async () => {
      await service.create({ name: 'Portón Norte', sourceUrl: SOURCE });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Portón Norte',
          organizationId: ORG_A,
        }),
      );
    });

    it('actor sin condominio -> 403 (no 500) sin guardar', async () => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: false,
      });

      await expect(
        service.create({ name: 'Portón', sourceUrl: SOURCE }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('actor que no es super-admin y envía organizationId -> 403', async () => {
      await expect(
        service.create({
          name: 'Portón',
          sourceUrl: SOURCE,
          organizationId: ORG_B,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('super-admin sin organizationId -> 400; con él -> la cámara queda en ese condominio', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      await expect(
        service.create({ name: 'Portón', sourceUrl: SOURCE }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();

      await service.create({
        name: 'Portón',
        sourceUrl: SOURCE,
        organizationId: ORG_B,
      });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_B }),
      );
      // `organizationId` no se copia por `Object.assign` del DTO: lo pone el servicio.
      const createdFrom = repo.create.mock.calls as Array<[Partial<Camera>]>;
      expect(createdFrom[createdFrom.length - 1][0]).not.toHaveProperty(
        'organizationId',
      );
    });
  });

  describe('GET /cameras/:id/source (credencial RTSP)', () => {
    it('cámara de otro condominio -> 404, sin devolver la URL', async () => {
      await expect(service.getDecryptedSourceUrl(CAM_B)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getDecryptedSourceUrl('cam-b')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cámara propia (por id o mountPath) -> URL descifrada', async () => {
      await expect(service.getDecryptedSourceUrl(CAM_A)).resolves.toBe(
        'rtsp://admin:secreto@10.0.0.1/a',
      );
      await expect(service.getDecryptedSourceUrl('cam-a')).resolves.toBe(
        'rtsp://admin:secreto@10.0.0.1/a',
      );
    });

    it('la búsqueda lleva el condominio del actor', async () => {
      await service.getDecryptedSourceUrl(CAM_A);

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CAM_A, organizationId: ORG_A },
        }),
      );
    });

    it('super-admin: cualquier condominio', async () => {
      tenantContext.getContext.mockResolvedValue(SUPER_ADMIN);

      await expect(service.getDecryptedSourceUrl(CAM_B)).resolves.toBe(
        'rtsp://admin:otro@10.0.0.2/b',
      );
    });
  });

  it('has-source de otro condominio -> 404', async () => {
    await expect(service.hasSource(CAM_B)).rejects.toThrow(NotFoundException);
    await expect(service.hasSource(CAM_A)).resolves.toBe(true);
  });

  it('PATCH /cameras/:id de otro condominio -> 404 sin guardar ni notificar', async () => {
    await expect(service.update(CAM_B, { location: 'Otra' })).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(workerNotifier.registerCamera).not.toHaveBeenCalled();
    expect(workerNotifier.unregisterCamera).not.toHaveBeenCalled();
  });

  it('PATCH /cameras/:id propia: guarda', async () => {
    await service.update(CAM_A, { location: 'Acceso norte' });

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: CAM_A, location: 'Acceso norte' }),
    );
  });

  describe('PATCH con sourceUrl nueva: relanza los workers (E10)', () => {
    const OLD = 'rtsp://admin:secreto@10.0.0.1/a';
    const NEW = 'rtsp://admin:secreto@10.0.0.1/a-hd';

    it('LPR y Guardián activos: da de baja y registra de nuevo ambos con la URL nueva', async () => {
      rows[0].enableLpr = true;
      rows[0].enableGuardian = true;

      await service.update(CAM_A, { sourceUrl: NEW });

      expect(workerNotifier.unregisterCamera).toHaveBeenCalledWith(CAM_A);
      expect(workerNotifier.unregisterCamera).toHaveBeenCalledWith(
        `${CAM_A}_guardia`,
      );
      expect(workerNotifier.registerCamera).toHaveBeenCalledWith(
        CAM_A,
        NEW,
        'cam-a',
      );
      expect(workerNotifier.registerCamera).toHaveBeenCalledWith(
        `${CAM_A}_guardia`,
        NEW,
        'cam-a',
        'guardia',
      );
      const unregisterOrder =
        workerNotifier.unregisterCamera.mock.invocationCallOrder;
      const registerOrder =
        workerNotifier.registerCamera.mock.invocationCallOrder;
      expect(unregisterOrder[0]).toBeLessThan(registerOrder[0]);
      expect(unregisterOrder[1]).toBeLessThan(registerOrder[1]);
    });

    it('solo LPR activo: no toca el worker del Guardián', async () => {
      rows[0].enableLpr = true;

      await service.update(CAM_A, { sourceUrl: NEW });

      expect(workerNotifier.unregisterCamera).toHaveBeenCalledTimes(2);
      // El segundo unregister es la baja habitual del Guardián apagado (ya existía).
      expect(workerNotifier.unregisterCamera).toHaveBeenLastCalledWith(
        `${CAM_A}_guardia`,
      );
      expect(workerNotifier.registerCamera).toHaveBeenCalledTimes(1);
    });

    it('la misma URL (o sin sourceUrl) no relanza ningún worker', async () => {
      rows[0].enableLpr = true;

      await service.update(CAM_A, { sourceUrl: OLD });
      await service.update(CAM_A, { location: 'Acceso norte' });

      // Solo el register habitual; ninguna baja previa de la cámara LPR.
      expect(workerNotifier.unregisterCamera).not.toHaveBeenCalledWith(CAM_A);
      expect(workerNotifier.registerCamera).toHaveBeenCalledTimes(2);
    });

    it('sin LPR ni Guardián: no registra nada con la URL nueva', async () => {
      await service.update(CAM_A, { sourceUrl: NEW });

      expect(workerNotifier.registerCamera).not.toHaveBeenCalled();
    });

    it('si el manager falla, el PATCH igual guarda y el log no incluye la URL', async () => {
      rows[0].enableLpr = true;
      workerNotifier.unregisterCamera.mockRejectedValue(
        new Error('manager caído'),
      );
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      await expect(
        service.update(CAM_A, { sourceUrl: NEW }),
      ).resolves.toBeDefined();

      expect(repo.save).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secreto');
      warn.mockRestore();
    });
  });

  it('DELETE /cameras/:id de otro condominio -> 404 sin borrar', async () => {
    await expect(service.remove(CAM_B)).rejects.toThrow(NotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
    expect(workerNotifier.unregisterCamera).not.toHaveBeenCalled();
  });

  it('DELETE /cameras/:id propia: borra ESA cámara', async () => {
    await service.remove(CAM_A);

    expect(repo.delete).toHaveBeenCalledWith(CAM_A);
  });

  it('DELETE /cameras/:id desregistra el worker LPR Y el del Guardián (`<id>_guardia`)', async () => {
    await service.remove(CAM_A);

    expect(workerNotifier.unregisterCamera).toHaveBeenCalledTimes(2);
    expect(workerNotifier.unregisterCamera).toHaveBeenCalledWith(CAM_A);
    expect(workerNotifier.unregisterCamera).toHaveBeenCalledWith(
      `${CAM_A}_guardia`,
    );
  });

  it('DELETE /cameras/:id: si falla desregistrar el LPR igual desregistra el Guardián y borra (best-effort)', async () => {
    workerNotifier.unregisterCamera.mockImplementation((id: string) =>
      id === CAM_A
        ? Promise.reject(new Error('worker manager caído'))
        : Promise.resolve(undefined),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.remove(CAM_A)).resolves.toEqual({
      message: 'Cámara eliminada',
    });

    expect(workerNotifier.unregisterCamera).toHaveBeenCalledWith(
      `${CAM_A}_guardia`,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('DELETE /cameras/:id: si falla desregistrar el Guardián la cámara se borra igual', async () => {
    workerNotifier.unregisterCamera.mockImplementation((id: string) =>
      id.endsWith('_guardia')
        ? Promise.reject(new Error('worker manager caído'))
        : Promise.resolve(undefined),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.remove(CAM_A)).resolves.toBeDefined();

    expect(repo.delete).toHaveBeenCalledWith(CAM_A);
    warn.mockRestore();
  });

  it('POST /cameras/:id/register de otro condominio -> 404 sin registrar en MediaMTX', async () => {
    await expect(service.registerInMediamtx(CAM_B)).rejects.toThrow(
      NotFoundException,
    );
    expect(mediamtx.registerSource).not.toHaveBeenCalled();
  });

  it('enable-lpr / enable-guardian / zones de otro condominio -> 404 sin guardar', async () => {
    await expect(service.updateLprStatus(CAM_B, true)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.updateGuardianStatus(CAM_B, true)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.updateGuardianZones(CAM_B, [])).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(workerNotifier.registerCamera).not.toHaveBeenCalled();
  });

  it('zones propias (Fase 4 · P9): guarda JSON plano con solo x e y', async () => {
    // Un punto que no es un objeto plano (como una instancia del DTO).
    const point = Object.create({ heredado: 1 }) as { x: number; y: number };
    point.x = 0.1;
    point.y = 0.2;

    // Formato legacy ([[{x,y}]]): se guarda normalizado a `intrusion`.
    const result = await service.updateGuardianZones(CAM_A, [
      [point, { x: 0.9, y: 0.2 }, { x: 0.5, y: 0.8 }],
    ]);

    const saved = (repo.save.mock.calls[0] as [Camera])[0];
    expect(saved.id).toBe(CAM_A);
    expect(saved.guardianZones).toEqual([
      {
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.2 },
          { x: 0.5, y: 0.8 },
        ],
        type: 'intrusion',
      },
    ]);
    expect(Object.getPrototypeOf(saved.guardianZones?.[0].points[0])).toBe(
      Object.prototype,
    );
    expect(result).toEqual({
      id: CAM_A,
      name: 'Cámara',
      guardianZones: saved.guardianZones,
    });
  });

  it('zones en formato nuevo: conserva type y loiterSeconds, solo x/y en los puntos', async () => {
    await service.updateGuardianZones(CAM_A, [
      {
        points: [
          { x: 0.1, y: 0.2, extra: 1 },
          { x: 0.9, y: 0.2 },
          { x: 0.5, y: 0.8 },
        ],
        type: 'loitering',
        loiterSeconds: 45,
      },
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
    ]);

    const saved = (repo.save.mock.calls[0] as [Camera])[0];
    expect(saved.guardianZones).toEqual([
      {
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.9, y: 0.2 },
          { x: 0.5, y: 0.8 },
        ],
        type: 'loitering',
        loiterSeconds: 45,
      },
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        type: 'intrusion',
      },
    ]);
  });

  describe('lprSettings (plan LPR por cámara, F2)', () => {
    const SETTINGS = {
      action: 'register',
      direction: 'both',
      detectorImgsz: 1920,
      sampleFps: 8,
    } as const;

    it('updateLprSettings: guarda en SU cámara, devuelve lo guardado y NO toca al worker manager ni a MediaMTX', async () => {
      const result = await service.updateLprSettings(
        CAM_A,
        Object.assign(new UpdateLprSettingsDto(), SETTINGS),
      );

      const saved = (repo.save.mock.calls[0] as [Camera])[0];
      expect(saved.id).toBe(CAM_A);
      expect(saved.lprSettings).toEqual(SETTINGS);
      expect(result).toEqual({
        id: CAM_A,
        name: 'Cámara',
        enableLpr: false,
        lprSettings: SETTINGS,
      });
      expect(workerNotifier.registerCamera).not.toHaveBeenCalled();
      expect(workerNotifier.unregisterCamera).not.toHaveBeenCalled();
      expect(mediamtx.registerSource).not.toHaveBeenCalled();
    });

    it('directionLine: se guarda tal cual y el worker la lee en GET lpr-settings', async () => {
      const directionLine = {
        from: { x: 0.2, y: 0.7 },
        to: { x: 0.85, y: 0.75 },
        exitSide: 'left',
      } as const;

      await service.updateLprSettings(
        CAM_A,
        Object.assign(new UpdateLprSettingsDto(), {
          action: 'register',
          directionLine,
        }),
      );

      const saved = (repo.save.mock.calls[0] as [Camera])[0];
      expect(saved.lprSettings).toEqual({ action: 'register', directionLine });
      await expect(
        service.getLprSettingsForOrganization(CAM_A, ORG_A),
      ).resolves.toMatchObject({
        cameraId: CAM_A,
        lprSettings: { action: 'register', directionLine },
      });
    });

    it('updateLprSettings con {} resetea a null', async () => {
      rows[0].lprSettings = { ...SETTINGS };

      const result = await service.updateLprSettings(
        CAM_A,
        new UpdateLprSettingsDto(),
      );

      expect((repo.save.mock.calls[0] as [Camera])[0].lprSettings).toBeNull();
      expect(result.lprSettings).toBeNull();
    });

    it('cámara de otro condominio -> 404 sin guardar (update y get)', async () => {
      await expect(
        service.updateLprSettings(CAM_B, new UpdateLprSettingsDto()),
      ).rejects.toThrow(NotFoundException);
      await expect(service.getLprSettings(CAM_B)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('getLprSettings: devuelve la configuración (null si no hay) sin la URL de origen', async () => {
      const empty = await service.getLprSettings(CAM_A);
      expect(empty).toEqual({
        id: CAM_A,
        name: 'Cámara',
        enableLpr: false,
        lprSettings: null,
      });

      rows[0].lprSettings = { ...SETTINGS };
      const set = await service.getLprSettings(CAM_A);
      expect(set.lprSettings).toEqual(SETTINGS);
      expect(JSON.stringify(set)).not.toContain('rtsp');
    });

    it('getLprSettingsForOrganization: contrato exacto y 404 para otra organización', async () => {
      rows[0].lprSettings = { ...SETTINGS };
      rows[0].enableLpr = true;

      await expect(
        service.getLprSettingsForOrganization('cam-a', ORG_A),
      ).resolves.toEqual({
        cameraId: CAM_A,
        enableLpr: true,
        lprSettings: SETTINGS,
      });
      await expect(
        service.getLprSettingsForOrganization(CAM_A, ORG_B),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getLprSettingsForOrganization(CAM_B, ORG_A),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('enable-lpr propia: guarda y notifica al worker con la URL de ESA cámara', async () => {
    await service.updateLprStatus(CAM_A, true);

    expect(workerNotifier.registerCamera).toHaveBeenCalledWith(
      CAM_A,
      'rtsp://admin:secreto@10.0.0.1/a',
      'cam-a',
    );
  });

  describe('getMountPath (WHEP)', () => {
    it('resuelve por id el mountPath de la cámara propia', async () => {
      await expect(service.getMountPath(CAM_A)).resolves.toBe('cam-a');
    });

    it('cámara de otro condominio o inexistente -> 404 (ya no cae al string crudo)', async () => {
      await expect(service.getMountPath('cam-b')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getMountPath('cualquier/path')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('variantes internas sin actor: getDecryptedSourceUrlForOrganization usa el condominio EXPLÍCITO', async () => {
    await expect(
      service.getDecryptedSourceUrlForOrganization(CAM_B, ORG_A),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getDecryptedSourceUrlForOrganization(CAM_B, ORG_B),
    ).resolves.toBe('rtsp://admin:otro@10.0.0.2/b');
    expect(tenantContext.getContext).not.toHaveBeenCalled();
  });
});
