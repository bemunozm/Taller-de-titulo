import type { Repository } from 'typeorm';
import { DetectionsService } from './detections.service';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { HubGateway } from '../hub/hub.gateway';
import { VisitsService } from '../visits/visits.service';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import type { Notification } from '../notifications/entities/notification.entity';

/**
 * Cierre de fases 1-2 (follow-up post-auditoría) — FIX 2: leak de
 * notificación cross-tenant en detecciones. Dos call-sites compartían el
 * mismo defecto — `notifyByRole('Conserje', ...)` ignora la organización, así
 * que un conserje de CUALQUIER condominio recibía notificaciones de
 * detecciones de cualquier otro:
 *  - `createPendingDetectionForConcierge` (detección PENDIENTE, requiere
 *    aprobación del conserje).
 *  - `sendDetectionNotifications` (detección normal permitida/denegada,
 *    entrada/salida — se dispara en CADA detección de patente).
 * Ambos se corrigieron usando `notifyByRoleForOrganization`, que filtra por
 * la organización de la detección (derivada de la cámara). Para cámaras
 * legacy sin `organizationId` (pre-tarea #19), `sendDetectionNotifications`
 * opta por fail-closed: no notifica a ningún conserje en vez de arriesgar un
 * match cross-tenant (ver su docstring).
 *
 * Se instancia `DetectionsService` directamente con mocks planos (sin
 * `Test.createTestingModule`) para evitar levantar el resto del grafo de
 * dependencias (VisitsService es circular vía forwardRef y no se ejercita en
 * esta rama del flujo).
 */
describe('DetectionsService — notificación de detección pendiente scopeada por tenant', () => {
  let service: DetectionsService;
  let detectionsRepo: jest.Mocked<Pick<Repository<PlateDetection>, 'create' | 'save'>>;
  let attemptsRepo: jest.Mocked<Pick<Repository<AccessAttempt>, 'create' | 'save'>>;
  let cameraRepository: jest.Mocked<Pick<Repository<Camera>, 'findOne'>>;
  let vehiclesService: jest.Mocked<Pick<VehiclesService, 'findByPlate'>>;
  let notificationsService: jest.Mocked<
    Pick<NotificationsService, 'notifyByRole' | 'notifyByRoleForOrganization'>
  >;
  let usersService: jest.Mocked<Pick<UsersService, 'findOne'>>;
  let hubGateway: jest.Mocked<Pick<HubGateway, 'sendToOrganization'>>;
  let visitsService: Pick<VisitsService, never>;

  const CAMERA_ID = '11111111-1111-1111-1111-111111111111';
  const CAMERA_ORG_ID = 'org-camera-tenant';

  const baseDto: CreatePlateDetectionDto = {
    cameraId: CAMERA_ID,
    plate: 'ABCD12',
  };

  beforeEach(() => {
    detectionsRepo = {
      create: jest.fn((dto) => ({ ...dto }) as unknown as PlateDetection),
      save: jest.fn(async (entity) => ({
        id: 'detection-1',
        createdAt: new Date(),
        ...entity,
      }) as unknown as PlateDetection),
    };
    attemptsRepo = {
      create: jest.fn((dto) => ({ ...dto }) as unknown as AccessAttempt),
      save: jest.fn(async (entity) => ({ id: 'attempt-1', ...entity }) as unknown as AccessAttempt),
    };
    cameraRepository = {
      findOne: jest.fn().mockResolvedValue({ id: CAMERA_ID, organizationId: CAMERA_ORG_ID } as Camera),
    };
    vehiclesService = { findByPlate: jest.fn() };
    notificationsService = {
      notifyByRole: jest.fn().mockResolvedValue([]),
      notifyByRoleForOrganization: jest.fn().mockResolvedValue([{ id: 'notif-1' } as Notification]),
    };
    usersService = { findOne: jest.fn() };
    hubGateway = { sendToOrganization: jest.fn() };
    visitsService = {};

    service = new DetectionsService(
      detectionsRepo as unknown as Repository<PlateDetection>,
      attemptsRepo as unknown as Repository<AccessAttempt>,
      cameraRepository as unknown as Repository<Camera>,
      vehiclesService as unknown as VehiclesService,
      notificationsService as unknown as NotificationsService,
      usersService as unknown as UsersService,
      hubGateway as HubGateway,
      visitsService as VisitsService,
    );
  });

  it('notifica la detección pendiente vía notifyByRoleForOrganization, scopeada al tenant de la cámara', async () => {
    // Vehículo existe pero inactivo -> rama que llama a
    // createPendingDetectionForConcierge directamente (detections.service.ts).
    vehiclesService.findByPlate.mockResolvedValue({
      id: 'vehicle-1',
      active: false,
      vehicleType: 'residente',
      accessLevel: 'permanente',
      owner: null,
    } as unknown as Vehicle);

    await service.createDetection(baseDto);

    expect(notificationsService.notifyByRoleForOrganization).toHaveBeenCalledWith(
      'Conserje',
      CAMERA_ORG_ID,
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        data: expect.objectContaining({ plate: 'ABCD12', requiresAction: true }),
      }),
    );
    // El leak cross-tenant (fix): la notificación de detección PENDIENTE nunca
    // debe pasar por `notifyByRole`, que ignora la organización.
    expect(notificationsService.notifyByRole).not.toHaveBeenCalled();
  });

  it('propaga organizationId=null cuando la cámara no tiene condominio asignado (legacy pre-#19)', async () => {
    cameraRepository.findOne.mockResolvedValue(null);
    vehiclesService.findByPlate.mockResolvedValue({
      id: 'vehicle-1',
      active: false,
      vehicleType: 'residente',
      accessLevel: 'permanente',
      owner: null,
    } as unknown as Vehicle);

    await service.createDetection(baseDto);

    expect(notificationsService.notifyByRoleForOrganization).toHaveBeenCalledWith(
      'Conserje',
      null,
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
  });

  describe('sendDetectionNotifications (detección normal, no pendiente)', () => {
    it('notifica a los conserjes vía notifyByRoleForOrganization, scopeada al tenant de la cámara', async () => {
      // Vehículo residente activo -> decisión "Permitido" sin pasar por
      // visitsService, llega directo a sendDetectionNotifications.
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        active: true,
        vehicleType: 'residente',
        accessLevel: 'permanente',
        owner: null,
      } as unknown as Vehicle);

      await service.createDetection(baseDto);

      expect(notificationsService.notifyByRoleForOrganization).toHaveBeenCalledWith(
        'Conserje',
        CAMERA_ORG_ID,
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.anything(),
      );
      expect(notificationsService.notifyByRole).not.toHaveBeenCalled();
    });

    it('fail-closed: no notifica a ningún conserje cuando la cámara no tiene organizationId (legacy pre-#19)', async () => {
      cameraRepository.findOne.mockResolvedValue(null);
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        active: true,
        vehicleType: 'residente',
        accessLevel: 'permanente',
        owner: null,
      } as unknown as Vehicle);

      await service.createDetection(baseDto);

      expect(notificationsService.notifyByRoleForOrganization).not.toHaveBeenCalled();
      expect(notificationsService.notifyByRole).not.toHaveBeenCalled();
    });
  });
});
