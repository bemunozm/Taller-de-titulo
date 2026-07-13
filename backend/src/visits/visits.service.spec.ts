import { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { VisitsService } from './visits.service';
import { Visit, VisitStatus, VisitType } from './entities/visit.entity';
import { CreateVisitDto } from './dto/create-visit.dto';
import { UpdateVisitDto } from './dto/update-visit.dto';
import { UsersService } from '../users/users.service';
import { FamiliesService } from '../families/families.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { User } from '../users/entities/user.entity';

/**
 * Cierre de fases 1-2 (follow-up post-auditoría) — FIX 1: escritura
 * cross-tenant vía `hostId`. `UsersService.findOne` que resuelve el host NO
 * está scopeado por tenant (a propósito, ver docstring de
 * `VisitsService.assertHostBelongsToCreatorTenant`), así que sin esta
 * validación un admin del condominio A podía pasar el `hostId` de un usuario
 * del condominio B y `create`/`update` atribuían el recurso a B.
 *
 * Se instancia `VisitsService` directamente (sin `Test.createTestingModule`)
 * porque sus dependencias son providers planos — más simple mockear a mano
 * dado que `TenantContextService` es REQUEST-scoped y no aporta valor
 * levantar el DI container completo solo para esto.
 */
describe('VisitsService — aislamiento cross-tenant por hostId', () => {
  let service: VisitsService;
  let visitRepository: jest.Mocked<Pick<Repository<Visit>, 'create' | 'save' | 'findOne'>>;
  let vehicleRepository: jest.Mocked<Pick<Repository<Vehicle>, 'create' | 'save' | 'findOne'>>;
  let usersService: jest.Mocked<Pick<UsersService, 'findOne'>>;
  let vehiclesService: jest.Mocked<Pick<VehiclesService, 'findByPlate' | 'update' | 'create'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'create'>>;
  let tenantContext: jest.Mocked<Pick<TenantContextService, 'getContext'>>;

  const buildHost = (organizationId: string | null): User =>
    ({
      id: 'host-1',
      name: 'Host Uno',
      family: { id: 'family-1', organizationId },
    }) as unknown as User;

  const baseCreateDto: CreateVisitDto = {
    type: VisitType.PEDESTRIAN,
    visitorName: 'Visitante Test',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    hostId: 'host-1',
  };

  const setCtx = (ctx: TenantContext) => {
    tenantContext.getContext.mockResolvedValue(ctx);
  };

  beforeEach(() => {
    visitRepository = {
      create: jest.fn((data) => data as unknown as Visit),
      save: jest.fn(async (visit) => visit as Visit),
      findOne: jest.fn(),
    };
    vehicleRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };
    usersService = { findOne: jest.fn() };
    vehiclesService = {
      findByPlate: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    };
    notificationsService = { create: jest.fn().mockResolvedValue({}) };
    tenantContext = { getContext: jest.fn() };

    service = new VisitsService(
      visitRepository as unknown as Repository<Visit>,
      vehicleRepository as unknown as Repository<Vehicle>,
      usersService as unknown as UsersService,
      {} as FamiliesService,
      vehiclesService as unknown as VehiclesService,
      notificationsService as unknown as NotificationsService,
      tenantContext as unknown as TenantContextService,
    );
  });

  describe('create', () => {
    it('rechaza cuando el host resuelto pertenece a otro condominio que el creador autenticado', async () => {
      usersService.findOne.mockResolvedValue(buildHost('org-B'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      await expect(service.create(baseCreateDto)).rejects.toThrow(ForbiddenException);
      expect(visitRepository.save).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('permite crear la visita cuando el host pertenece al mismo condominio que el creador', async () => {
      usersService.findOne.mockResolvedValue(buildHost('org-A'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      await expect(service.create(baseCreateDto)).resolves.toBeDefined();
      expect(visitRepository.save).toHaveBeenCalled();
    });

    it('permite a un super-admin crear la visita sin importar el condominio del host', async () => {
      usersService.findOne.mockResolvedValue(buildHost('org-B'));
      setCtx({ organizationId: null, isSuperAdmin: true });

      await expect(service.create(baseCreateDto)).resolves.toBeDefined();
      expect(visitRepository.save).toHaveBeenCalled();
    });

    it('no rompe a los callers sin sesión de usuario (Conserje Digital / worker LPR)', async () => {
      // EMPTY_TENANT_CONTEXT: sin request.user no hay un "creador" humano que
      // validar — el tenant se deriva íntegramente del recurso (familia del host).
      usersService.findOne.mockResolvedValue(buildHost('org-B'));
      setCtx({ organizationId: null, isSuperAdmin: false });

      await expect(service.create(baseCreateDto)).resolves.toBeDefined();
      expect(visitRepository.save).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const existingVisit = {
      id: 'visit-1',
      host: buildHost('org-A'),
      family: { id: 'family-1', organizationId: 'org-A' },
      status: VisitStatus.PENDING,
    } as unknown as Visit;

    it('rechaza reasignar el host a un usuario de otro condominio', async () => {
      visitRepository.findOne.mockResolvedValue(existingVisit);
      usersService.findOne.mockResolvedValue(buildHost('org-B'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      const dto: UpdateVisitDto = { hostId: 'host-2' };

      await expect(service.update('visit-1', dto)).rejects.toThrow(ForbiddenException);
      expect(visitRepository.save).not.toHaveBeenCalled();
    });

    it('permite reasignar el host a un usuario del mismo condominio', async () => {
      visitRepository.findOne.mockResolvedValue(existingVisit);
      usersService.findOne.mockResolvedValue(buildHost('org-A'));
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      const dto: UpdateVisitDto = { hostId: 'host-2' };

      await expect(service.update('visit-1', dto)).resolves.toBeDefined();
      expect(visitRepository.save).toHaveBeenCalled();
    });
  });

  /**
   * FIX cross-tenant (rama feature/cierre-fases-1-2): apertura autónoma del
   * portón por visita vehicular pre-aprobada. `DetectionsService` (ver su
   * spec, describe 'apertura autónoma...') llamaba a
   * `validateAccess(plate, 'plate', { skipTenantScope: true })`, que delega en
   * `findByPlate`. Este describe caracteriza el comportamiento REAL de
   * `findByPlate` frente al scoping por tenant, usando un mock de
   * QueryBuilder (createQueryBuilder/leftJoinAndSelect/where/andWhere/getOne
   * encadenados) porque el método arma la query manualmente en vez de usar
   * `repository.find`.
   *
   * HALLAZGO ORIGINAL (ya corregido — ver commits de esta rama): con
   * `skipTenantScope: true` (el modo que usaba TODO el camino del worker LPR)
   * la query no agregaba ningún filtro por `organizationId` — buscaba la
   * patente en TODOS los condominios de la plataforma. En la práctica: una
   * visita vehicular pre-aprobada creada en el condominio B con la patente X
   * abría el portón del condominio A si una cámara de A detectaba esa misma
   * patente X.
   *
   * FIX: `DetectionsService.createDetection` ahora pasa `organizationId`
   * (el de la CÁMARA que detectó la patente, resource-derived) en vez de
   * `skipTenantScope`. `findByPlate`/`validateAccess` aceptan este scope
   * explícito y lo aplican vía `applyTenantFilter` con un `TenantContext`
   * sintético `{ organizationId, isSuperAdmin: false }` — la query SÍ filtra
   * por ese condominio específico, sin necesidad de `TenantContextService`
   * (que no puede resolver nada sin `request.user`). `skipTenantScope` queda
   * reservado para call-sites que de verdad no tienen NINGÚN tenant confiable
   * (p.ej. Conserje Digital, visitante anónimo en el citófono).
   */
  describe('findByPlate — aislamiento tenant', () => {
    let qb: {
      leftJoinAndSelect: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      getOne: jest.Mock;
    };

    beforeEach(() => {
      qb = {
        leftJoinAndSelect: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      // Encadenable: cada método de la query devuelve el mismo mock.
      qb.leftJoinAndSelect.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);

      (visitRepository as unknown as { createQueryBuilder: jest.Mock }).createQueryBuilder = jest
        .fn()
        .mockReturnValue(qb);
    });

    it('[FIX] con organizationId explícito (camino LPR tras el fix) SÍ filtra por ESE condominio, sin consultar TenantContextService', async () => {
      await service.findByPlate('ABCD12', { organizationId: 'org-camara-A' });

      // El worker LPR no tiene request.user — el scope viene explícito desde
      // afuera (organizationId de la CÁMARA), no se resuelve ningún contexto.
      expect(tenantContext.getContext).not.toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith('visit."organizationId" = :tenantOrgId', {
        tenantOrgId: 'org-camara-A',
      });
    });

    it('[FIX] patente de una visita de OTRO condominio (B) no matchea cuando se busca scopeado al condominio de la cámara (A)', async () => {
      // El mock de queryBuilder no ejecuta SQL real, así que "no matchea" se
      // verifica a nivel de contrato: el filtro aplicado exige
      // organizationId = 'org-A' exacto (no 'org-B', no ausencia de filtro).
      // getOne() devuelve null (setup del beforeEach) — equivalente a que la
      // fila de la visita de 'org-B' no calce con esa condición SQL.
      const visit = await service.findByPlate('ABCD12', { organizationId: 'org-A' });

      expect(qb.andWhere).toHaveBeenCalledWith('visit."organizationId" = :tenantOrgId', {
        tenantOrgId: 'org-A',
      });
      expect(qb.andWhere).not.toHaveBeenCalledWith('visit."organizationId" = :tenantOrgId', {
        tenantOrgId: 'org-B',
      });
      expect(visit).toBeNull();
    });

    it('skipTenantScope sigue sin filtrar por organizationId — reservado para call-sites SIN ningún tenant confiable (Conserje Digital), ya NO usado por el camino LPR', async () => {
      await service.findByPlate('ABCD12', { skipTenantScope: true });

      expect(tenantContext.getContext).not.toHaveBeenCalled();

      // Los únicos andWhere aplicados son estado + ventana de validez, NUNCA
      // uno que referencie organizationId.
      const andWhereClauses = qb.andWhere.mock.calls.map((call) => call[0] as string);
      expect(andWhereClauses.some((clause) => clause.includes('organizationId'))).toBe(false);
      expect(andWhereClauses).toEqual([
        'visit.status IN (:...statuses)',
        'visit.validFrom <= :now',
        'visit.validUntil >= :now',
      ]);
    });

    it('con sesión de usuario (sin skipTenantScope ni organizationId explícito) SÍ filtra por el organizationId del contexto tenant', async () => {
      setCtx({ organizationId: 'org-A', isSuperAdmin: false });

      await service.findByPlate('ABCD12');

      expect(tenantContext.getContext).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith('visit."organizationId" = :tenantOrgId', {
        tenantOrgId: 'org-A',
      });
    });

    it('super-admin (sin skipTenantScope) tampoco filtra por organizationId — bypass real intencional', async () => {
      setCtx({ organizationId: null, isSuperAdmin: true });

      await service.findByPlate('ABCD12');

      const andWhereClauses = qb.andWhere.mock.calls.map((call) => call[0] as string);
      expect(andWhereClauses.some((clause) => clause.includes('organizationId'))).toBe(false);
    });
  });
});
