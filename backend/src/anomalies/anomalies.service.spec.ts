import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FindOperator, Repository } from 'typeorm';
import { ANOMALY_HIGHLIGHT_EVENT, AnomaliesService } from './anomalies.service';
import { AnomaliesController } from './anomalies.controller';
import { ServiceApiKeyGuard } from '../auth/guards/service-api-key.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import type { TenantActor } from '../common/tenant/tenant-actor';
import { handlerMetadata } from '../test-utils/handler-metadata';
import { AnomalyEvent } from './entities/anomaly-event.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { VisionAnalysisService } from './services/vision-analysis.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('AnomaliesService.createAnomaly (A2: condominio de la API key)', () => {
  const create = jest.fn((data: Partial<AnomalyEvent>) => data);
  const save = jest.fn((data: Partial<AnomalyEvent>) =>
    Promise.resolve({ id: 'anomaly-1', timestamp: new Date(), ...data }),
  );
  const findOne = jest.fn();
  const analyzeAnomaly = jest.fn();
  const sendToOrganizationSecurity = jest.fn();
  let service: AnomaliesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnomaliesService(
      { create, save } as unknown as Repository<AnomalyEvent>,
      { findOne } as unknown as Repository<Camera>,
      { analyzeAnomaly } as unknown as VisionAnalysisService,
      { sendToOrganizationSecurity } as unknown as NotificationsGateway,
    );
  });

  function payload(cameraId: unknown) {
    return {
      cameraId,
      anomalyType: 'loitering',
      confidence: 0.9,
      meta: { snapshot_jpeg_b64: 'aGVsbG8=', duration_seconds: 30 },
    };
  }

  function expectNoSideEffects(): void {
    expect(analyzeAnomaly).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(sendToOrganizationSecurity).not.toHaveBeenCalled();
  }

  it('una key de A con una cámara de B -> 403 sin análisis, sin guardar y sin emitir', async () => {
    findOne.mockResolvedValue({ id: CAM_B, organizationId: ORG_B });

    await expect(
      service.createAnomaly(payload(`${CAM_B}_guardia`), ORG_A),
    ).rejects.toThrow(ForbiddenException);
    expect(findOne).toHaveBeenCalledWith({ where: { id: CAM_B } });
    expectNoSideEffects();
  });

  it('cámara inexistente -> 403 sin efectos', async () => {
    findOne.mockResolvedValue(null);

    await expect(
      service.createAnomaly(payload('patio-desconocido'), ORG_A),
    ).rejects.toThrow(ForbiddenException);
    expectNoSideEffects();
  });

  it('cámara legacy sin organizationId -> 403 sin efectos', async () => {
    findOne.mockResolvedValue({ id: CAM_A, organizationId: null });

    await expect(service.createAnomaly(payload(CAM_A), ORG_A)).rejects.toThrow(
      ForbiddenException,
    );
    expectNoSideEffects();
  });

  it.each([undefined, '', 42])(
    'cameraId inválido (%p) -> 400 sin consultar cámaras',
    async (cameraId) => {
      await expect(
        service.createAnomaly(payload(cameraId), ORG_A),
      ).rejects.toThrow(BadRequestException);
      expect(findOne).not.toHaveBeenCalled();
      expectNoSideEffects();
    },
  );

  it.each([
    ['sin anomalyType', { anomalyType: undefined }],
    ['confidence no numérica', { confidence: 'alta' }],
  ])('%s -> 400 sin consultar cámaras', async (_label, overrides) => {
    await expect(
      service.createAnomaly({ ...payload(CAM_A), ...overrides }, ORG_A),
    ).rejects.toThrow(BadRequestException);
    expect(findOne).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('cámara del condominio de la key -> guarda la anomalía con ese condominio', async () => {
    findOne.mockResolvedValue({ id: CAM_A, organizationId: ORG_A });
    analyzeAnomaly.mockResolvedValue({
      suspicionLevel: 'HIGH',
      reasoning: 'persona merodeando',
    });

    await service.createAnomaly(payload(`${CAM_A}_guardia`), ORG_A);

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ cameraId: CAM_A, organizationId: ORG_A }),
    );
    expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(1);
  });

  it('P6.R: security:anomaly_highlight SOLO al feed del condominio de la cámara, sin la foto', async () => {
    findOne.mockResolvedValue({
      id: CAM_A,
      name: 'Portón',
      mountPath: 'porton',
      organizationId: ORG_A,
    });
    analyzeAnomaly.mockResolvedValue({
      suspicionLevel: 'MEDIUM',
      reasoning: 'persona junto al portón',
    });

    // El worker identifica la cámara por mountPath: el evento lleva su UUID.
    await service.createAnomaly(payload('porton_guardia'), ORG_A);

    expect(sendToOrganizationSecurity).toHaveBeenCalledTimes(1);
    const [organizationId, event, highlight] = sendToOrganizationSecurity.mock
      .calls[0] as [string, string, Record<string, unknown>];
    expect(organizationId).toBe(ORG_A);
    expect(event).toBe(ANOMALY_HIGHLIGHT_EVENT);
    const { timestamp, ...fields } = highlight;
    expect(timestamp).toBeInstanceOf(Date);
    expect(fields).toEqual({
      anomalyId: 'anomaly-1',
      cameraId: CAM_A,
      cameraName: 'Portón',
      type: 'loitering',
      severity: 'MEDIUM',
      reasoning: 'persona junto al portón',
    });
    expect(JSON.stringify(highlight)).not.toContain('aGVsbG8=');
    // La foto sí queda guardada (se lee con GET /anomalies/:id).
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotJpegB64: 'aGVsbG8=' }),
    );
  });
});

/**
 * Fase 4 · P5.B: `GET /anomalies` y `GET /anomalies/cameras/:id/zones` se
 * acotan al condominio de la API key de servicio. Antes el listado devolvía
 * las anomalías (con su snapshot) de todos los condominios y la ruta de
 * zonas no tenía ningún guard.
 */
describe('AnomaliesService — lecturas acotadas al condominio de la key (P5.B)', () => {
  const find = jest.fn();
  const findOne = jest.fn();
  let service: AnomaliesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AnomaliesService(
      { find } as unknown as Repository<AnomalyEvent>,
      { findOne } as unknown as Repository<Camera>,
      {} as VisionAnalysisService,
      {} as NotificationsGateway,
    );
  });

  function actor(overrides: Partial<TenantActor>): TenantActor {
    return {
      userId: 'u-1',
      organizationId: ORG_A,
      isSuperAdmin: false,
      permissionNames: new Set(['detections.read', 'condominium.view-all']),
      familyId: null,
      ...overrides,
    };
  }

  it('P5.C: GET /anomalies (sesión humana) -> solo las del condominio del actor', async () => {
    find.mockResolvedValue([]);

    await service.findAllForActor(actor({}));

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG_A }, take: 100 }),
    );
  });

  it('P5.C: super-admin -> las de todos los condominios', async () => {
    find.mockResolvedValue([]);

    await service.findAllForActor(
      actor({ organizationId: null, isSuperAdmin: true }),
    );

    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('P5.C: actor sin condominio -> ninguna fila (In([]), sin el cajón nulo)', async () => {
    find.mockResolvedValue([]);

    await service.findAllForActor(actor({ organizationId: null }));

    const [[options]] = find.mock.calls as Array<
      [{ where: { organizationId: unknown } }]
    >;
    const where = options.where;
    expect(where.organizationId).toBeInstanceOf(FindOperator);
    expect((where.organizationId as FindOperator<string>).type).toBe('in');
  });

  it('P5.C: sin condominium.view-all (Residente con detections.read) -> vacío, sin consultar', async () => {
    await expect(
      service.findAllForActor(
        actor({ permissionNames: new Set(['detections.read']) }),
      ),
    ).resolves.toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('zonas de una cámara de OTRO condominio -> 404', async () => {
    findOne.mockResolvedValue(null);

    await expect(
      service.getCameraZones(`${CAM_B}_guardia`, ORG_A),
    ).rejects.toThrow(NotFoundException);
    expect(findOne).toHaveBeenCalledWith({
      where: [
        { id: CAM_B, organizationId: ORG_A },
        { mountPath: CAM_B, organizationId: ORG_A },
      ],
    });
  });

  it('zonas por mountPath: también acotadas al condominio de la key', async () => {
    findOne.mockResolvedValue({
      id: CAM_A,
      enableGuardian: true,
      guardianZones: [[{ x: 0, y: 0 }]],
    });

    await expect(service.getCameraZones('patio', ORG_A)).resolves.toEqual({
      id: CAM_A,
      enableGuardian: true,
      guardianZones: [[{ x: 0, y: 0 }]],
    });
    expect(findOne).toHaveBeenCalledWith({
      where: [{ mountPath: 'patio', organizationId: ORG_A }],
    });
  });
});

describe('AnomaliesController — credenciales (P5.B / P5.C)', () => {
  it('GET /anomalies/cameras/:id/zones exige la API key de servicio (el Guardián)', () => {
    expect(
      handlerMetadata(AnomaliesController, 'getCameraZones', GUARDS_METADATA),
    ).toEqual([ServiceApiKeyGuard]);
  });

  it('P5.C: GET /anomalies pasa a sesión humana (AuthGuard + AuthorizationGuard, detections.read)', () => {
    expect(
      handlerMetadata(AnomaliesController, 'getAnomalies', GUARDS_METADATA),
    ).toEqual([AuthGuard, AuthorizationGuard]);
    expect(
      handlerMetadata(AnomaliesController, 'getAnomalies', PERMISSIONS_KEY),
    ).toEqual(['detections.read']);
  });

  it('POST /anomalies sigue con la API key de servicio (ingesta del worker)', () => {
    expect(
      handlerMetadata(AnomaliesController, 'handleAnomaly', GUARDS_METADATA),
    ).toEqual([ServiceApiKeyGuard]);
  });

  it('GET /anomalies pasa el actor; las zonas, el condominio de la key', async () => {
    const anomaliesService = {
      findAllForActor: jest.fn().mockResolvedValue([]),
      getCameraZones: jest.fn().mockResolvedValue({}),
    };
    const controller = new AnomaliesController(
      anomaliesService as unknown as AnomaliesService,
    );
    const actor: TenantActor = {
      userId: 'u-1',
      organizationId: ORG_A,
      isSuperAdmin: false,
      permissionNames: new Set(['detections.read']),
      familyId: null,
    };
    const req = {
      serviceKey: { keyId: 'k', organizationId: ORG_A, ownerUserId: 'u' },
    };

    await controller.getAnomalies(actor);
    await controller.getCameraZones(req, CAM_B);

    expect(anomaliesService.findAllForActor).toHaveBeenCalledWith(actor);
    expect(anomaliesService.getCameraZones).toHaveBeenCalledWith(CAM_B, ORG_A);
  });

  it('zonas sin condominio de key (handler sin guard) -> 403, fail-closed', async () => {
    const controller = new AnomaliesController({} as AnomaliesService);

    await expect(controller.getCameraZones({}, CAM_B)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
