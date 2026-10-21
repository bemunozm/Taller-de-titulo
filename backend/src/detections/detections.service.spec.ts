import type { Repository } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import type { PersistenceRepositoryMock } from '../test-utils/mock-repository';
import { DetectionsService } from './detections.service';
import { PlateDetection } from './entities/plate-detection.entity';
import { AccessAttempt } from './entities/access-attempt.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { CreatePlateDetectionDto } from './dto/create-plate-detection.dto';
import { VehiclesService } from '../vehicles/vehicles.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import type { User } from '../users/entities/user.entity';
import { HubGateway } from '../hub/hub.gateway';
import { VisitsService } from '../visits/visits.service';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import type { Notification } from '../notifications/entities/notification.entity';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { VisitEntryAlreadyRegisteredException } from '../visits/visit-entry-already-registered.exception';
import { VisitExitAlreadyRegisteredException } from '../visits/visit-exit-already-registered.exception';
import { Visit, VisitStatus, VisitType } from '../visits/entities/visit.entity';
import type { FamiliesService } from '../families/families.service';
import type { TenantContextService } from '../common/tenant/tenant-context.service';

/** Sin VISIT_EXIT_COOLDOWN_MINUTES: la espera post-ingreso usa el default (5 min). */
const noConfig = { get: () => undefined } as unknown as ConfigService;

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
 * autónoma...' abajo).
 *
 * A2 (Fase 4 · P2): `createDetection`/`createAttempt` reciben el condominio
 * de la API key de servicio. La cámara (o la detección) debe ser de ese
 * condominio ANTES de cualquier efecto; si no, 403/404 y nada más (ver
 * describe 'A2'). Una cámara legacy sin `organizationId` también se rechaza.
 *
 * Se instancia `DetectionsService` directamente con mocks planos (sin
 * `Test.createTestingModule`) para evitar levantar el resto del grafo de
 * dependencias (VisitsService es circular vía forwardRef y no se ejercita en
 * esta rama del flujo).
 */
describe('DetectionsService — notificación de detección pendiente scopeada por tenant', () => {
  let service: DetectionsService;
  let detectionsRepo: Pick<
    PersistenceRepositoryMock<PlateDetection>,
    'create' | 'save'
  >;
  let attemptsRepo: Pick<
    PersistenceRepositoryMock<AccessAttempt>,
    'create' | 'save'
  >;
  let cameraRepository: jest.Mocked<Pick<Repository<Camera>, 'findOne'>>;
  let vehiclesService: jest.Mocked<Pick<VehiclesService, 'findByPlate'>>;
  let notificationsService: jest.Mocked<
    Pick<NotificationsService, 'notifyByRoleForOrganization'>
  >;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findOne' | 'isActiveMemberOfOrganization'>
  >;
  let hubGateway: jest.Mocked<Pick<HubGateway, 'sendDoorOpen'>>;
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
      save: jest.fn((entity) =>
        Promise.resolve({
          id: 'detection-1',
          createdAt: new Date(),
          ...entity,
        } as unknown as PlateDetection),
      ),
    };
    attemptsRepo = {
      create: jest.fn((dto) => ({ ...dto }) as unknown as AccessAttempt),
      save: jest.fn((entity) =>
        Promise.resolve({
          id: 'attempt-1',
          ...entity,
        } as unknown as AccessAttempt),
      ),
    };
    cameraRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: CAMERA_ID,
        organizationId: CAMERA_ORG_ID,
      }),
    };
    vehiclesService = { findByPlate: jest.fn() };
    notificationsService = {
      notifyByRoleForOrganization: jest
        .fn()
        .mockResolvedValue([{ id: 'notif-1' } as Notification]),
    };
    usersService = {
      findOne: jest.fn(),
      isActiveMemberOfOrganization: jest.fn().mockResolvedValue(true),
    };
    hubGateway = { sendDoorOpen: jest.fn().mockReturnValue(1) };
    visitsService = {};

    service = new DetectionsService(
      detectionsRepo as unknown as Repository<PlateDetection>,
      attemptsRepo as unknown as Repository<AccessAttempt>,
      cameraRepository as unknown as Repository<Camera>,
      vehiclesService as unknown as VehiclesService,
      notificationsService as unknown as NotificationsService,
      usersService as unknown as UsersService,
      hubGateway as unknown as HubGateway,
      visitsService as VisitsService,
      noConfig,
    );
  });

  it('notifica la detección pendiente vía notifyByRoleForOrganization, scopeada al tenant de la cámara', async () => {
    // Vehículo existe pero inactivo -> rama que llama a
    // createPendingDetectionForConcierge directamente (detections.service.ts).
    vehiclesService.findByPlate.mockResolvedValue({
      id: 'vehicle-1',
      active: false,
      vehicleType: 'auto',
      accessLevel: 'residente',
      owner: null,
    } as unknown as Vehicle);

    await service.createDetection(baseDto, CAMERA_ORG_ID);

    expect(
      notificationsService.notifyByRoleForOrganization,
    ).toHaveBeenCalledWith(
      'Conserje',
      CAMERA_ORG_ID,
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        data: expect.objectContaining({
          plate: 'ABCD12',
          requiresAction: true,
        }) as Record<string, unknown>,
      }),
    );
    // El leak cross-tenant (fix): la notificación de detección PENDIENTE nunca
    // debe pasar por `notifyByRole`, que ignora la organización.
  });

  describe('A2: la ingesta usa el condominio de la API key de servicio', () => {
    const OTHER_ORG_ID = 'org-otro-condominio';

    function expectNoSideEffects(): void {
      expect(detectionsRepo.save).not.toHaveBeenCalled();
      expect(attemptsRepo.create).not.toHaveBeenCalled();
      expect(vehiclesService.findByPlate).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    }

    it('una key del condominio A con una cámara del condominio B -> 403 y NO emite hub:door_open', async () => {
      cameraRepository.findOne.mockResolvedValue({
        id: CAMERA_ID,
        organizationId: OTHER_ORG_ID,
      } as Camera);
      // Aunque la patente sea de un residente activo (abriría en B), no se evalúa.
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        active: true,
        vehicleType: 'auto',
        accessLevel: 'residente',
        owner: null,
      } as unknown as Vehicle);

      await expect(
        service.createDetection(baseDto, CAMERA_ORG_ID),
      ).rejects.toThrow(ForbiddenException);
      expectNoSideEffects();
    });

    it('cámara inexistente -> 403 (mismo error que una ajena) sin efectos', async () => {
      cameraRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createDetection(baseDto, CAMERA_ORG_ID),
      ).rejects.toThrow(ForbiddenException);
      expectNoSideEffects();
    });

    it('cámara legacy sin organizationId -> 403 sin efectos (nunca coincide con la key)', async () => {
      cameraRepository.findOne.mockResolvedValue({
        id: CAMERA_ID,
        organizationId: null,
      } as Camera);

      await expect(
        service.createDetection(baseDto, CAMERA_ORG_ID),
      ).rejects.toThrow(ForbiddenException);
      expectNoSideEffects();
    });

    it('cámara del condominio de la key -> la detección queda estampada con ese condominio', async () => {
      vehiclesService.findByPlate.mockResolvedValue(null);
      const localService = new DetectionsService(
        detectionsRepo as unknown as Repository<PlateDetection>,
        attemptsRepo as unknown as Repository<AccessAttempt>,
        cameraRepository as unknown as Repository<Camera>,
        vehiclesService as unknown as VehiclesService,
        notificationsService as unknown as NotificationsService,
        usersService as unknown as UsersService,
        hubGateway as unknown as HubGateway,
        {
          validateAccess: jest
            .fn()
            .mockResolvedValue({ valid: false, message: 'no' }),
        } as unknown as VisitsService,
        noConfig,
      );

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      expect(detectionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: CAMERA_ORG_ID }),
      );
    });

    describe('createAttempt', () => {
      it('busca la detección acotada al condominio de la key; una de otro condominio -> 404 sin crear nada', async () => {
        const findOne = jest.fn().mockResolvedValue(null);
        const attemptService = new DetectionsService(
          { findOne } as unknown as Repository<PlateDetection>,
          attemptsRepo as unknown as Repository<AccessAttempt>,
          cameraRepository as unknown as Repository<Camera>,
          vehiclesService as unknown as VehiclesService,
          notificationsService as unknown as NotificationsService,
          usersService as unknown as UsersService,
          hubGateway as unknown as HubGateway,
          visitsService as VisitsService,
          noConfig,
        );

        await expect(
          attemptService.createAttempt(
            { detectionId: 'det-de-B', decision: 'Permitido' },
            CAMERA_ORG_ID,
          ),
        ).rejects.toThrow(NotFoundException);
        expect(findOne).toHaveBeenCalledWith({
          where: { id: 'det-de-B', organizationId: CAMERA_ORG_ID },
        });
        expect(attemptsRepo.save).not.toHaveBeenCalled();
      });

      it('detección del condominio de la key -> registra el intento con ese condominio', async () => {
        const detection = {
          id: 'det-1',
          organizationId: CAMERA_ORG_ID,
          createdAt: new Date(),
          detectionTimestamp: null,
        } as unknown as PlateDetection;
        const attemptService = new DetectionsService(
          {
            findOne: jest.fn().mockResolvedValue(detection),
          } as unknown as Repository<PlateDetection>,
          attemptsRepo as unknown as Repository<AccessAttempt>,
          cameraRepository as unknown as Repository<Camera>,
          vehiclesService as unknown as VehiclesService,
          notificationsService as unknown as NotificationsService,
          usersService as unknown as UsersService,
          hubGateway as unknown as HubGateway,
          visitsService as VisitsService,
          noConfig,
        );

        await attemptService.createAttempt(
          { detectionId: 'det-1', decision: 'Permitido' },
          CAMERA_ORG_ID,
        );

        expect(attemptsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            decision: 'Permitido',
            organizationId: CAMERA_ORG_ID,
          }),
        );
      });
    });
  });

  describe('apertura autónoma por visita vehicular pre-aprobada (camino LPR sin citófono)', () => {
    // Este describe cubre el camino determinista descrito en
    // docs/modulos/agente-cerebro.md §7/§11: patente detectada por cámara +
    // visita vehicular vigente -> decision='Permitido' -> hubGateway.sendDoorOpen
    // dirigido SIN pasar por Sofía/citófono. Usa su propia instancia de
    // DetectionsService (en vez del `visitsService = {}` del describe raíz)
    // porque estos casos SÍ ejercitan VisitsService.validateAccess/checkIn.
    let localVisitsService: jest.Mocked<
      Pick<VisitsService, 'validateAccess' | 'checkIn' | 'checkOut'>
    >;
    let localService: DetectionsService;

    const HOST_ID = 'host-1';
    const buildValidVisit = (
      overrides: Partial<{
        id: string;
        status: string;
        visitorName: string;
      }> = {},
    ) => ({
      id: overrides.id ?? 'visit-1',
      status: overrides.status ?? 'pending',
      visitorName: overrides.visitorName ?? 'Visitante Pre-Aprobado',
      host: { id: HOST_ID },
    });

    beforeEach(() => {
      // Vehículo NO registrado en el sistema (rama `!vehicle` de
      // detections.service.ts:144) — es el caso típico de un visitante cuya
      // patente solo existe como parte de la visita, no como Vehicle propio.
      vehiclesService.findByPlate.mockResolvedValue(null);

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
        hubGateway as unknown as HubGateway,
        localVisitsService as unknown as VisitsService,
        noConfig,
      );
    });

    it('visita vehicular pre-aprobada y vigente -> decision Permitido y hub:door_open dirigido al organizationId de la detección', async () => {
      const visit = buildValidVisit({ status: 'pending' });
      localVisitsService.validateAccess.mockResolvedValue({
        valid: true,
        visit: visit as unknown as Visit,
        message: 'ok',
      });
      localVisitsService.checkIn.mockResolvedValue(visit as unknown as Visit);

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      // FIX cross-tenant: la visita se consulta scopeada al organizationId de
      // la CÁMARA (CAMERA_ORG_ID) — no un skipTenantScope global (ver
      // detections.service.ts:71-98/127-135). El worker LPR no tiene
      // request.user, pero SÍ conoce el tenant de la cámara.
      expect(localVisitsService.validateAccess).toHaveBeenCalledWith(
        'ABCD12',
        'plate',
        {
          organizationId: CAMERA_ORG_ID,
        },
      );
      // Auto check-in de la visita (entrada), scopeado igual.
      expect(localVisitsService.checkIn).toHaveBeenCalledWith('visit-1', {
        organizationId: CAMERA_ORG_ID,
      });

      // La decisión queda registrada como Permitido en el AccessAttempt.
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Permitido',
          organizationId: CAMERA_ORG_ID,
        }),
      );

      // Apertura física dirigida al condominio de la CÁMARA que detectó la
      // patente (nunca broadcast global — hallazgo H2), y por `sendDoorOpen`,
      // que solo entrega a hubs físicos, nunca a un kiosko (Fase 4 · P4, D7).
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: CAMERA_ORG_ID },
        {
          type: 'vehicular',
          plate: 'ABCD12',
        },
      );
    });

    it('reingreso (visita ready) también abre el portón y hace check-in nuevamente', async () => {
      const visit = buildValidVisit({ status: 'ready' });
      localVisitsService.validateAccess.mockResolvedValue({
        valid: true,
        visit: visit as unknown as Visit,
        message: 'ok',
      });
      localVisitsService.checkIn.mockResolvedValue(visit as unknown as Visit);

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      expect(localVisitsService.checkIn).toHaveBeenCalledWith('visit-1', {
        organizationId: CAMERA_ORG_ID,
      });
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: CAMERA_ORG_ID },
        {
          type: 'vehicular',
          plate: 'ABCD12',
        },
      );
    });

    it('visita activa (ya adentro) -> registra check-out (salida) y también abre el portón', async () => {
      const visit = buildValidVisit({ status: 'active' });
      localVisitsService.validateAccess.mockResolvedValue({
        valid: true,
        visit: visit as unknown as Visit,
        message: 'ok',
      });
      localVisitsService.checkOut.mockResolvedValue(visit as unknown as Visit);

      const result = await localService.createDetection(baseDto, CAMERA_ORG_ID);

      expect(localVisitsService.checkOut).toHaveBeenCalledWith('visit-1', {
        organizationId: CAMERA_ORG_ID,
      });
      expect(localVisitsService.checkIn).not.toHaveBeenCalled();
      expect((result as { isExit: boolean }).isExit).toBe(true);
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: CAMERA_ORG_ID },
        {
          type: 'vehicular',
          plate: 'ABCD12',
        },
      );
    });

    it('patente sin visita válida -> NO abre el portón, cae a aprobación del conserje (Pendiente)', async () => {
      localVisitsService.validateAccess.mockResolvedValue({
        valid: false,
        message: 'Patente no autorizada',
      });

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      expect(localVisitsService.checkIn).not.toHaveBeenCalled();
      expect(localVisitsService.checkOut).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Pendiente',
          organizationId: CAMERA_ORG_ID,
        }),
      );
    });

    it('error al validar la visita -> NO abre el portón, cae a aprobación del conserje (fail-closed)', async () => {
      localVisitsService.validateAccess.mockRejectedValue(
        new Error('DB caída'),
      );

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Pendiente',
          organizationId: CAMERA_ORG_ID,
        }),
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
        visit: visitDeOtroCondominio as unknown as Visit,
        message: 'ok',
      });
      localVisitsService.checkIn.mockResolvedValue(
        visitDeOtroCondominio as unknown as Visit,
      );

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      // El scope pedido es el de la CÁMARA (CAMERA_ORG_ID) — DetectionsService
      // no lee/confía en `visitDeOtroCondominio.organizationId` para nada.
      expect(localVisitsService.validateAccess).toHaveBeenCalledWith(
        'ABCD12',
        'plate',
        {
          organizationId: CAMERA_ORG_ID,
        },
      );
      expect(localVisitsService.checkIn).toHaveBeenCalledWith(
        'visit-de-otro-condominio',
        {
          organizationId: CAMERA_ORG_ID,
        },
      );
      // La apertura sigue dirigida al condominio de la CÁMARA (nunca al de la
      // visita) — esto ya era correcto antes del fix y se preserva.
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: CAMERA_ORG_ID },
        {
          type: 'vehicular',
          plate: 'ABCD12',
        },
      );
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
        visit: visitDelMismoCondominio as unknown as Visit,
        message: 'ok',
      });
      localVisitsService.checkIn.mockResolvedValue(
        visitDelMismoCondominio as unknown as Visit,
      );

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: CAMERA_ORG_ID },
        {
          type: 'vehicular',
          plate: 'ABCD12',
        },
      );
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Permitido',
          organizationId: CAMERA_ORG_ID,
        }),
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

      await localService.createDetection(baseDto, CAMERA_ORG_ID);

      expect(localVisitsService.validateAccess).toHaveBeenCalledWith(
        'ABCD12',
        'plate',
        {
          organizationId: CAMERA_ORG_ID,
        },
      );
      expect(localVisitsService.checkIn).not.toHaveBeenCalled();
      expect(localVisitsService.checkOut).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(attemptsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'Pendiente',
          organizationId: CAMERA_ORG_ID,
        }),
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
        vehicleType: 'auto',
        accessLevel: 'residente',
        owner: null,
      } as unknown as Vehicle);

      await service.createDetection(baseDto, CAMERA_ORG_ID);

      expect(
        notificationsService.notifyByRoleForOrganization,
      ).toHaveBeenCalledWith(
        'Conserje',
        CAMERA_ORG_ID,
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.anything(),
      );
    });

    it('fail-closed (A2): cámara sin organizationId -> 403 antes de evaluar la patente, aun con un residente activo', async () => {
      // Antes: la detección caía a aprobación manual con organizationId=null.
      // Ahora la ingesta exige que la cámara sea del condominio de la API key,
      // y una cámara legacy nunca lo es: se rechaza sin ningún efecto.
      cameraRepository.findOne.mockResolvedValue({
        id: CAMERA_ID,
        organizationId: null,
      } as Camera);
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        active: true,
        vehicleType: 'auto',
        accessLevel: 'residente',
        owner: null,
      } as unknown as Vehicle);

      await expect(
        service.createDetection(baseDto, CAMERA_ORG_ID),
      ).rejects.toThrow(ForbiddenException);

      expect(vehiclesService.findByPlate).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(attemptsRepo.create).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
    });
  });
});

/**
 * Fase 4 · P3 (D4, docs/modulos/hardening-pre-piloto.md §2): LPR
 * fail-closed. "Permitido" (y `hub:door_open`) solo sale de las dos ramas
 * explícitas: entrada (PENDING/READY_FOR_REENTRY -> check-in) y salida
 * (ACTIVE -> check-out). Todo lo demás se deniega o escala al conserje.
 */
describe('DetectionsService — LPR fail-closed (Fase 4 · P3, D4)', () => {
  const CAMERA_ID = '11111111-1111-1111-1111-111111111111';
  const ORG = 'org-camera-tenant';
  const PLATE = 'ABCD12';
  const dto: CreatePlateDetectionDto = { cameraId: CAMERA_ID, plate: PLATE };

  let detectionsRepo: Pick<
    PersistenceRepositoryMock<PlateDetection>,
    'create' | 'save'
  >;
  let attemptsRepo: Pick<
    PersistenceRepositoryMock<AccessAttempt>,
    'create' | 'save'
  >;
  let cameraRepository: jest.Mocked<Pick<Repository<Camera>, 'findOne'>>;
  let vehiclesService: jest.Mocked<Pick<VehiclesService, 'findByPlate'>>;
  let notificationsService: jest.Mocked<
    Pick<NotificationsService, 'create' | 'notifyByRoleForOrganization'>
  >;
  let hubGateway: jest.Mocked<Pick<HubGateway, 'sendDoorOpen'>>;
  /** Membresía activa del propietario / anfitrión (corrección P5, cyber A1). */
  let isActiveMember: jest.Mock<Promise<boolean>, [string, string]>;

  function buildService(
    visitsService: unknown,
    config: ConfigService = noConfig,
  ): DetectionsService {
    return new DetectionsService(
      detectionsRepo as unknown as Repository<PlateDetection>,
      attemptsRepo as unknown as Repository<AccessAttempt>,
      cameraRepository as unknown as Repository<Camera>,
      vehiclesService as unknown as VehiclesService,
      notificationsService as unknown as NotificationsService,
      {
        findOne: jest.fn(),
        isActiveMemberOfOrganization: isActiveMember,
      } as unknown as UsersService,
      hubGateway as unknown as HubGateway,
      visitsService as VisitsService,
      config,
    );
  }

  function makeVisit(overrides: Partial<Visit> = {}): Visit {
    return {
      id: 'visit-1',
      organizationId: ORG,
      type: VisitType.VEHICULAR,
      status: VisitStatus.PENDING,
      visitorName: 'Visitante',
      maxUses: null,
      usedCount: 0,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 3_600_000),
      host: { id: 'host-1' },
      vehicle: null,
      requestedPlate: null,
      ...overrides,
    } as unknown as Visit;
  }

  function lastDecision(): unknown {
    const calls = attemptsRepo.create.mock.calls;
    return (calls[calls.length - 1]?.[0] as { decision?: unknown })?.decision;
  }

  beforeEach(() => {
    detectionsRepo = {
      create: jest.fn((data) => ({ ...data }) as unknown as PlateDetection),
      save: jest.fn((entity) =>
        Promise.resolve({
          id: 'detection-1',
          createdAt: new Date(),
          ...entity,
        } as unknown as PlateDetection),
      ),
    };
    attemptsRepo = {
      create: jest.fn((data) => ({ ...data }) as unknown as AccessAttempt),
      save: jest.fn((entity) =>
        Promise.resolve({
          id: 'attempt-1',
          ...entity,
        } as unknown as AccessAttempt),
      ),
    };
    cameraRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: CAMERA_ID, organizationId: ORG }),
    };
    vehiclesService = { findByPlate: jest.fn().mockResolvedValue(null) };
    isActiveMember = jest
      .fn<Promise<boolean>, [string, string]>()
      .mockResolvedValue(true);
    notificationsService = {
      create: jest.fn().mockResolvedValue({}),
      notifyByRoleForOrganization: jest
        .fn()
        .mockResolvedValue([{ id: 'notif-1' } as Notification]),
    };
    hubGateway = { sendDoorOpen: jest.fn().mockReturnValue(1) };
  });

  /**
   * `VisitsService` REAL para `validateAccess`/`findByPlate`, sobre un
   * QueryBuilder falso que evalúa el filtro de estados y de condominio que
   * arma el servicio (así se prueba que `LPR_MATCHABLE` deja afuera a
   * `AWAITING_APPROVAL`, no un mock que ya responde "inválido").
   */
  function realVisitsServiceOver(rows: Visit[]): VisitsService {
    const state: { plate?: string; statuses: VisitStatus[]; org?: string } = {
      statuses: [],
    };
    interface FakePlateQueryBuilder {
      leftJoinAndSelect: jest.Mock<FakePlateQueryBuilder, []>;
      where: jest.Mock<FakePlateQueryBuilder, [string, { plate: string }]>;
      andWhere: jest.Mock<
        FakePlateQueryBuilder,
        [string, Record<string, unknown>?]
      >;
      getOne: jest.Mock<Promise<Visit | null>, []>;
    }
    const qb = {} as FakePlateQueryBuilder;
    qb.leftJoinAndSelect = jest.fn(() => qb);
    qb.where = jest.fn((_sql: string, params: { plate: string }) => {
      state.plate = params.plate;
      return qb;
    });
    qb.andWhere = jest.fn((sql: string, params?: Record<string, unknown>) => {
      if (sql === 'visit.status IN (:...statuses)') {
        state.statuses = params?.statuses as VisitStatus[];
      }
      if (sql.includes('organizationId')) {
        state.org = params?.tenantOrgId as string;
      }
      return qb;
    });
    qb.getOne = jest.fn(() => {
      const now = new Date();
      const match = rows.find(
        (row) =>
          row.vehicle?.plate === state.plate &&
          state.statuses.includes(row.status) &&
          row.organizationId === state.org &&
          row.validFrom <= now &&
          row.validUntil >= now,
      );
      return Promise.resolve(match ?? null);
    });
    return new VisitsService(
      { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<Visit>,
      {} as Repository<Vehicle>,
      {} as UsersService,
      {} as FamiliesService,
      {} as VehiclesService,
      notificationsService as unknown as NotificationsService,
      {} as TenantContextService,
    );
  }

  describe('solicitud del conserje digital sin aprobar (AWAITING_APPROVAL)', () => {
    it('sin Vehicle (no se crea hasta aprobar): validateAccess real no la encuentra -> escala al conserje, NO abre', async () => {
      const visitsService = realVisitsServiceOver([
        makeVisit({
          status: VisitStatus.AWAITING_APPROVAL,
          requestedPlate: PLATE,
          vehicle: null,
        }),
      ]);
      const checkIn = jest.spyOn(visitsService, 'checkIn');

      const result = await buildService(visitsService).createDetection(
        dto,
        ORG,
      );

      expect(result).toEqual(
        expect.objectContaining({ requiresApproval: true }),
      );
      expect(lastDecision()).toBe('Pendiente');
      expect(checkIn).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('aunque la visita tuviera Vehicle con la patente, LPR_MATCHABLE la excluye -> escala, NO abre', async () => {
      const visitsService = realVisitsServiceOver([
        makeVisit({
          status: VisitStatus.AWAITING_APPROVAL,
          vehicle: { plate: PLATE } as Vehicle,
        }),
      ]);

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('control: la misma visita ya APROBADA (PENDING, con Vehicle) sí abre y hace check-in', async () => {
      const visitsService = realVisitsServiceOver([
        makeVisit({
          status: VisitStatus.PENDING,
          vehicle: { plate: PLATE } as Vehicle,
        }),
      ]);
      const checkIn = jest
        .spyOn(visitsService, 'checkIn')
        .mockResolvedValue(makeVisit({ status: VisitStatus.ACTIVE }));

      await buildService(visitsService).createDetection(dto, ORG);

      expect(checkIn).toHaveBeenCalledWith('visit-1', { organizationId: ORG });
      expect(lastDecision()).toBe('Permitido');
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: ORG },
        { type: 'vehicular', plate: PLATE },
      );
    });
  });

  it('vehículo activo SIN nivel de acceso -> escala al conserje (ya no "Permitido" por defecto)', async () => {
    vehiclesService.findByPlate.mockResolvedValue({
      id: 'vehicle-1',
      plate: PLATE,
      active: true,
      vehicleType: null,
      accessLevel: null,
      owner: null,
    } as unknown as Vehicle);
    const visitsService = {
      validateAccess: jest.fn(),
      checkIn: jest.fn(),
      checkOut: jest.fn(),
    };

    const result = await buildService(visitsService).createDetection(dto, ORG);

    expect(result).toEqual(expect.objectContaining({ requiresApproval: true }));
    expect(lastDecision()).toBe('Pendiente');
    expect(visitsService.validateAccess).not.toHaveBeenCalled();
    expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
  });

  describe('corrección P5 (cyber A1): propietario / anfitrión activo', () => {
    function residentVehicle(ownerId: string | null) {
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType: 'auto',
        accessLevel: 'residente',
        owner: ownerId ? ({ id: ownerId } as User) : null,
        ownerId,
      } as unknown as Vehicle);
    }
    const noVisits = () => ({
      validateAccess: jest.fn(),
      checkIn: jest.fn(),
      checkOut: jest.fn(),
    });

    it('residente con propietario miembro activo del condominio de la cámara -> Permitido', async () => {
      residentVehicle('owner-1');

      await buildService(noVisits()).createDetection(dto, ORG);

      expect(isActiveMember).toHaveBeenCalledWith('owner-1', ORG);
      expect(lastDecision()).toBe('Permitido');
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('residente SIN propietario -> conserje, sin abrir ni consultar membresías', async () => {
      residentVehicle(null);

      const result = await buildService(noVisits()).createDetection(dto, ORG);

      expect(result).toEqual(
        expect.objectContaining({ requiresApproval: true }),
      );
      expect(isActiveMember).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('residente con propietario deshabilitado o fuera del condominio -> conserje, sin abrir', async () => {
      residentVehicle('owner-1');
      isActiveMember.mockResolvedValue(false);

      await buildService(noVisits()).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it.each([
      ['vehículo visitante', 'visitante'],
      ['patente sin vehículo', null],
    ])(
      '%s con visita válida cuyo anfitrión ya no está activo -> conserje, sin check-in ni apertura',
      async (_label, accessLevel) => {
        if (accessLevel) {
          vehiclesService.findByPlate.mockResolvedValue({
            id: 'vehicle-1',
            plate: PLATE,
            active: true,
            vehicleType: null,
            accessLevel,
            owner: null,
          } as unknown as Vehicle);
        }
        isActiveMember.mockResolvedValue(false);
        const visitsService = {
          validateAccess: jest.fn().mockResolvedValue({
            valid: true,
            visit: makeVisit({ status: VisitStatus.PENDING }),
            message: 'ok',
          }),
          checkIn: jest.fn(),
          checkOut: jest.fn(),
        };

        await buildService(visitsService).createDetection(dto, ORG);

        expect(isActiveMember).toHaveBeenCalledWith('host-1', ORG);
        expect(lastDecision()).toBe('Pendiente');
        expect(visitsService.checkIn).not.toHaveBeenCalled();
        expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      },
    );

    it('visita con el anfitrión deshabilitado (visit.host null por el soft-delete) -> conserje', async () => {
      const visitsService = {
        validateAccess: jest.fn().mockResolvedValue({
          valid: true,
          visit: makeVisit({
            status: VisitStatus.PENDING,
            host: null as unknown as User,
          }),
          message: 'ok',
        }),
        checkIn: jest.fn(),
        checkOut: jest.fn(),
      };

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(visitsService.checkIn).not.toHaveBeenCalled();
    });
  });

  describe('modelo corregido (Fase 4 · P5.C): solo accessLevel decide el portón', () => {
    function registered(
      vehicleType: string | null,
      accessLevel: string | null,
    ) {
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType,
        accessLevel,
        owner: null,
        ownerId: 'owner-1',
      } as unknown as Vehicle);
    }
    function visitsDouble() {
      return {
        validateAccess: jest.fn().mockResolvedValue({
          valid: false,
          message: 'Patente no autorizada',
        }),
        checkIn: jest.fn(),
        checkOut: jest.fn(),
      };
    }

    it('accessLevel residente (cualquier carrocería) -> Permitido y door_open, sin consultar visitas', async () => {
      registered('moto', 'residente');
      const visitsService = visitsDouble();

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Permitido');
      expect(visitsService.validateAccess).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
    });

    it('accessLevel visitante sin visita válida -> Denegado (exige visita), sin door_open', async () => {
      registered(null, 'visitante');
      const visitsService = visitsDouble();

      await buildService(visitsService).createDetection(dto, ORG);

      expect(visitsService.validateAccess).toHaveBeenCalledWith(
        PLATE,
        'plate',
        {
          organizationId: ORG,
        },
      );
      expect(lastDecision()).toBe('Denegado');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it.each([
      ['servicio', 'auto'],
      [null, 'auto'],
    ])(
      'accessLevel %p (carrocería %p) -> escala al conserje, sin door_open',
      async (accessLevel, vehicleType) => {
        registered(vehicleType, accessLevel);
        const visitsService = visitsDouble();

        const result = await buildService(visitsService).createDetection(
          dto,
          ORG,
        );

        expect(result).toEqual(
          expect.objectContaining({ requiresApproval: true }),
        );
        expect(lastDecision()).toBe('Pendiente');
        expect(visitsService.validateAccess).not.toHaveBeenCalled();
        expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      },
    );

    it('la carrocería ya no decide: vehicleType legacy "residente" sin accessLevel -> conserje', async () => {
      registered('residente', null);
      const visitsService = visitsDouble();

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('valores del modelo viejo en accessLevel ("permanente") -> conserje (los convierte la migración)', async () => {
      registered(null, 'permanente');
      const visitsService = visitsDouble();

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });
  });

  describe('estado de la visita fuera de las ramas de entrada/salida -> Denegado sin door_open', () => {
    const otherStatuses = [
      VisitStatus.AWAITING_APPROVAL,
      VisitStatus.COMPLETED,
      VisitStatus.CANCELLED,
      VisitStatus.EXPIRED,
      VisitStatus.DENIED,
    ];

    it.each(otherStatuses)(
      'vehículo NO registrado + validateAccess "válido" con visita %s -> Denegado',
      async (status) => {
        const visitsService = {
          validateAccess: jest.fn().mockResolvedValue({
            valid: true,
            visit: makeVisit({ status }),
            message: 'ok',
          }),
          checkIn: jest.fn(),
          checkOut: jest.fn(),
        };

        await buildService(visitsService).createDetection(dto, ORG);

        expect(lastDecision()).toBe('Denegado');
        expect(visitsService.checkIn).not.toHaveBeenCalled();
        expect(visitsService.checkOut).not.toHaveBeenCalled();
        expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      },
    );

    it.each(otherStatuses)(
      'vehículo VISITANTE + validateAccess "válido" con visita %s -> Denegado',
      async (status) => {
        vehiclesService.findByPlate.mockResolvedValue({
          id: 'vehicle-1',
          plate: PLATE,
          active: true,
          vehicleType: null,
          accessLevel: 'visitante',
          owner: null,
        } as unknown as Vehicle);
        const visitsService = {
          validateAccess: jest.fn().mockResolvedValue({
            valid: true,
            visit: makeVisit({ status }),
            message: 'ok',
          }),
          checkIn: jest.fn(),
          checkOut: jest.fn(),
        };

        await buildService(visitsService).createDetection(dto, ORG);

        expect(lastDecision()).toBe('Denegado');
        expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      },
    );
  });

  describe('ramas de entrada y salida (sin cambios)', () => {
    const visitorVehicle = {
      id: 'vehicle-1',
      plate: PLATE,
      active: true,
      vehicleType: null,
      accessLevel: 'visitante',
      owner: null,
    } as unknown as Vehicle;

    it.each([
      [VisitStatus.PENDING, 'checkIn', false],
      [VisitStatus.READY_FOR_REENTRY, 'checkIn', false],
      [VisitStatus.ACTIVE, 'checkOut', true],
    ] as const)(
      'vehículo visitante + visita %s -> %s, Permitido y door_open',
      async (status, method, isExit) => {
        vehiclesService.findByPlate.mockResolvedValue(visitorVehicle);
        const visitsService = {
          validateAccess: jest.fn().mockResolvedValue({
            valid: true,
            visit: makeVisit({ status }),
            message: 'ok',
          }),
          checkIn: jest.fn().mockResolvedValue(makeVisit()),
          checkOut: jest.fn().mockResolvedValue(makeVisit()),
        };

        const result = await buildService(visitsService).createDetection(
          dto,
          ORG,
        );

        expect(visitsService[method]).toHaveBeenCalledWith('visit-1', {
          organizationId: ORG,
        });
        expect(lastDecision()).toBe('Permitido');
        expect((result as { isExit: boolean }).isExit).toBe(isExit);
        expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
          { hubId: null, organizationId: ORG },
          { type: 'vehicular', plate: PLATE },
        );
      },
    );

    it('si el check-in falla, nunca abre: vehículo visitante -> Denegado', async () => {
      vehiclesService.findByPlate.mockResolvedValue(visitorVehicle);
      const visitsService = {
        validateAccess: jest.fn().mockResolvedValue({
          valid: true,
          visit: makeVisit({ status: VisitStatus.PENDING }),
          message: 'ok',
        }),
        checkIn: jest.fn().mockRejectedValue(new Error('409 carrera')),
        checkOut: jest.fn(),
      };

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Denegado');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('si el check-in falla, nunca abre: vehículo no registrado -> conserje', async () => {
      const visitsService = {
        validateAccess: jest.fn().mockResolvedValue({
          valid: true,
          visit: makeVisit({ status: VisitStatus.PENDING }),
          message: 'ok',
        }),
        checkIn: jest.fn().mockRejectedValue(new Error('409 carrera')),
        checkOut: jest.fn(),
      };

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('vehículo residente activo sigue Permitido sin consultar visitas', async () => {
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType: 'auto',
        accessLevel: 'residente',
        owner: null,
        ownerId: 'owner-1',
      } as unknown as Vehicle);
      const visitsService = { validateAccess: jest.fn() };

      await buildService(visitsService).createDetection(dto, ORG);

      expect(visitsService.validateAccess).not.toHaveBeenCalled();
      expect(lastDecision()).toBe('Permitido');
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
    });
  });

  describe('espera antes de la salida (VISIT_EXIT_COOLDOWN_MINUTES, decisión de Benjamin)', () => {
    const minutesAgo = (minutes: number): Date =>
      new Date(Date.now() - minutes * 60 * 1000);

    function activeVisitService(entryTime: Date | null) {
      return {
        validateAccess: jest.fn().mockResolvedValue({
          valid: true,
          visit: makeVisit({ status: VisitStatus.ACTIVE, entryTime }),
          message: 'ok',
        }),
        checkIn: jest.fn(),
        checkOut: jest.fn().mockResolvedValue(makeVisit()),
      };
    }

    function lastAttempt(): Partial<AccessAttempt> {
      const calls = attemptsRepo.create.mock.calls;
      return calls[calls.length - 1]?.[0] ?? {};
    }

    it('ACTIVE dentro de la espera (default 5 min): Duplicado, sin checkOut, sin door_open ni alertas', async () => {
      const visitsService = activeVisitService(minutesAgo(1));

      const result = await buildService(visitsService).createDetection(
        dto,
        ORG,
      );

      expect(visitsService.checkOut).not.toHaveBeenCalled();
      expect(visitsService.checkIn).not.toHaveBeenCalled();
      expect(lastAttempt()).toEqual(
        expect.objectContaining({
          decision: 'Duplicado',
          reason:
            'Ingreso ya registrado, dentro del período de espera - Visitante',
          method: 'Patente - Entrada',
          organizationId: ORG,
        }),
      );
      expect((result as { isExit: boolean }).isExit).toBe(false);
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
    });

    it('vehículo VISITANTE registrado + ACTIVE dentro de la espera: también Duplicado', async () => {
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType: null,
        accessLevel: 'visitante',
        owner: null,
      } as unknown as Vehicle);
      const visitsService = activeVisitService(minutesAgo(2));

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Duplicado');
      expect(visitsService.checkOut).not.toHaveBeenCalled();
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('ACTIVE fuera de la espera: checkOut normal, Permitido y door_open', async () => {
      const visitsService = activeVisitService(minutesAgo(10));

      const result = await buildService(visitsService).createDetection(
        dto,
        ORG,
      );

      expect(visitsService.checkOut).toHaveBeenCalledWith('visit-1', {
        organizationId: ORG,
      });
      expect(lastDecision()).toBe('Permitido');
      expect((result as { isExit: boolean }).isExit).toBe(true);
      expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
        { hubId: null, organizationId: ORG },
        { type: 'vehicular', plate: PLATE },
      );
    });

    it('respeta VISIT_EXIT_COOLDOWN_MINUTES: con 15 min, un ingreso de hace 10 min sigue en espera', async () => {
      const visitsService = activeVisitService(minutesAgo(10));
      const config = {
        get: (key: string) =>
          key === 'VISIT_EXIT_COOLDOWN_MINUTES' ? '15' : undefined,
      } as unknown as ConfigService;

      await buildService(visitsService, config).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Duplicado');
      expect(visitsService.checkOut).not.toHaveBeenCalled();
    });

    it('un VISIT_EXIT_COOLDOWN_MINUTES inválido no deja construir el servicio (fail-closed)', () => {
      const config = {
        get: () => '0',
      } as unknown as ConfigService;

      expect(() => buildService({}, config)).toThrow(
        'VISIT_EXIT_COOLDOWN_MINUTES',
      );
    });

    it('un 409 del checkOut que NO es "salida ya registrada" sigue el camino de error: no emite door_open', async () => {
      const visitsService = activeVisitService(minutesAgo(10));
      visitsService.checkOut.mockRejectedValue(
        new ConflictException(
          'La visita cambió mientras se registraba la salida',
        ),
      );

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('una falla del checkOut con vehículo VISITANTE -> Denegado, sin door_open', async () => {
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType: null,
        accessLevel: 'visitante',
        owner: null,
      } as unknown as Vehicle);
      const visitsService = activeVisitService(minutesAgo(10));
      visitsService.checkOut.mockRejectedValue(new Error('BD caída'));

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Denegado');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });
  });

  describe('borde exacto de la espera (VISIT_EXIT_COOLDOWN_MINUTES = 5)', () => {
    const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
    const COOLDOWN_MS = 5 * 60 * 1000;

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function passageService(visit: Visit) {
      return {
        validateAccess: jest
          .fn()
          .mockResolvedValue({ valid: true, visit, message: 'ok' }),
        checkIn: jest.fn().mockResolvedValue(visit),
        checkOut: jest.fn().mockResolvedValue(visit),
      };
    }

    describe('ACTIVE (salida tras el ingreso)', () => {
      it('ingreso hace exactamente 5 min: ya no hay espera -> checkOut y door_open', async () => {
        const visitsService = passageService(
          makeVisit({
            status: VisitStatus.ACTIVE,
            entryTime: new Date(NOW - COOLDOWN_MS),
          }),
        );

        await buildService(visitsService).createDetection(dto, ORG);

        expect(visitsService.checkOut).toHaveBeenCalledTimes(1);
        expect(lastDecision()).toBe('Permitido');
        expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
      });

      it('ingreso hace 5 min menos 1 ms: sigue en espera -> Duplicado', async () => {
        const visitsService = passageService(
          makeVisit({
            status: VisitStatus.ACTIVE,
            entryTime: new Date(NOW - COOLDOWN_MS + 1),
          }),
        );

        await buildService(visitsService).createDetection(dto, ORG);

        expect(visitsService.checkOut).not.toHaveBeenCalled();
        expect(lastDecision()).toBe('Duplicado');
        expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      });

      it('entryTime null (datos previos a P3): no hay ingreso que proteger -> checkOut', async () => {
        const visitsService = passageService(
          makeVisit({ status: VisitStatus.ACTIVE, entryTime: null }),
        );

        await buildService(visitsService).createDetection(dto, ORG);

        expect(visitsService.checkOut).toHaveBeenCalledTimes(1);
        expect(lastDecision()).toBe('Permitido');
      });
    });

    /**
     * Espera simétrica (riesgo residual de P3): el mismo auto saliendo no se
     * lee como reingreso de una visita READY_FOR_REENTRY.
     */
    describe('READY_FOR_REENTRY (reingreso tras la salida)', () => {
      function lastAttempt(): Partial<AccessAttempt> {
        const calls = attemptsRepo.create.mock.calls;
        return calls[calls.length - 1]?.[0] ?? {};
      }

      it('salida hace 1 min: Duplicado, sin checkIn, sin door_open ni alertas', async () => {
        const visitsService = passageService(
          makeVisit({
            status: VisitStatus.READY_FOR_REENTRY,
            exitTime: new Date(NOW - 60_000),
          }),
        );

        const result = await buildService(visitsService).createDetection(
          dto,
          ORG,
        );

        expect(visitsService.checkIn).not.toHaveBeenCalled();
        expect(lastAttempt()).toEqual(
          expect.objectContaining({
            decision: 'Duplicado',
            reason:
              'Salida ya registrada, dentro del período de espera - Visitante',
            method: 'Patente - Salida',
          }),
        );
        expect((result as { isExit: boolean }).isExit).toBe(true);
        expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
        expect(notificationsService.create).not.toHaveBeenCalled();
        expect(
          notificationsService.notifyByRoleForOrganization,
        ).not.toHaveBeenCalled();
      });

      it('salida hace 5 min menos 1 ms: sigue en espera -> Duplicado', async () => {
        const visitsService = passageService(
          makeVisit({
            status: VisitStatus.READY_FOR_REENTRY,
            exitTime: new Date(NOW - COOLDOWN_MS + 1),
          }),
        );

        await buildService(visitsService).createDetection(dto, ORG);

        expect(visitsService.checkIn).not.toHaveBeenCalled();
        expect(lastDecision()).toBe('Duplicado');
      });

      it('salida hace exactamente 5 min: reingreso normal (checkIn y door_open)', async () => {
        const visitsService = passageService(
          makeVisit({
            status: VisitStatus.READY_FOR_REENTRY,
            exitTime: new Date(NOW - COOLDOWN_MS),
          }),
        );

        await buildService(visitsService).createDetection(dto, ORG);

        expect(visitsService.checkIn).toHaveBeenCalledWith('visit-1', {
          organizationId: ORG,
        });
        expect(lastDecision()).toBe('Permitido');
        expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
      });

      it('exitTime null: no hay salida que proteger -> reingreso normal', async () => {
        const visitsService = passageService(
          makeVisit({ status: VisitStatus.READY_FOR_REENTRY, exitTime: null }),
        );

        await buildService(visitsService).createDetection(dto, ORG);

        expect(visitsService.checkIn).toHaveBeenCalledTimes(1);
        expect(lastDecision()).toBe('Permitido');
      });

      it('una PENDING (nunca entró) no tiene espera: entra aunque tenga exitTime', async () => {
        const visitsService = passageService(
          makeVisit({
            status: VisitStatus.PENDING,
            exitTime: new Date(NOW - 60_000),
          }),
        );

        await buildService(visitsService).createDetection(dto, ORG);

        expect(visitsService.checkIn).toHaveBeenCalledTimes(1);
        expect(lastDecision()).toBe('Permitido');
      });
    });
  });

  it('el check-in se registra ANTES del door_open (invocationCallOrder)', async () => {
    const visitsService = {
      validateAccess: jest.fn().mockResolvedValue({
        valid: true,
        visit: makeVisit({ status: VisitStatus.PENDING }),
        message: 'ok',
      }),
      checkIn: jest.fn().mockResolvedValue(makeVisit()),
      checkOut: jest.fn(),
    };

    await buildService(visitsService).createDetection(dto, ORG);

    expect(visitsService.checkIn.mock.invocationCallOrder[0]).toBeLessThan(
      hubGateway.sendDoorOpen.mock.invocationCallOrder[0],
    );
  });

  describe('detecciones duplicadas: check-out que pierde la carrera (QA N5)', () => {
    function racingExitService() {
      return {
        validateAccess: jest.fn().mockResolvedValue({
          valid: true,
          visit: makeVisit({
            status: VisitStatus.ACTIVE,
            entryTime: new Date(Date.now() - 60 * 60 * 1000),
          }),
          message: 'ok',
        }),
        checkIn: jest.fn(),
        checkOut: jest
          .fn()
          .mockRejectedValue(new VisitExitAlreadyRegisteredException()),
      };
    }

    function lastAttempt(): Partial<AccessAttempt> {
      const calls = attemptsRepo.create.mock.calls;
      return calls[calls.length - 1]?.[0] ?? {};
    }

    it('vehículo no registrado: Duplicado (salida), sin alerta HIGH ni door_open', async () => {
      const visitsService = racingExitService();

      const result = await buildService(visitsService).createDetection(
        dto,
        ORG,
      );

      expect(lastAttempt()).toEqual(
        expect.objectContaining({
          decision: 'Duplicado',
          reason: 'Salida ya registrada por otra detección - Visitante',
          method: 'Patente - Salida',
        }),
      );
      expect(result).not.toEqual(
        expect.objectContaining({ requiresApproval: true }),
      );
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
    });

    it('vehículo VISITANTE registrado: también Duplicado, sin alertas ni apertura', async () => {
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType: null,
        accessLevel: 'visitante',
        owner: null,
      } as unknown as Vehicle);
      const visitsService = racingExitService();

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Duplicado');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
    });

    it('dos lecturas simultáneas de la misma salida: abre UNA sola vez y la otra queda Duplicado', async () => {
      const visitsService = racingExitService();
      visitsService.checkOut
        .mockReset()
        .mockResolvedValueOnce(
          makeVisit({ status: VisitStatus.READY_FOR_REENTRY }),
        )
        .mockRejectedValueOnce(new VisitExitAlreadyRegisteredException());
      const service = buildService(visitsService);

      await Promise.all([
        service.createDetection(dto, ORG),
        service.createDetection(dto, ORG),
      ]);

      expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
      const decisions = attemptsRepo.create.mock.calls.map(
        (call) => (call[0] as { decision?: unknown }).decision,
      );
      expect([...decisions].sort()).toEqual(['Duplicado', 'Permitido']);
    });
  });

  describe('detecciones duplicadas: check-in que pierde la carrera (seguridad B4)', () => {
    function racingVisitService() {
      return {
        validateAccess: jest.fn().mockResolvedValue({
          valid: true,
          visit: makeVisit({ status: VisitStatus.PENDING }),
          message: 'ok',
        }),
        checkIn: jest
          .fn()
          .mockRejectedValue(new VisitEntryAlreadyRegisteredException()),
        checkOut: jest.fn(),
      };
    }

    it('vehículo no registrado: Duplicado, sin alerta HIGH al anfitrión ni door_open adicional', async () => {
      const visitsService = racingVisitService();

      const result = await buildService(visitsService).createDetection(
        dto,
        ORG,
      );

      expect(lastDecision()).toBe('Duplicado');
      expect(result).not.toEqual(
        expect.objectContaining({ requiresApproval: true }),
      );
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
    });

    it('vehículo VISITANTE registrado: también Duplicado, sin alertas ni apertura', async () => {
      vehiclesService.findByPlate.mockResolvedValue({
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType: null,
        accessLevel: 'visitante',
        owner: null,
      } as unknown as Vehicle);
      const visitsService = racingVisitService();

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Duplicado');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('otro 409 del check-in (no "ya registrada") sigue el camino de error: nunca abre', async () => {
      const visitsService = racingVisitService();
      visitsService.checkIn.mockRejectedValue(
        new ConflictException(
          'No se puede registrar la entrada: la visita está cancelada',
        ),
      );

      await buildService(visitsService).createDetection(dto, ORG);

      expect(lastDecision()).toBe('Pendiente');
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    it('dos detecciones simultáneas de la misma entrada: abre UNA sola vez y la otra queda Duplicado', async () => {
      // Ambas leen la visita PENDING; VisitsService.checkIn deja ganar a una
      // sola (ver el test de concurrencia en visits.service.spec.ts).
      const visitsService = racingVisitService();
      visitsService.checkIn
        .mockReset()
        .mockResolvedValueOnce(makeVisit({ status: VisitStatus.ACTIVE }))
        .mockRejectedValueOnce(new VisitEntryAlreadyRegisteredException());
      const service = buildService(visitsService);

      await Promise.all([
        service.createDetection(dto, ORG),
        service.createDetection(dto, ORG),
      ]);

      expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
      const decisions = attemptsRepo.create.mock.calls.map(
        (call) => (call[0] as { decision?: unknown }).decision,
      );
      expect([...decisions].sort()).toEqual(['Duplicado', 'Permitido']);
    });
  });

  it('vehículo VISITANTE inactivo -> escala al conserje, sin consultar visitas ni abrir', async () => {
    vehiclesService.findByPlate.mockResolvedValue({
      id: 'vehicle-1',
      plate: PLATE,
      active: false,
      vehicleType: null,
      accessLevel: 'visitante',
      owner: null,
    } as unknown as Vehicle);
    const visitsService = {
      validateAccess: jest.fn(),
      checkIn: jest.fn(),
      checkOut: jest.fn(),
    };

    const result = await buildService(visitsService).createDetection(dto, ORG);

    expect(result).toEqual(expect.objectContaining({ requiresApproval: true }));
    expect(lastDecision()).toBe('Pendiente');
    expect(visitsService.validateAccess).not.toHaveBeenCalled();
    expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
  });

  describe('plan LPR por cámara (F2): modo solo registro (D8) y normalización (D11)', () => {
    const REGISTER_META = { direction: 'exit' as const };

    function activeResident(): Vehicle {
      return {
        id: 'vehicle-1',
        plate: PLATE,
        active: true,
        vehicleType: 'auto',
        accessLevel: 'residente',
        owner: { id: 'owner-1' },
      } as unknown as Vehicle;
    }

    function cameraWith(lprSettings: unknown): void {
      cameraRepository.findOne.mockResolvedValue({
        id: CAMERA_ID,
        organizationId: ORG,
        lprSettings,
      } as unknown as Camera);
    }

    function visitsSpy() {
      return {
        validateAccess: jest.fn().mockResolvedValue({
          valid: true,
          visit: makeVisit(),
          message: 'ok',
        }),
        checkIn: jest.fn(),
        checkOut: jest.fn(),
        findByPlate: jest.fn(),
      };
    }

    function expectNoAccessEffects(visits: ReturnType<typeof visitsSpy>): void {
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
      expect(visits.validateAccess).not.toHaveBeenCalled();
      expect(visits.checkIn).not.toHaveBeenCalled();
      expect(visits.checkOut).not.toHaveBeenCalled();
      expect(vehiclesService.findByPlate).not.toHaveBeenCalled();
    }

    it.each([
      ['residente activo', activeResident()],
      ['patente sin vehículo (visita válida)', null],
    ])(
      'register: %s -> guarda detección + intento Registrado, y NUNCA abre, escala, notifica ni toca visitas',
      async (_name, vehicle) => {
        cameraWith({ action: 'register', direction: 'both' });
        vehiclesService.findByPlate.mockResolvedValue(vehicle);
        const visits = visitsSpy();

        const result = await buildService(visits).createDetection(
          { ...dto, meta: REGISTER_META },
          ORG,
        );

        expect(detectionsRepo.save).toHaveBeenCalledTimes(1);
        expect(attemptsRepo.create).toHaveBeenCalledTimes(1);
        expect(lastDecision()).toBe('Registrado');
        expect(attemptsRepo.create.mock.calls[0][0]).toEqual(
          expect.objectContaining({
            decision: 'Registrado',
            method: 'Patente - Salida',
            residente: null,
            responseTimeMs: null,
            organizationId: ORG,
          }),
        );
        expect(result).toEqual(
          expect.objectContaining({
            isExit: true,
            attempt: expect.objectContaining({
              decision: 'Registrado',
            }) as unknown,
          }),
        );
        expect(result).not.toHaveProperty('requiresApproval');
        expectNoAccessEffects(visits);
      },
    );

    it('register sin dirección en meta -> método neutro y isExit false', async () => {
      cameraWith({ action: 'register' });

      const result = await buildService(visitsSpy()).createDetection(dto, ORG);

      expect(attemptsRepo.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ method: 'Patente - Registro' }),
      );
      expect(result).toEqual(expect.objectContaining({ isExit: false }));
    });

    it('register con dirección entry -> Patente - Entrada', async () => {
      cameraWith({ action: 'register' });

      await buildService(visitsSpy()).createDetection(
        { ...dto, meta: { direction: 'entry' } },
        ORG,
      );

      expect(attemptsRepo.create.mock.calls[0][0]).toEqual(
        expect.objectContaining({ method: 'Patente - Entrada' }),
      );
    });

    it.each([
      ['un valor desconocido', { action: 'otro' }],
      ['un valor corrupto no objeto', 'register'],
      ['un arreglo', []],
    ])(
      'fail-closed: lprSettings con %s tampoco abre el portón',
      async (_name, settings) => {
        cameraWith(settings);
        vehiclesService.findByPlate.mockResolvedValue(activeResident());
        const visits = visitsSpy();

        await buildService(visits).createDetection(dto, ORG);

        expect(lastDecision()).toBe('Registrado');
        expectNoAccessEffects(visits);
      },
    );

    it.each([
      ['null', null],
      ['sin la propiedad', undefined],
      ['action access', { action: 'access', direction: 'both' }],
      ['solo zona', { zone: [] }],
    ])(
      'access (%s): residente activo -> Permitido y abre el portón, como hoy',
      async (_name, settings) => {
        cameraWith(settings);
        vehiclesService.findByPlate.mockResolvedValue(activeResident());

        await buildService(visitsSpy()).createDetection(dto, ORG);

        expect(lastDecision()).toBe('Permitido');
        expect(hubGateway.sendDoorOpen).toHaveBeenCalledTimes(1);
        expect(vehiclesService.findByPlate).toHaveBeenCalledWith(PLATE, {
          organizationId: ORG,
        });
      },
    );

    it('access: patente sin vehículo ni visita sigue escalando al conserje', async () => {
      cameraWith({ action: 'access' });
      const visits = {
        validateAccess: jest
          .fn()
          .mockResolvedValue({ valid: false, message: 'sin visita' }),
      };

      const result = await buildService(visits).createDetection(dto, ORG);

      expect(result).toEqual(
        expect.objectContaining({ requiresApproval: true }),
      );
      expect(hubGateway.sendDoorOpen).not.toHaveBeenCalled();
    });

    describe('D11: normalización de la patente', () => {
      it("'bc-df12' se busca como 'BCDF12', se persiste normalizada y conserva lo recibido en plate_raw", async () => {
        const vehicle = {
          ...activeResident(),
          plate: 'BCDF12',
        };
        vehiclesService.findByPlate.mockImplementation((plate: string) =>
          Promise.resolve(plate === 'BCDF12' ? vehicle : null),
        );

        await buildService(visitsSpy()).createDetection(
          { cameraId: CAMERA_ID, plate: 'bc-df12' },
          ORG,
        );

        expect(vehiclesService.findByPlate).toHaveBeenCalledWith('BCDF12', {
          organizationId: ORG,
        });
        expect(detectionsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ plate: 'BCDF12', plate_raw: 'bc-df12' }),
        );
        expect(lastDecision()).toBe('Permitido');
        expect(hubGateway.sendDoorOpen).toHaveBeenCalledWith(
          expect.anything(),
          { type: 'vehicular', plate: 'BCDF12' },
        );
      });

      it('respeta un plate_raw que ya manda el worker', async () => {
        await buildService(visitsSpy()).createDetection(
          { cameraId: CAMERA_ID, plate: 'bc df12', plate_raw: 'BCDF1A' },
          ORG,
        );

        expect(detectionsRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ plate: 'BCDF12', plate_raw: 'BCDF1A' }),
        );
      });

      it('una patente ya normalizada no se toca (sin plate_raw inventado)', async () => {
        await buildService(visitsSpy()).createDetection(dto, ORG);

        const created = detectionsRepo.create.mock.calls[0][0] as {
          plate_raw?: string;
        };
        expect(created.plate_raw).toBeUndefined();
      });

      it('una patente sin caracteres válidos -> 400 antes de guardar nada', async () => {
        await expect(
          buildService(visitsSpy()).createDetection(
            { cameraId: CAMERA_ID, plate: '---' },
            ORG,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(detectionsRepo.save).not.toHaveBeenCalled();
      });
    });
  });
});
