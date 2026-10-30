import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FindOperator, Repository } from 'typeorm';
import { AnomaliesService } from './anomalies.service';
import { AnomaliesController } from './anomalies.controller';
import { ServiceApiKeyGuard } from '../auth/guards/service-api-key.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuthorizationGuard } from '../auth/guards/authorization.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { AUDITABLE_KEY } from '../audit/decorators/auditable.decorator';
import type { TenantActor } from '../common/tenant/tenant-actor';
import { handlerMetadata } from '../test-utils/handler-metadata';
import { AnomalyEvent } from './entities/anomaly-event.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { VisionAnalysisService } from './services/vision-analysis.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { User } from '../users/entities/user.entity';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const CAM_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANOMALY_ID = 'dddddddd-0000-4000-8000-00000000000d';

/**
 * Fase 4 · P5.B: `GET /anomalies` y `GET /anomalies/cameras/:id/zones` se
 * acotan al condominio de la API key de servicio. Antes el listado devolvía
 * las anomalías (con su snapshot) de todos los condominios y la ruta de
 * zonas no tenía ningún guard.
 */
describe('AnomaliesService — lecturas acotadas al condominio de la key (P5.B)', () => {
  const findAndCount = jest.fn();
  const anomalyFindOne = jest.fn();
  const update = jest.fn();
  const findOne = jest.fn();
  const sendToOrganizationSecurity = jest.fn();
  const userFindOne = jest.fn();
  let service: AnomaliesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AnomaliesService(
      {
        findAndCount,
        findOne: anomalyFindOne,
        update,
      } as unknown as Repository<AnomalyEvent>,
      { findOne } as unknown as Repository<Camera>,
      {} as VisionAnalysisService,
      { sendToOrganizationSecurity } as unknown as NotificationsGateway,
      { findOne: userFindOne } as unknown as Repository<User>,
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

  type FindArgs = {
    select: Record<string, boolean>;
    where: Record<string, unknown>;
    take: number;
    skip: number;
    order: Record<string, string>;
  };

  it('P5.C: GET /anomalies (sesión humana) -> solo las del condominio del actor, { items, total }', async () => {
    findAndCount.mockResolvedValue([[{ id: 'a' }], 7]);

    await expect(service.findAllForActor(actor({}))).resolves.toEqual({
      items: [{ id: 'a' }],
      total: 7,
    });

    expect(findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_A },
        take: 50,
        skip: 0,
      }),
    );
  });

  it('el listado NO selecciona la foto (snapshotJpegB64) pero sí los campos de revisión e IA', async () => {
    findAndCount.mockResolvedValue([[], 0]);

    await service.findAllForActor(actor({}));

    const [[options]] = findAndCount.mock.calls as Array<[FindArgs]>;
    expect(options.select).not.toHaveProperty('snapshotJpegB64');
    expect(options.select).toEqual(
      expect.objectContaining({
        id: true,
        status: true,
        aiStatus: true,
        aiFalsePositive: true,
        resolvedAt: true,
        resolutionNote: true,
      }),
    );
  });

  it('filtros status/type/cameraId se combinan con el condominio; paginación con tope de 100', async () => {
    findAndCount.mockResolvedValue([[], 0]);

    await service.findAllForActor(actor({}), {
      status: 'reviewed',
      type: 'loitering',
      cameraId: CAM_A,
      limit: 20,
      offset: 40,
    });
    await service.findAllForActor(actor({}), { limit: 5000 });

    const calls = findAndCount.mock.calls as Array<[FindArgs]>;
    expect(calls[0][0]).toEqual(
      expect.objectContaining({
        where: {
          status: 'reviewed',
          anomalyType: 'loitering',
          cameraId: CAM_A,
          organizationId: ORG_A,
        },
        take: 20,
        skip: 40,
        order: { timestamp: 'DESC', id: 'DESC' },
      }),
    );
    expect(calls[1][0].take).toBe(100);
  });

  it('P5.C: super-admin -> las de todos los condominios', async () => {
    findAndCount.mockResolvedValue([[], 0]);

    await service.findAllForActor(
      actor({ organizationId: null, isSuperAdmin: true }),
    );

    expect(findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('P5.C: actor sin condominio -> ninguna fila (In([]), sin el cajón nulo)', async () => {
    findAndCount.mockResolvedValue([[], 0]);

    await service.findAllForActor(actor({ organizationId: null }));

    const [[options]] = findAndCount.mock.calls as Array<
      [{ where: { organizationId: unknown } }]
    >;
    const where = options.where;
    expect(where.organizationId).toBeInstanceOf(FindOperator);
    expect((where.organizationId as FindOperator<string>).type).toBe('in');
  });

  it('P5.C: sin condominium.view-all (Residente con detections.read) -> página vacía, sin consultar', async () => {
    await expect(
      service.findAllForActor(
        actor({ permissionNames: new Set(['detections.read']) }),
      ),
    ).resolves.toEqual({ items: [], total: 0 });
    expect(findAndCount).not.toHaveBeenCalled();
  });

  describe('findOneForActor: resolvedByName', () => {
    it('devuelve el nombre de quien resolvió, o null si no hay resolvedById', async () => {
      anomalyFindOne
        .mockResolvedValueOnce({ id: ANOMALY_ID, resolvedById: 'u-9' })
        .mockResolvedValueOnce({ id: ANOMALY_ID, resolvedById: null });
      userFindOne.mockResolvedValue({ id: 'u-9', name: 'Beto' });

      await expect(
        service.findOneForActor(ANOMALY_ID, actor({})),
      ).resolves.toEqual(expect.objectContaining({ resolvedByName: 'Beto' }));
      await expect(
        service.findOneForActor(ANOMALY_ID, actor({})),
      ).resolves.toEqual(expect.objectContaining({ resolvedByName: null }));
      expect(userFindOne).toHaveBeenCalledTimes(1);
    });

    it('usuario borrado -> null', async () => {
      anomalyFindOne.mockResolvedValue({ id: ANOMALY_ID, resolvedById: 'u-9' });
      userFindOne.mockResolvedValue(null);

      await expect(
        service.findOneForActor(ANOMALY_ID, actor({})),
      ).resolves.toEqual(expect.objectContaining({ resolvedByName: null }));
    });
  });

  describe('updateStatus (PATCH /anomalies/:id/status)', () => {
    const row = { id: ANOMALY_ID, organizationId: ORG_A, status: 'open' };

    it('revisada: guarda quién, cuándo y la nota (recortada); devuelve la fila sin foto', async () => {
      anomalyFindOne
        .mockResolvedValueOnce({ id: ANOMALY_ID, status: 'open' })
        .mockResolvedValueOnce({
          ...row,
          status: 'reviewed',
          resolvedById: 'admin-1',
          suspicionLevel: 'HIGH',
          aiReasoning: 'r',
          aiFalsePositive: false,
          aiStatus: 'done',
        });
      update.mockResolvedValue({ affected: 1 });
      userFindOne.mockResolvedValue({ id: 'admin-1', name: 'Ana Admin' });

      const result = await service.updateStatus(
        ANOMALY_ID,
        { status: 'reviewed', note: '  era el jardinero  ' },
        actor({ userId: 'admin-1' }),
      );

      expect(update).toHaveBeenCalledWith(
        { id: ANOMALY_ID, organizationId: ORG_A },
        {
          status: 'reviewed',
          resolvedById: 'admin-1',
          resolvedAt: expect.any(Date) as Date,
          resolutionNote: 'era el jardinero',
        },
      );
      expect(result.previousStatus).toBe('open');
      expect(result.anomaly).toEqual(
        expect.objectContaining({
          ...row,
          status: 'reviewed',
          resolvedByName: 'Ana Admin',
        }),
      );
      // Solo se pide el nombre del usuario (nada de email ni otros datos).
      expect(userFindOne).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        select: { id: true, name: true },
      });
      // Los demás clientes del condominio ven el cambio.
      expect(sendToOrganizationSecurity).toHaveBeenCalledWith(
        ORG_A,
        'security:anomaly_updated',
        {
          anomalyId: ANOMALY_ID,
          aiStatus: 'done',
          severity: 'HIGH',
          reasoning: 'r',
          aiFalsePositive: false,
          status: 'reviewed',
        },
      );
      // La relectura tampoco trae la foto.
      const lastCall = anomalyFindOne.mock.calls[1] as [FindArgs];
      expect(lastCall[0].select).not.toHaveProperty('snapshotJpegB64');
    });

    it.each(['dismissed', 'false_alarm'] as const)(
      '%s sin nota -> resolutionNote null',
      async (status) => {
        anomalyFindOne
          .mockResolvedValueOnce({ id: ANOMALY_ID })
          .mockResolvedValueOnce({ ...row, status });

        await service.updateStatus(ANOMALY_ID, { status }, actor({}));

        expect(update).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ status, resolutionNote: null }),
        );
      },
    );

    it('nota solo de espacios -> null', async () => {
      anomalyFindOne.mockResolvedValue({ id: ANOMALY_ID });

      await service.updateStatus(
        ANOMALY_ID,
        { status: 'dismissed', note: '   ' },
        actor({}),
      );

      expect(update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ resolutionNote: null }),
      );
    });

    it('volver a open limpia resolvedAt y resolvedById', async () => {
      anomalyFindOne.mockResolvedValue({ id: ANOMALY_ID });

      await service.updateStatus(ANOMALY_ID, { status: 'open' }, actor({}));

      expect(update).toHaveBeenCalledWith(expect.anything(), {
        status: 'open',
        resolvedById: null,
        resolvedAt: null,
        resolutionNote: null,
      });
    });

    it('anomalía ajena o inexistente -> 404 sin actualizar (la búsqueda va acotada al condominio)', async () => {
      anomalyFindOne.mockResolvedValue(null);

      await expect(
        service.updateStatus(ANOMALY_ID, { status: 'reviewed' }, actor({})),
      ).rejects.toThrow(NotFoundException);
      expect(anomalyFindOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ANOMALY_ID, organizationId: ORG_A },
        }),
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('sin condominium.view-all -> 404 sin consultar', async () => {
      await expect(
        service.updateStatus(
          ANOMALY_ID,
          { status: 'reviewed' },
          actor({ permissionNames: new Set(['anomalies.resolve']) }),
        ),
      ).rejects.toThrow(NotFoundException);
      expect(anomalyFindOne).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });
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
    const zones = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        type: 'loitering',
        loiterSeconds: 30,
      },
    ];
    findOne.mockResolvedValue({
      id: CAM_A,
      enableGuardian: true,
      guardianZones: zones,
    });

    await expect(service.getCameraZones('patio', ORG_A)).resolves.toEqual({
      id: CAM_A,
      enableGuardian: true,
      guardianZones: zones,
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

  it('PATCH /anomalies/:id/status: sesión humana, permiso anomalies.resolve y auditoría', () => {
    expect(
      handlerMetadata(
        AnomaliesController,
        'updateAnomalyStatus',
        GUARDS_METADATA,
      ),
    ).toEqual([AuthGuard, AuthorizationGuard]);
    expect(
      handlerMetadata(
        AnomaliesController,
        'updateAnomalyStatus',
        PERMISSIONS_KEY,
      ),
    ).toEqual(['anomalies.resolve']);
    expect(
      handlerMetadata(
        AnomaliesController,
        'updateAnomalyStatus',
        AUDITABLE_KEY,
      ),
    ).toEqual(
      expect.objectContaining({
        entityType: 'AnomalyEvent',
        captureRequest: false,
      }),
    );
  });

  it('POST /anomalies sigue con la API key de servicio (ingesta del worker)', () => {
    expect(
      handlerMetadata(AnomaliesController, 'handleAnomaly', GUARDS_METADATA),
    ).toEqual([ServiceApiKeyGuard]);
  });

  it('GET /anomalies pasa el actor; las zonas, el condominio de la key', async () => {
    const anomaliesService = {
      findAllForActor: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      updateStatus: jest.fn().mockResolvedValue({
        anomaly: { id: ANOMALY_ID, status: 'reviewed' },
        previousStatus: 'open',
      }),
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

    const auditReq: { auditNewValue?: unknown } = {};
    await controller.getAnomalies(actor, { status: 'open' });
    await controller.updateAnomalyStatus(
      ANOMALY_ID,
      { status: 'reviewed', note: 'ok' },
      actor,
      auditReq,
    );
    await controller.getCameraZones(req, CAM_B);

    // Auditoría: solo { status, previousStatus }, nunca la nota.
    expect(auditReq.auditNewValue).toEqual({
      status: 'reviewed',
      previousStatus: 'open',
    });

    expect(anomaliesService.findAllForActor).toHaveBeenCalledWith(actor, {
      status: 'open',
    });
    expect(anomaliesService.updateStatus).toHaveBeenCalledWith(
      ANOMALY_ID,
      { status: 'reviewed', note: 'ok' },
      actor,
    );
    expect(anomaliesService.getCameraZones).toHaveBeenCalledWith(CAM_B, ORG_A);
  });

  it('zonas sin condominio de key (handler sin guard) -> 403, fail-closed', async () => {
    const controller = new AnomaliesController({} as AnomaliesService);

    await expect(controller.getCameraZones({}, CAM_B)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
