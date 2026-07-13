import type { Repository } from 'typeorm';
import { VehiclesService } from './vehicles.service';
import { Vehicle } from './entities/vehicle.entity';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantContextService } from '../common/tenant/tenant-context.service';

/**
 * FIX cross-tenant (rama feature/cierre-fases-1-2): `VehiclesService.findByPlate`
 * no tenía NINGÚN scoping por tenant (a diferencia de `create`/`listAll`) — lo
 * usa `DetectionsService` en el camino de apertura autónoma del portón (worker
 * LPR, sin request.user), y antes del fix buscaba la patente en TODOS los
 * condominios de la plataforma. Un vehículo residente activo del condominio B
 * podía abrir el portón físico del condominio A si una cámara de A leía esa
 * misma patente.
 *
 * FIX: `findByPlate` acepta ahora un `organizationId` EXPLÍCITO opcional —
 * cuando se provee (camino LPR, con el organizationId de la CÁMARA que
 * detectó la patente), acota el `where` de TypeORM a ESE condominio. Sin el
 * parámetro, el comportamiento es exactamente el mismo que antes del fix
 * (búsqueda global), para no romper a los demás callers (VisitsService.create/
 * update) que resuelven/crean el vehículo por patente sin conocer un tenant de
 * referencia.
 */
describe('VehiclesService — aislamiento cross-tenant en findByPlate', () => {
  let service: VehiclesService;
  let repo: jest.Mocked<Pick<Repository<Vehicle>, 'findOne'>>;

  beforeEach(() => {
    repo = { findOne: jest.fn().mockResolvedValue(null) };

    service = new VehiclesService(
      repo as unknown as Repository<Vehicle>,
      {} as UsersService,
      {} as NotificationsService,
      {} as TenantContextService,
    );
  });

  it('sin organizationId (comportamiento previo preservado) busca la patente sin ningún filtro adicional', async () => {
    await service.findByPlate('ABCD12');

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { plate: 'ABCD12' },
      relations: ['owner'],
    });
  });

  it('[FIX] con organizationId explícito (camino LPR, organizationId de la CÁMARA) acota el where a ESE condominio', async () => {
    await service.findByPlate('ABCD12', { organizationId: 'org-camara-A' });

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { plate: 'ABCD12', organizationId: 'org-camara-A' },
      relations: ['owner'],
    });
  });

  it('[FIX] un vehículo de OTRO condominio (B) no matchea cuando se busca scopeado al condominio de la cámara (A)', async () => {
    // El where exige organizationId = 'org-A' exacto — un vehículo real con
    // organizationId = 'org-B' nunca cumpliría esa condición en la BD (TypeORM
    // traduce el objeto where en un AND por columna). Se verifica a nivel de
    // contrato (mock de repo) que el filtro nunca se relaja a 'org-B' ni se
    // omite.
    const vehicle = await service.findByPlate('ABCD12', { organizationId: 'org-A' });

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { plate: 'ABCD12', organizationId: 'org-A' },
      relations: ['owner'],
    });
    expect(repo.findOne).not.toHaveBeenCalledWith({
      where: { plate: 'ABCD12', organizationId: 'org-B' },
      relations: ['owner'],
    });
    expect(vehicle).toBeNull();
  });
});
