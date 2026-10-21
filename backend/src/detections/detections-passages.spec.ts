import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import { DetectionsService } from './detections.service';
import type { PlateDetection } from './entities/plate-detection.entity';
import type { AccessAttempt } from './entities/access-attempt.entity';
import type { VehiclePassage } from './entities/vehicle-passage.entity';
import type { Camera } from '../cameras/entities/camera.entity';
import type { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import type { VehiclesService } from '../vehicles/vehicles.service';
import type { VisitsService } from '../visits/visits.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { UsersService } from '../users/users.service';
import type { HubGateway } from '../hub/hub.gateway';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import type { Visit } from '../visits/entities/visit.entity';
import { VisitStatus } from '../visits/entities/visit.entity';
import {
  asPassagesService,
  createPassagesDouble,
  type PassagesDouble,
} from '../test-utils/passages.double';

/**
 * Orquestación de las pasadas en `createDetection` (plan E6) con el servicio
 * de pasadas doblado: aquí se prueba QUÉ hace `DetectionsService` con cada
 * resultado del reclamo. El lock, el SQL y la concurrencia real se prueban
 * contra Postgres en `vehicle-passages.integration.spec.ts` y en el e2e.
 */
describe('DetectionsService — pasadas', () => {
  const ORG = 'org-pasadas';
  const CAMERA_ID = '11111111-1111-1111-1111-111111111111';
  const LINE = {
    from: { x: 0.1, y: 0.5 },
    to: { x: 0.9, y: 0.5 },
    exitSide: 'left',
  } as const;
  const noConfig = { get: () => undefined } as unknown as ConfigService;

  let passages: PassagesDouble;
  let attemptsRepo: { create: jest.Mock; save: jest.Mock };
  let detectionsRepo: { create: jest.Mock; save: jest.Mock };
  let cameraRepository: { findOne: jest.Mock };
  let vehiclesService: { findByPlate: jest.Mock };
  let notifications: {
    notifyByRoleForOrganization: jest.Mock;
    create: jest.Mock;
  };
  let hub: { sendDoorOpen: jest.Mock };
  let visits: {
    validateAccess: jest.Mock;
    checkIn: jest.Mock;
    checkOut: jest.Mock;
  };
  let service: DetectionsService;
  let camera: Partial<Camera>;

  const residentVehicle = {
    id: 'veh-1',
    active: true,
    accessLevel: 'residente',
    ownerId: 'owner-1',
    owner: { id: 'owner-1', name: 'Residente' },
  } as unknown as Vehicle;

  function dto(
    meta?: CreatePlateDetectionDto['meta'],
  ): CreatePlateDetectionDto {
    return { cameraId: CAMERA_ID, plate: 'ab-cd12', meta };
  }

  beforeEach(() => {
    camera = { id: CAMERA_ID, organizationId: ORG, lprSettings: null };
    detectionsRepo = {
      create: jest.fn((value: object) => ({ ...value })),
      save: jest.fn((value: object) =>
        Promise.resolve({ id: 'det-1', createdAt: new Date(), ...value }),
      ),
    };
    attemptsRepo = {
      create: jest.fn((value: object) => ({ ...value })),
      save: jest.fn((value: object) =>
        Promise.resolve({ id: 'att-1', ...value }),
      ),
    };
    cameraRepository = { findOne: jest.fn(() => Promise.resolve(camera)) };
    vehiclesService = {
      findByPlate: jest.fn().mockResolvedValue(residentVehicle),
    };
    notifications = {
      notifyByRoleForOrganization: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    };
    hub = { sendDoorOpen: jest.fn().mockReturnValue(1) };
    visits = {
      validateAccess: jest
        .fn()
        .mockResolvedValue({ valid: false, message: 'no' }),
      checkIn: jest.fn(),
      checkOut: jest.fn(),
    };
    passages = createPassagesDouble({
      saveDetection: (d) => detectionsRepo.save(d) as Promise<PlateDetection>,
      saveAttempt: (a) => attemptsRepo.save(a) as Promise<AccessAttempt>,
    });
    service = new DetectionsService(
      detectionsRepo as unknown as Repository<PlateDetection>,
      attemptsRepo as unknown as Repository<AccessAttempt>,
      cameraRepository as unknown as Repository<Camera>,
      vehiclesService as unknown as VehiclesService,
      notifications as unknown as NotificationsService,
      {
        isActiveMemberOfOrganization: jest.fn().mockResolvedValue(true),
      } as unknown as UsersService,
      hub as unknown as HubGateway,
      visits as unknown as VisitsService,
      noConfig,
      asPassagesService(passages),
    );
  });

  describe('lectura que es evidencia de una pasada abierta', () => {
    beforeEach(() => {
      const passage = {
        id: 'passage-9',
        organizationId: ORG,
        plate: 'ABCD12',
        direction: 'entry',
        directionSource: 'line',
        firstSeenAt: new Date('2026-10-21T12:00:00Z'),
        lastSeenAt: new Date('2026-10-21T12:00:05Z'),
        sightingCount: 2,
        methodFollowsDirection: true,
      } as VehiclePassage;
      passages.claim.mockImplementation((detection) =>
        Promise.resolve({
          kind: 'sighting',
          detection: { ...detection, id: 'det-2' },
          passage,
          attempt: { id: 'att-1', decision: 'Permitido' } as AccessAttempt,
        }),
      );
    });

    it('retorna deduplicated con la pasada y el intento original', async () => {
      const result = await service.createDetection(dto(), ORG);

      expect(result).toMatchObject({
        deduplicated: true,
        attempt: { id: 'att-1' },
        passage: {
          id: 'passage-9',
          direction: 'entry',
          directionSource: 'line',
          sightingCount: 2,
        },
        detection: { id: 'det-2' },
      });
    });

    it('NO crea intento, NO notifica, NO abre, NO consulta vehículo ni visitas', async () => {
      await service.createDetection(dto(), ORG);

      expect(attemptsRepo.create).not.toHaveBeenCalled();
      expect(passages.saveAttempt).not.toHaveBeenCalled();
      expect(vehiclesService.findByPlate).not.toHaveBeenCalled();
      expect(visits.validateAccess).not.toHaveBeenCalled();
      expect(visits.checkIn).not.toHaveBeenCalled();
      expect(visits.checkOut).not.toHaveBeenCalled();
      expect(notifications.notifyByRoleForOrganization).not.toHaveBeenCalled();
      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
      expect(passages.release).not.toHaveBeenCalled();
    });

    it('en una cámara de solo registro tampoco crea otro intento', async () => {
      camera.lprSettings = { action: 'register' };

      await service.createDetection(dto(), ORG);

      expect(attemptsRepo.create).not.toHaveBeenCalled();
      expect(passages.saveAttempt).not.toHaveBeenCalled();
    });
  });

  describe('reclamo de la pasada', () => {
    it('se hace ANTES de cualquier efecto, con la patente normalizada y la dirección de la lectura', async () => {
      camera.lprSettings = { directionLine: LINE };
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'line' }),
        ORG,
      );

      expect(passages.claim).toHaveBeenCalledTimes(1);
      const [detection, reading, access] = passages.claim.mock.calls[0];
      expect(access).toEqual({ decidesAccess: true });
      expect(detection).toMatchObject({ plate: 'ABCD12', organizationId: ORG });
      expect(reading).toEqual({ direction: 'exit', source: 'line' });
      expect(passages.claim.mock.invocationCallOrder[0]).toBeLessThan(
        vehiclesService.findByPlate.mock.invocationCallOrder[0],
      );
    });

    it('sin direction_source (worker anterior) la dirección conocida entra como la más débil', async () => {
      await service.createDetection(dto({ direction: 'entry' }), ORG);

      expect(passages.claim.mock.calls[0][1]).toEqual({
        direction: 'entry',
        source: 'width',
      });
    });

    it('sin meta la dirección es unknown / none', async () => {
      await service.createDetection(dto(), ORG);

      expect(passages.claim.mock.calls[0][1]).toEqual({
        direction: 'unknown',
        source: 'none',
      });
    });

    it('cámara de otro condominio: 403 y NO reclama ninguna pasada', async () => {
      camera.organizationId = 'otro';

      await expect(service.createDetection(dto(), ORG)).rejects.toThrow();
      expect(passages.claim).not.toHaveBeenCalled();
    });
  });

  describe('fuente de la dirección validada en el servidor', () => {
    const claimedReading = () => passages.claim.mock.calls[0][1];

    it('line sin directionLine en la cámara baja a width', async () => {
      camera.lprSettings = null;
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'line' }),
        ORG,
      );

      expect(claimedReading()).toEqual({ direction: 'exit', source: 'width' });
    });

    it('line con directionLine en la cámara se conserva', async () => {
      camera.lprSettings = { directionLine: LINE };
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'line' }),
        ORG,
      );

      expect(claimedReading()).toEqual({ direction: 'exit', source: 'line' });
    });

    it('camera solo vale si la cámara tiene ESA dirección fija', async () => {
      camera.lprSettings = { direction: 'entry' };
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'camera' }),
        ORG,
      );
      camera.lprSettings = { direction: 'exit' };
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'camera' }),
        ORG,
      );
      camera.lprSettings = { direction: 'both' };
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'camera' }),
        ORG,
      );

      expect(passages.claim.mock.calls.map((call) => call[1])).toEqual([
        { direction: 'exit', source: 'width' },
        { direction: 'exit', source: 'camera' },
        { direction: 'exit', source: 'width' },
      ]);
    });

    it('la detección guarda la fuente EFECTIVA y, aparte, lo que declaró el worker si difiere', async () => {
      camera.lprSettings = null;
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'line' }),
        ORG,
      );

      const [detection] = passages.claim.mock.calls[0];
      expect(detection.meta).toMatchObject({
        direction: 'exit',
        direction_source: 'width',
        direction_source_declared: 'line',
      });
    });

    it('si lo declarado coincide con lo verificado no se guarda direction_source_declared', async () => {
      camera.lprSettings = { directionLine: LINE };
      await service.createDetection(
        dto({ direction: 'exit', direction_source: 'line' }),
        ORG,
      );

      const [detection] = passages.claim.mock.calls[0];
      expect(detection.meta).toMatchObject({ direction_source: 'line' });
      expect(detection.meta).not.toHaveProperty('direction_source_declared');
    });

    it('un worker sin direction_source guarda width como efectiva, sin declarada', async () => {
      await service.createDetection(dto({ direction: 'entry' }), ORG);

      const [detection] = passages.claim.mock.calls[0];
      expect(detection.meta).toMatchObject({
        direction: 'entry',
        direction_source: 'width',
      });
      expect(detection.meta).not.toHaveProperty('direction_source_declared');
    });

    it('una dirección desconocida siempre es none', async () => {
      await service.createDetection(
        dto({ direction: 'unknown', direction_source: 'line' }),
        ORG,
      );

      expect(claimedReading()).toEqual({
        direction: 'unknown',
        source: 'none',
      });
    });
  });

  describe('rol de la cámara y promoción', () => {
    it('una cámara de solo registro reclama sin decidir el acceso', async () => {
      camera.lprSettings = { action: 'register' };
      await service.createDetection(dto(), ORG);

      expect(passages.claim.mock.calls[0][2]).toEqual({ decidesAccess: false });
    });

    it('una cámara de acceso reclama decidiendo el acceso', async () => {
      camera.lprSettings = { action: 'access' };
      await service.createDetection(dto(), ORG);

      expect(passages.claim.mock.calls[0][2]).toEqual({ decidesAccess: true });
    });

    function promote(): void {
      passages.claim.mockImplementation((detection, reading) =>
        Promise.resolve({
          kind: 'leader',
          promoted: true,
          detection: {
            ...detection,
            id: 'det-3',
            createdAt: new Date(),
          },
          passage: {
            id: 'passage-7',
            organizationId: ORG,
            plate: 'ABCD12',
            direction: reading.direction,
            directionSource: reading.source,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            sightingCount: 2,
            decidesAccess: true,
            methodFollowsDirection: false,
          } as VehiclePassage,
        }),
      );
    }

    it('una pasada promovida corre el flujo de acceso completo: abre y notifica tras guardar la decisión', async () => {
      promote();

      const result = await service.createDetection(dto(), ORG);

      expect(vehiclesService.findByPlate).toHaveBeenCalledTimes(1);
      expect(passages.saveAttempt).toHaveBeenCalledTimes(1);
      expect(passages.saveAttempt.mock.calls[0][2].decidesAccess).toBe(true);
      expect(hub.sendDoorOpen).toHaveBeenCalledTimes(1);
      expect(passages.saveAttempt.mock.invocationCallOrder[0]).toBeLessThan(
        hub.sendDoorOpen.mock.invocationCallOrder[0],
      );
      expect(result).toMatchObject({
        deduplicated: false,
        passage: { id: 'passage-7' },
      });
    });

    it('si la promoción falla se REVIERTE a solo registro (no se borra la pasada) y se relanza el error', async () => {
      promote();
      vehiclesService.findByPlate.mockRejectedValueOnce(new Error('BD caída'));

      await expect(service.createDetection(dto(), ORG)).rejects.toThrow(
        'BD caída',
      );

      expect(passages.demote).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'passage-7' }),
      );
      expect(passages.release).not.toHaveBeenCalled();
      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
    });
  });

  describe('líder que perdió la pasada (saveAttempt written:false)', () => {
    const previo = { id: 'att-previo', decision: 'Permitido' } as AccessAttempt;

    beforeEach(() => {
      passages.saveAttempt.mockResolvedValue({
        written: false,
        attempt: previo,
      });
    });

    it('acceso (residente): NO abre, NO notifica y responde como evidencia con el intento vigente', async () => {
      const result = await service.createDetection(dto(), ORG);

      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
      expect(notifications.notifyByRoleForOrganization).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        deduplicated: true,
        attempt: previo,
        passage: { id: 'passage-1' },
      });
      expect(passages.release).not.toHaveBeenCalled();
    });

    it('conserje: NO crea la notificación pendiente', async () => {
      vehiclesService.findByPlate.mockResolvedValue(null);

      const result = await service.createDetection(dto(), ORG);

      expect(notifications.notifyByRoleForOrganization).not.toHaveBeenCalled();
      expect(result).toMatchObject({ deduplicated: true, attempt: previo });
      expect(result).not.toHaveProperty('requiresApproval');
    });

    it('solo registro: responde como evidencia', async () => {
      camera.lprSettings = { action: 'register' };

      const result = await service.createDetection(dto(), ORG);

      expect(result).toMatchObject({ deduplicated: true, attempt: previo });
      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('sin intento aún (el nuevo líder no ha guardado): attempt null', async () => {
      passages.saveAttempt.mockResolvedValue({ written: false, attempt: null });

      const result = await service.createDetection(dto(), ORG);

      expect(result).toMatchObject({ deduplicated: true, attempt: null });
      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
    });
  });

  describe('líder de la pasada', () => {
    it('residente: intento enlazado a la pasada, método según su dirección, una apertura y respuesta con la pasada', async () => {
      camera.lprSettings = { direction: 'exit' };
      const result = await service.createDetection(
        dto({ direction: 'exit', direction_source: 'camera' }),
        ORG,
      );

      expect(passages.saveAttempt).toHaveBeenCalledTimes(1);
      const [attempt, passage, options] = passages.saveAttempt.mock.calls[0];
      expect(attempt).toMatchObject({
        decision: 'Permitido',
        method: 'Patente - Salida',
      });
      expect(passage.id).toBe('passage-1');
      expect(options).toEqual({
        decidesAccess: true,
        followsDirection: true,
        unknownMethod: 'Patente - Entrada',
      });
      expect(attempt.passageId).toBe('passage-1');
      expect(hub.sendDoorOpen).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        deduplicated: false,
        isExit: true,
        passage: {
          id: 'passage-1',
          direction: 'exit',
          directionSource: 'camera',
        },
      });
    });

    it('residente sin dirección: método Entrada (comportamiento previo)', async () => {
      await service.createDetection(dto(), ORG);

      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'Patente - Entrada' }),
      );
    });

    it('la apertura ocurre DESPUÉS de guardar el intento (si falla el guardado, no abre)', async () => {
      passages.saveAttempt.mockRejectedValueOnce(new Error('commit falló'));

      await expect(service.createDetection(dto(), ORG)).rejects.toThrow(
        'commit falló',
      );

      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
      expect(passages.release).toHaveBeenCalledTimes(1);
    });

    it('si la decisión falla antes del intento, libera la pasada y relanza el error', async () => {
      vehiclesService.findByPlate.mockRejectedValueOnce(new Error('BD caída'));

      await expect(service.createDetection(dto(), ORG)).rejects.toThrow(
        'BD caída',
      );

      expect(passages.release).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'passage-1' }),
      );
      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('en el camino feliz NO libera la pasada', async () => {
      await service.createDetection(dto(), ORG);

      expect(passages.release).not.toHaveBeenCalled();
    });

    it('cámara de solo registro: un único intento Registrado, método por dirección de la pasada, sin abrir ni consultar', async () => {
      camera.lprSettings = { action: 'register', directionLine: LINE };

      const result = await service.createDetection(
        dto({ direction: 'entry', direction_source: 'line' }),
        ORG,
      );

      const [attempt, , options] = passages.saveAttempt.mock.calls[0];
      expect(attempt).toMatchObject({
        decision: 'Registrado',
        method: 'Patente - Entrada',
      });
      expect(options).toEqual({
        decidesAccess: false,
        followsDirection: true,
        unknownMethod: 'Patente - Registro',
      });
      expect(vehiclesService.findByPlate).not.toHaveBeenCalled();
      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        deduplicated: false,
        passage: { id: 'passage-1' },
      });
    });

    it('cámara de solo registro sin dirección: Patente - Registro', async () => {
      camera.lprSettings = { action: 'register' };

      await service.createDetection(dto(), ORG);

      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'Patente - Registro' }),
      );
    });

    it('conserje: un único Pendiente enlazado a la pasada, su método NO sigue la dirección', async () => {
      vehiclesService.findByPlate.mockResolvedValue(null);

      const result = await service.createDetection(
        dto({ direction: 'exit', direction_source: 'line' }),
        ORG,
      );

      expect(passages.saveAttempt).toHaveBeenCalledTimes(1);
      const [attempt, , options] = passages.saveAttempt.mock.calls[0];
      expect(attempt).toMatchObject({
        decision: 'Pendiente',
        method: 'Patente - Requiere Aprobación',
      });
      expect(options.followsDirection).toBe(false);
      expect(notifications.notifyByRoleForOrganization).toHaveBeenCalledTimes(
        1,
      );
      expect(hub.sendDoorOpen).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        requiresApproval: true,
        deduplicated: false,
        passage: { id: 'passage-1' },
      });
    });

    it('visita: el método sale del estado de la visita (check-in/out), no de la dirección de la pasada', async () => {
      vehiclesService.findByPlate.mockResolvedValue(null);
      const visit = {
        id: 'visit-1',
        status: VisitStatus.PENDING,
        visitorName: 'Visita',
        host: { id: 'host-1' },
        entryTime: null,
        exitTime: null,
      } as unknown as Visit;
      visits.validateAccess.mockResolvedValue({ valid: true, visit });
      visits.checkIn.mockResolvedValue(undefined);

      await service.createDetection(
        // La cámara "ve" una salida, pero la visita está PENDING: es un ingreso.
        dto({ direction: 'exit', direction_source: 'camera' }),
        ORG,
      );

      const [attempt, , options] = passages.saveAttempt.mock.calls[0];
      expect(attempt).toMatchObject({
        decision: 'Permitido',
        method: 'Patente - Entrada',
      });
      expect(options.followsDirection).toBe(false);
      expect(visits.checkIn).toHaveBeenCalledTimes(1);
    });
  });

  describe('listAttempts', () => {
    it('withPassages:false no consulta pasadas y deja passage en null', async () => {
      const rows = [{ id: 'att-1', passageId: 'passage-1' }] as AccessAttempt[];
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      (
        attemptsRepo as unknown as { createQueryBuilder: jest.Mock }
      ).createQueryBuilder = jest.fn(() => qb);

      const result = await service.listAttempts(
        10,
        { organizationId: ORG, isSuperAdmin: false },
        null,
        { withPassages: false },
      );

      expect(passages.attachPassages).not.toHaveBeenCalled();
      expect(result).toEqual([
        { id: 'att-1', passageId: 'passage-1', passage: null },
      ]);
    });

    it('expone la pasada de cada intento (attachPassages)', async () => {
      const rows = [{ id: 'att-1', passageId: 'passage-1' }] as AccessAttempt[];
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      attemptsRepo = {
        ...attemptsRepo,
        createQueryBuilder: jest.fn(() => qb),
      } as unknown as typeof attemptsRepo;
      service = new DetectionsService(
        detectionsRepo as unknown as Repository<PlateDetection>,
        attemptsRepo as unknown as Repository<AccessAttempt>,
        cameraRepository as unknown as Repository<Camera>,
        vehiclesService as unknown as VehiclesService,
        notifications as unknown as NotificationsService,
        {} as UsersService,
        hub as unknown as HubGateway,
        visits as unknown as VisitsService,
        noConfig,
        asPassagesService(passages),
      );
      passages.attachPassages.mockResolvedValue([
        { id: 'att-1', passageId: 'passage-1', passage: { id: 'passage-1' } },
      ] as unknown as AccessAttempt[]);

      const result = await service.listAttempts(50, {
        organizationId: ORG,
        isSuperAdmin: false,
      });

      expect(passages.attachPassages).toHaveBeenCalledWith(rows);
      expect(result).toEqual([
        { id: 'att-1', passageId: 'passage-1', passage: { id: 'passage-1' } },
      ]);
    });
  });
});
