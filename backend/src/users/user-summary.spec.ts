import type { TenantActor } from '../common/tenant/tenant-actor';
import type { TenantContextService } from '../common/tenant/tenant-context.service';
import { DetectionsController } from '../detections/detections.controller';
import type { DetectionsService } from '../detections/detections.service';
import type { AccessAttempt } from '../detections/entities/access-attempt.entity';
import { FamiliesController } from '../families/families.controller';
import type { FamiliesService } from '../families/families.service';
import type { Family } from '../families/entities/family.entity';
import { UnitsController } from '../units/units.controller';
import type { UnitsService } from '../units/units.service';
import type { Unit } from '../units/entities/unit.entity';
import { VehiclesController } from '../vehicles/vehicles.controller';
import type { VehiclesService } from '../vehicles/vehicles.service';
import type { Vehicle } from '../vehicles/entities/vehicle.entity';
import type { User } from './entities/user.entity';
import {
  canSeeUserDetail,
  embeddedUserFor,
  optionalEmbeddedUserFor,
  toUserSummary,
} from './user-summary';

const ORG = '11111111-1111-4111-8111-111111111111';

function actor(
  permissions: string[],
  familyId: string | null = null,
): TenantActor {
  return {
    userId: 'actor-1',
    organizationId: ORG,
    isSuperAdmin: false,
    permissionNames: new Set(permissions),
    familyId,
  };
}

/** Conserje: ve todo el condominio pero NO el detalle de usuarios. */
const CONCIERGE = actor(['condominium.view-all', 'users.read']);
/** Administrador: `users.update` -> detalle completo. */
const ADMIN = actor(['condominium.view-all', 'users.update']);
/** Residente: sin view-all ni users.update. */
const RESIDENT = actor(['vehicles.read'], 'fam-1');

function fullUser(id: string): User {
  return {
    id,
    name: `Nombre ${id}`,
    email: `${id}@x.cl`,
    rut: '11111111-1',
    phone: '+56900000000',
    roles: [],
  } as unknown as User;
}

/**
 * Corrección P5 (cyber B3 / QA): los `User` embebidos en familias, visitas,
 * vehículos, unidades y detecciones van como `{ id, name }` para quien no
 * tiene `users.update` (helper compartido `embeddedUserFor`).
 */
describe('Resumen de usuarios embebidos (corrección P5)', () => {
  it('canSeeUserDetail: super-admin o users.update', () => {
    expect(canSeeUserDetail(ADMIN)).toBe(true);
    expect(canSeeUserDetail({ ...CONCIERGE, isSuperAdmin: true })).toBe(true);
    expect(canSeeUserDetail(CONCIERGE)).toBe(false);
    expect(canSeeUserDetail(RESIDENT)).toBe(false);
  });

  it('embeddedUserFor / optionalEmbeddedUserFor', () => {
    const user = fullUser('u-1');
    expect(embeddedUserFor(user, ADMIN)).toBe(user);
    expect(embeddedUserFor(user, CONCIERGE)).toEqual({
      id: 'u-1',
      name: 'Nombre u-1',
    });
    expect(toUserSummary(user)).toEqual({ id: 'u-1', name: 'Nombre u-1' });
    expect(optionalEmbeddedUserFor(null, CONCIERGE)).toBeNull();
    expect(optionalEmbeddedUserFor(undefined, CONCIERGE)).toBeUndefined();
  });

  it('vehículos: el propietario va resumido para el Conserje y completo para el Administrador', async () => {
    const listAll = jest.fn(() =>
      Promise.resolve([{ id: 'veh-1', owner: fullUser('owner-1') } as Vehicle]),
    );
    const controller = new VehiclesController({
      listAll,
    } as unknown as VehiclesService);

    const [forConcierge] = await controller.list(CONCIERGE);
    const [forAdmin] = await controller.list(ADMIN);

    expect(forConcierge.owner).toEqual({
      id: 'owner-1',
      name: 'Nombre owner-1',
    });
    expect(forAdmin.owner).toEqual(
      expect.objectContaining({ email: 'owner-1@x.cl' }),
    );
  });

  it('familias: los miembros van resumidos sin users.update (también para el Residente)', async () => {
    const findAll = jest.fn(() =>
      Promise.resolve([
        { id: 'fam-1', members: [fullUser('m-1'), fullUser('m-2')] } as Family,
      ]),
    );
    const controller = new FamiliesController({
      findAll,
    } as unknown as FamiliesService);

    const [family] = await controller.findAll(RESIDENT);

    expect(family.members).toEqual([
      { id: 'm-1', name: 'Nombre m-1' },
      { id: 'm-2', name: 'Nombre m-2' },
    ]);
  });

  it('familias: available-users va como { id, name } sin users.update (QA R3); completo con users.update', async () => {
    const getAvailableUsers = jest.fn(() =>
      Promise.resolve([fullUser('libre-1')]),
    );
    const controller = new FamiliesController({
      getAvailableUsers,
    } as unknown as FamiliesService);

    await expect(controller.getAvailableUsers(CONCIERGE)).resolves.toEqual([
      { id: 'libre-1', name: 'Nombre libre-1' },
    ]);
    const [forAdmin] = await controller.getAvailableUsers(ADMIN);
    expect(forAdmin).toEqual(
      expect.objectContaining({ email: 'libre-1@x.cl' }),
    );
  });

  describe('unidades (corrección P5, cyber M2)', () => {
    function unitWithMembers(): Unit {
      return {
        id: 'unit-1',
        families: [{ id: 'fam-1', members: [fullUser('m-1')] } as Family],
      } as Unit;
    }

    it('sin condominium.view-all: no se cargan los miembros', async () => {
      const findOne = jest.fn(() =>
        Promise.resolve({ id: 'unit-1', families: [] } as unknown as Unit),
      );
      const findByIdentifier = jest.fn(() => Promise.resolve(null));
      const controller = new UnitsController({
        findOne,
        findByIdentifier,
      } as unknown as UnitsService);

      await controller.findOne('unit-1', RESIDENT);
      await controller.findByIdentifier('A-101', RESIDENT);

      expect(findOne).toHaveBeenCalledWith('unit-1', { includeMembers: false });
      expect(findByIdentifier).toHaveBeenCalledWith('A-101', {
        includeMembers: false,
      });
    });

    it('con condominium.view-all: se cargan, resumidos para el Conserje', async () => {
      const findOne = jest.fn(() => Promise.resolve(unitWithMembers()));
      const controller = new UnitsController({
        findOne,
      } as unknown as UnitsService);

      const unit = await controller.findOne('unit-1', CONCIERGE);

      expect(findOne).toHaveBeenCalledWith('unit-1', { includeMembers: true });
      expect(unit.families[0].members).toEqual([
        { id: 'm-1', name: 'Nombre m-1' },
      ]);
    });
  });

  it('detecciones: el residente de los intentos de acceso va resumido sin users.update', async () => {
    const listAttempts = jest.fn(() =>
      Promise.resolve([
        { id: 'att-1', residente: fullUser('res-1') } as AccessAttempt,
        { id: 'att-2', residente: null } as AccessAttempt,
      ]),
    );
    const controller = new DetectionsController(
      { listAttempts } as unknown as DetectionsService,
      {
        getContext: () =>
          Promise.resolve({ organizationId: ORG, isSuperAdmin: false }),
      } as unknown as TenantContextService,
    );

    const attempts = await controller.listAttempts(CONCIERGE);

    expect(attempts[0].residente).toEqual({
      id: 'res-1',
      name: 'Nombre res-1',
    });
    expect(attempts[1].residente).toBeNull();
  });
});
