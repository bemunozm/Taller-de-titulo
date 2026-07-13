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
 * FIX 3 (esta rama): aislamiento cross-tenant en la APERTURA FÍSICA autónoma
 * del portón (no solo las notificaciones). `createDetection` buscaba
 * vehículo/visita con `skipTenantScope: true` (TODOS los condominios) — una
 * visita/vehículo pre-aprobado del condominio B podía abrir el portón físico
 * del condominio A si una cámara de A leía esa patente. Ahora esas búsquedas
 * se scopean explícitamente al `organizationId` de la CÁMARA (ver
 * `cameraOrganizationId` en `createDetection`, y el describe 'apertura
 * autónoma...' abajo). Además, se agregó un fail-closed temprano: si la
 * cámara no tiene `organizationId` (legacy), `createDetection` ni siquiera
 * consulta vehiclesService/visitsService — cae directo a
 * `createPendingDetectionForConcierge` (ver describe raíz y
 * 'sendDetectionNotifications' más abajo).
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

    await service.createDetection(baseDto);

    // Fix cross-tenant (feature/cierre-fases-1-2): sin organizationId de
    // cámara, createDetection es fail-closed y ni siquiera consulta
    // vehiclesService/visitsService — cae directo a aprobación del conserje.
    expect(vehiclesService.findByPlate).not.toHaveBeenCalled();
    expect(notificationsService.notifyByRoleForOrganization).toHaveBeenCalledWith(
      'Conserje',
      null,
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    );
  });

  describe('apertura autónoma por visita vehicular pre-aprobada (camino LPR sin citófono)', () => {
    // Este describe cubre el camino determinista descrito en
    // docs/modulos/agente-cerebro.md §7/§11: patente detectada por cámara +
    // visita vehicular vigente -> decision='Permitido' -> hubGateway.sendToOrganization
    // dirigido SIN pasar por Sofía/citófono. Usa su propia instancia de
    // DetectionsService (en vez del `visitsService = {}` del describe raíz)
    // porque estos casos SÍ ejercitan VisitsService.validateAccess/checkIn.
    let localVisitsService: jest.Mocked<Pick<VisitsService, 'validateAccess' | 'checkIn' | 'checkOut'>>;
    let localService: DetectionsService;

    const HOST_ID = 'host-1';
    const buildValidVisit = (overrides: Partial<{ id: string; status: string; visitorName: string }> = {}) => ({
      id: overrides.id ?? 'visit-1',
      status: overrides.status ?? 'pending',
      visitorName: overrides.visitorName ?? 'Visitante Pre-Aprobado',
      host: { id: HOST_ID },
    });

    beforeEach(() => {
      // Vehículo NO registrado en el sistema (rama `!vehicle` de
      // detections.service.ts:144) — es el caso típico de un visitante cuya
      // patente solo existe como parte de la visita, no como Vehicle propio.
      vehiclesService.findByPlate.mockResolvedValue(null as unknown as Vehicle);

      localVisitsService = {
        validateAccess: jest.fn(),
        checkIn: jest.fn(),
        checkOut: jest.fn(),
      };

      localService = new DetectionsService(
        detectionsRepo as unknown as Repository<PlateDetection>,
        attemptsRepo as unknown as Repository<AccessAttempt>,
        cameraRepository as unknown as Repository<Camera>,
        vehiclesService as unknown as VehiclesService,
        notificationsService as unknown as NotificationsService,
        usersService as unknown as UsersService,
        hubGateway as HubGateway,
        localVisitsService as unknown as VisitsService,
      );
    });

    it('visita vehicular pre-aprobada y vigente -> decision Permitido y hub:door_open dirigido al organizationId de la detección', async () => {
      const visit = buildValidVisit({ status: 'pending' });
      localVisitsService.validateAccess.mockResolvedValue({
        valid: true,
        visit: visit as any,
        message: 'ok',
      });
      localVisitsService.checkIn.mockResolvedValue(visit as any);

      await localService.createDetection(baseDto);

      // FIX cross-tenant: la visita se consulta scopeada al organizationId de
      // la CÁMARA (CAMERA_ORG_ID) — no un skipTenantScope global (ver
      // detections.service.ts:71-98/127-135). El worker LPR no tiene
      // request.user, pero SÍ conoce el tenant de la cámara.
      expect(localVisitsService.validateAccess).toHaveBeenCalledWith('ABCD12', 'plate', {
        organizationId: CAMERA_ORG_ID,
      });
      // Auto check-in de la visita (entrada), scopeado igual.
      expect(localVisitsService.checkIn).toHaveBeenCalledWith('visit-1', { organizationId: CAMERA_ORG_ID });

      // La decisión queda registrada como Permitido en el AccessAttempt.
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'Permitido', organizationId: CAMERA_ORG_ID }),
      );

      // Apertura física dirigida al condominio de la CÁMARA que detectó la
      // patente (nunca broadcast global — hallazgo H2, ver docstring en
      // detections.service.ts:219-228).
      expect(hubGateway.sendToOrganization).toHaveBeenCalledTimes(1);
      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(CAMERA_ORG_ID, 'hub:door_open', {
        type: 'vehicular',
        plate: 'ABCD12',
      });
    });

    it('reingreso (visita ready) también abre el portón y hace check-in nuevamente', async () => {
      const visit = buildValidVisit({ status: 'ready' });
      localVisitsService.validateAccess.mockResolvedValue({ valid: true, visit: visit as any, message: 'ok' });
      localVisitsService.checkIn.mockResolvedValue(visit as any);

      await localService.createDetection(baseDto);

      expect(localVisitsService.checkIn).toHaveBeenCalledWith('visit-1', { organizationId: CAMERA_ORG_ID });
      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(CAMERA_ORG_ID, 'hub:door_open', {
        type: 'vehicular',
        plate: 'ABCD12',
      });
    });

    it('visita activa (ya adentro) -> registra check-out (salida) y también abre el portón', async () => {
      const visit = buildValidVisit({ status: 'active' });
      localVisitsService.validateAccess.mockResolvedValue({ valid: true, visit: visit as any, message: 'ok' });
      localVisitsService.checkOut.mockResolvedValue(visit as any);

      const result = await localService.createDetection(baseDto);

      expect(localVisitsService.checkOut).toHaveBeenCalledWith('visit-1', { organizationId: CAMERA_ORG_ID });
      expect(localVisitsService.checkIn).not.toHaveBeenCalled();
      expect((result as { isExit: boolean }).isExit).toBe(true);
      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(CAMERA_ORG_ID, 'hub:door_open', {
        type: 'vehicular',
        plate: 'ABCD12',
      });
    });

    it('patente sin visita válida -> NO abre el portón, cae a aprobación del conserje (Pendiente)', async () => {
      localVisitsService.validateAccess.mockResolvedValue({
        valid: false,
        message: 'Patente no autorizada',
      });

      await localService.createDetection(baseDto);

      expect(localVisitsService.checkIn).not.toHaveBeenCalled();
      expect(localVisitsService.checkOut).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'Pendiente', organizationId: CAMERA_ORG_ID }),
      );
    });

    it('error al validar la visita -> NO abre el portón, cae a aprobación del conserje (fail-closed)', async () => {
      localVisitsService.validateAccess.mockRejectedValue(new Error('DB caída'));

      await localService.createDetection(baseDto);

      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'Pendiente', organizationId: CAMERA_ORG_ID }),
      );
    });

    // --- Aislamiento tenant (FIX cross-tenant, feature/cierre-fases-1-2) ---
    //
    // GAP ORIGINAL (ya corregido): DetectionsService no comparaba el
    // organizationId de la visita retornada por VisitsService contra el de la
    // cámara/detección — confiaba ciegamente en lo que devolviera
    // `validateAccess`, que a su vez buscaba con `skipTenantScope: true` (TODOS
    // los condominios). Una visita del condominio B podía abrir el portón
    // físico del condominio A.
    //
    // FIX: DetectionsService ahora pasa `{ organizationId: cameraOrganizationId }`
    // a `validateAccess`/`checkIn`/`checkOut` — la responsabilidad de excluir
    // visitas de OTRO condominio recae en `VisitsService.findByPlate`, que con
    // este scope explícito SÍ filtra por organizationId vía `applyTenantFilter`
    // (ver fix + tests reales de filtrado en visits.service.spec.ts, describe
    // 'findByPlate — aislamiento tenant'). Como aquí `VisitsService` está
    // mockeado (no ejecuta la query real), estos tests verifican el CONTRATO:
    // DetectionsService siempre pide el scope correcto (el de la cámara, NUNCA
    // el de la visita que el mock devuelva) — la responsabilidad de que ese
    // scope efectivamente excluya cross-tenant es de VisitsService (spec
    // separado, con aserciones sobre el SQL generado).
    it('[FIX] pasa SIEMPRE el organizationId de la CÁMARA a validateAccess, nunca el de la visita retornada por el mock', async () => {
      const visitDeOtroCondominio = {
        id: 'visit-de-otro-condominio',
        status: 'pending',
        visitorName: 'Visitante Condominio B',
        host: { id: 'host-de-otro-condominio' },
        organizationId: 'org-condominio-B', // <- distinto al de la cámara (CAMERA_ORG_ID)
      };
      localVisitsService.validateAccess.mockResolvedValue({
        valid: true,
        visit: visitDeOtroCondominio as any,
        message: 'ok',
      });
      localVisitsService.checkIn.mockResolvedValue(visitDeOtroCondominio as any);

      await localService.createDetection(baseDto);

      // El scope pedido es el de la CÁMARA (CAMERA_ORG_ID) — DetectionsService
      // no lee/confía en `visitDeOtroCondominio.organizationId` para nada.
      expect(localVisitsService.validateAccess).toHaveBeenCalledWith('ABCD12', 'plate', {
        organizationId: CAMERA_ORG_ID,
      });
      expect(localVisitsService.checkIn).toHaveBeenCalledWith('visit-de-otro-condominio', {
        organizationId: CAMERA_ORG_ID,
      });
      // La apertura sigue dirigida al condominio de la CÁMARA (nunca al de la
      // visita) — esto ya era correcto antes del fix y se preserva.
      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(CAMERA_ORG_ID, 'hub:door_open', {
        type: 'vehicular',
        plate: 'ABCD12',
      });
    });

    it('[FIX] patente de una visita del MISMO condominio que la cámara SÍ abre el portón', async () => {
      const visitDelMismoCondominio = {
        id: 'visit-mismo-condominio',
        status: 'pending',
        visitorName: 'Visitante Condominio A',
        host: { id: HOST_ID },
        organizationId: CAMERA_ORG_ID,
      };
      localVisitsService.validateAccess.mockResolvedValue({
        valid: true,
        visit: visitDelMismoCondominio as any,
        message: 'ok',
      });
      localVisitsService.checkIn.mockResolvedValue(visitDelMismoCondominio as any);

      await localService.createDetection(baseDto);

      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(CAMERA_ORG_ID, 'hub:door_open', {
        type: 'vehicular',
        plate: 'ABCD12',
      });
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'Permitido', organizationId: CAMERA_ORG_ID }),
      );
    });

    it('[FIX] patente de un vehículo/visita de OTRO condominio (B) NO abre en A — VisitsService (scopeado a A) no la encuentra', async () => {
      // Aquí VisitsService SÍ se comporta como lo haría el fix real: al
      // buscar scopeada al condominio de la cámara (A), una visita que
      // pertenece a B nunca aparece en el resultado -> validateAccess
      // devuelve inválido (ver el filtrado real en visits.service.spec.ts).
      localVisitsService.validateAccess.mockResolvedValue({
        valid: false,
        message: 'Patente no autorizada',
      });

      await localService.createDetection(baseDto);

      expect(localVisitsService.validateAccess).toHaveBeenCalledWith('ABCD12', 'plate', {
        organizationId: CAMERA_ORG_ID,
      });
      expect(localVisitsService.checkIn).not.toHaveBeenCalled();
      expect(localVisitsService.checkOut).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'Pendiente', organizationId: CAMERA_ORG_ID }),
      );
    });
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

    it('fail-closed (FIX cross-tenant): cámara sin organizationId no llega a esta rama ni siquiera con un vehículo residente activo matcheando la patente', async () => {
      // Antes del fix: una cámara legacy (sin organizationId) con un vehículo
      // residente activo llegaba hasta acá con decision='Permitido', y
      // `sendDetectionNotifications` recién ahí decidía no notificar (su
      // propio chequeo `organizationId === null`, más abajo en este archivo).
      // Ahora el fail-closed se aplica ANTES de siquiera consultar
      // vehiclesService (ver createDetection) — ni el vehículo activo importa,
      // la detección cae directo a aprobación manual del conserje.
      cameraRepository.findOne.mockResolvedValue(null);
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        active: true,
        vehicleType: 'residente',
        accessLevel: 'permanente',
        owner: null,
      } as unknown as Vehicle);

      await service.createDetection(baseDto);

      expect(vehiclesService.findByPlate).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ decision: 'Pendiente', organizationId: null }),
      );
      // `createPendingDetectionForConcierge` SÍ notifica a los conserjes con
      // organizationId=null (busca conserjes cuya propia membresía también
      // sea null — ver NotificationsService.notifyByRoleForOrganization) — a
      // diferencia del chequeo fail-closed propio de `sendDetectionNotifications`
      // (que aquí nunca se ejecuta, porque esta rama nunca llega a decidir
      // 'Permitido'/'Denegado').
      expect(notificationsService.notifyByRoleForOrganization).toHaveBeenCalledWith(
        'Conserje',
        null,
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.anything(),
      );
      expect(notificationsService.notifyByRole).not.toHaveBeenCalled();
    });
  });
});
