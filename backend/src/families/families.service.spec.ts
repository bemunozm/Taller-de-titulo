import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { UpdateFamilyDto } from './dto/update-family.dto';
import { FamiliesController } from './families.controller';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { handlerMetadata } from '../test-utils/handler-metadata';
import type { DataSource, Repository } from 'typeorm';
import { FamiliesService } from './families.service';
import type { Family } from './entities/family.entity';
import type { User } from '../users/entities/user.entity';
import type { NotificationsService } from '../notifications/notifications.service';
import type { UnitsService } from '../units/units.service';
import type { TenantContextService } from '../common/tenant/tenant-context.service';
import type { TenantContext } from '../common/tenant/tenant-context.types';
import type { FamilyScope } from '../common/tenant/tenant-actor';
import {
  createTenantContextDouble,
  type TenantContextDouble,
} from '../test-utils/tenant-context.double';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const FAMILY_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const CTX_A: TenantContext = { organizationId: ORG_A, isSuperAdmin: false };

/**
 * Fase 4 · P5.B: una familia solo admite miembros activos de SU condominio, y
 * la lista de usuarios disponibles ya no expone a los usuarios sin familia de
 * toda la plataforma.
 */
describe('FamiliesService — miembros del condominio (P5.B)', () => {
  let ctx: TenantContext;
  let familyRepository: { findOne: jest.Mock };
  let userRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let dataSource: { query: jest.Mock };
  let notificationsService: { create: jest.Mock };
  let service: FamiliesService;

  beforeEach(() => {
    ctx = CTX_A;
    familyRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: FAMILY_ID,
        organizationId: ORG_A,
        name: 'Familia A',
        members: [],
      }),
    };
    userRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'user-a',
        name: 'Residente A',
        family: null,
      }),
      save: jest.fn((user: User) => Promise.resolve(user)),
      createQueryBuilder: jest.fn(),
    };
    // isActiveMemberOfOrganization: [] = no es miembro activo.
    dataSource = { query: jest.fn().mockResolvedValue([]) };
    notificationsService = { create: jest.fn().mockResolvedValue({}) };
    service = new FamiliesService(
      familyRepository as unknown as Repository<Family>,
      userRepository as unknown as Repository<User>,
      notificationsService as unknown as NotificationsService,
      {} as UnitsService,
      {
        getContext: () => Promise.resolve(ctx),
      } as unknown as TenantContextService,
      dataSource as unknown as DataSource,
    );
  });

  describe('POST /families/:id/members (addMember)', () => {
    it('usuario que no es miembro activo del condominio de la familia -> 403 sin tocarlo', async () => {
      await expect(service.addMember(FAMILY_ID, 'user-de-b')).rejects.toThrow(
        ForbiddenException,
      );
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
        'user-de-b',
        ORG_A,
      ]);
      expect(userRepository.findOne).not.toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('miembro activo del condominio: se agrega', async () => {
      dataSource.query.mockResolvedValue([{ ok: 1 }]);

      await service.addMember(FAMILY_ID, 'user-a');

      const [saved] = userRepository.save.mock.calls[0] as [User];
      expect(saved.id).toBe('user-a');
      expect(saved.family?.id).toBe(FAMILY_ID);
    });

    it('familia sin condominio (hasta P5.C) no admite miembros -> 403', async () => {
      familyRepository.findOne.mockResolvedValue({
        id: FAMILY_ID,
        organizationId: null,
        members: [],
      });
      dataSource.query.mockResolvedValue([{ ok: 1 }]);

      await expect(service.addMember(FAMILY_ID, 'user-a')).rejects.toThrow(
        ForbiddenException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('carga masiva con un usuario ajeno -> 403 antes de agregar a nadie', async () => {
      dataSource.query.mockImplementation((_sql: string, params: string[]) =>
        Promise.resolve(params[0] === 'user-a' ? [{ ok: 1 }] : []),
      );

      await expect(
        service.addMembers(FAMILY_ID, ['user-a', 'user-de-b']),
      ).rejects.toThrow(ForbiddenException);
      expect(userRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('GET /families/available-users', () => {
    interface RecordingQb {
      andWhereCalls: Array<[string, Record<string, unknown>?]>;
      where: jest.Mock;
      select: jest.Mock;
      andWhere: jest.Mock;
      getMany: jest.Mock;
    }

    function recordingQb(): RecordingQb {
      const qb: RecordingQb = {
        andWhereCalls: [],
        where: jest.fn(),
        select: jest.fn(),
        andWhere: jest.fn(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      qb.where.mockReturnValue(qb);
      qb.select.mockReturnValue(qb);
      qb.andWhere.mockImplementation(
        (sql: string, params?: Record<string, unknown>) => {
          qb.andWhereCalls.push([sql, params]);
          return qb;
        },
      );
      return qb;
    }

    it('solo usuarios con membresía en el condominio del actor', async () => {
      const qb = recordingQb();
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getAvailableUsers();

      expect(qb.andWhereCalls).toEqual([
        [expect.stringContaining('FROM member m'), { memberOrgId: ORG_A }],
      ]);
    });

    it('super-admin: todos los usuarios sin familia', async () => {
      ctx = { organizationId: null, isSuperAdmin: true };
      const qb = recordingQb();
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getAvailableUsers();

      expect(qb.andWhereCalls).toEqual([]);
      expect(qb.getMany).toHaveBeenCalled();
    });

    it('actor sin condominio: ninguno', async () => {
      ctx = { organizationId: null, isSuperAdmin: false };
      const qb = recordingQb();
      userRepository.createQueryBuilder.mockReturnValue(qb);

      await expect(service.getAvailableUsers()).resolves.toEqual([]);
      expect(qb.getMany).not.toHaveBeenCalled();
    });
  });
});

/**
 * Fase 4 · P5.C: alcance por familia (sin `condominium.view-all`, el
 * Residente solo ve su propia familia) y creación estricta.
 */
describe('FamiliesService — alcance por familia y creación estricta (P5.C)', () => {
  const ORG_B = '22222222-2222-4222-8222-222222222222';
  const OWN_FAMILY = 'aaaaaaaa-0000-4000-8000-000000000001';
  const NEIGHBOR_FAMILY = 'aaaaaaaa-0000-4000-8000-000000000002';
  const RESIDENT: FamilyScope = { userId: 'res-1', familyId: OWN_FAMILY };
  let tenantContext: TenantContextDouble;
  let familyRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let unitsService: { findOne: jest.Mock };
  let userRepository: { createQueryBuilder: jest.Mock };
  let service: FamiliesService;

  beforeEach(() => {
    tenantContext = createTenantContextDouble(CTX_A, [ORG_A, ORG_B]);
    familyRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn((options: { where: { id: string } }) =>
        Promise.resolve({
          id: options.where.id,
          organizationId: ORG_A,
          name: 'Familia',
          members: [],
        }),
      ),
      create: jest.fn((data: Partial<Family>) => ({ ...data }) as Family),
      save: jest.fn((family: Family) => Promise.resolve(family)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    unitsService = {
      findOne: jest.fn().mockResolvedValue({
        id: 'unit-1',
        identifier: 'A-101',
        organizationId: ORG_A,
      }),
    };
    userRepository = { createQueryBuilder: jest.fn() };
    service = new FamiliesService(
      familyRepository as unknown as Repository<Family>,
      userRepository as unknown as Repository<User>,
      { create: jest.fn() } as unknown as NotificationsService,
      unitsService as unknown as UnitsService,
      tenantContext as unknown as TenantContextService,
      { query: jest.fn().mockResolvedValue([]) } as unknown as DataSource,
    );
  });

  it('GET /families de un residente: solo su familia', async () => {
    await service.findAll(RESIDENT);

    expect(familyRepository.find).toHaveBeenCalledWith({
      where: { id: OWN_FAMILY, organizationId: ORG_A },
      relations: ['members'],
    });
  });

  it('GET /families de un residente sin familia: vacío, sin consultar', async () => {
    await expect(
      service.findAll({ userId: 'res-solo', familyId: null }),
    ).resolves.toEqual([]);
    expect(familyRepository.find).not.toHaveBeenCalled();
  });

  it('GET /families con condominium.view-all: todas las del condominio', async () => {
    await service.findAll(null);

    expect(familyRepository.find).toHaveBeenCalledWith({
      where: { organizationId: ORG_A },
      relations: ['members'],
    });
  });

  it('GET /families/:id de la familia de un vecino del mismo condominio -> 404', async () => {
    await expect(service.findOne(NEIGHBOR_FAMILY, RESIDENT)).rejects.toThrow(
      NotFoundException,
    );
    expect(familyRepository.findOne).not.toHaveBeenCalled();
    await expect(service.findOne(OWN_FAMILY, RESIDENT)).resolves.toMatchObject({
      id: OWN_FAMILY,
    });
  });

  it('PATCH / DELETE de la familia de un vecino con el alcance por familia -> 404', async () => {
    await expect(
      service.update(NEIGHBOR_FAMILY, { name: 'X' }, RESIDENT),
    ).rejects.toThrow(NotFoundException);
    await expect(service.remove(NEIGHBOR_FAMILY, RESIDENT)).rejects.toThrow(
      NotFoundException,
    );
    expect(familyRepository.save).not.toHaveBeenCalled();
    expect(familyRepository.remove).not.toHaveBeenCalled();
  });

  it('available-users para un residente: vacío (son usuarios de otras familias, con email y RUT)', async () => {
    await expect(service.getAvailableUsers(RESIDENT)).resolves.toEqual([]);
    expect(userRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  describe('POST /families (creación estricta)', () => {
    it('del actor: queda en su condominio', async () => {
      await service.create({ name: 'Familia Nueva' });

      expect(familyRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Familia Nueva',
          organizationId: ORG_A,
        }),
      );
    });

    it('actor sin condominio -> 403 sin guardar', async () => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: false,
      });

      await expect(service.create({ name: 'F' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(familyRepository.save).not.toHaveBeenCalled();
    });

    it('actor que no es super-admin y envía organizationId -> 403', async () => {
      await expect(
        service.create({ name: 'F', organizationId: ORG_B }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('super-admin: sin organizationId -> 400; con él -> ese condominio', async () => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: true,
      });

      await expect(service.create({ name: 'F' })).rejects.toThrow(
        BadRequestException,
      );

      await service.create({ name: 'F', organizationId: ORG_B });
      expect(familyRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG_B }),
      );
    });

    it('super-admin: la unidad debe ser del condominio de la familia -> 400', async () => {
      tenantContext.getContext.mockResolvedValue({
        organizationId: null,
        isSuperAdmin: true,
      });

      await expect(
        service.create({ name: 'F', organizationId: ORG_B, unitId: 'unit-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(familyRepository.save).not.toHaveBeenCalled();
    });
  });
});

/**
 * Corrección P5 (cyber B7 / QA A3): `PATCH /families/:id` con un DTO validado
 * (`UpdateFamilyDto`) y `digitalConciergeEnabled` asignable (antes ninguna
 * API activaba el Conserje Digital).
 */
describe('UpdateFamilyDto y digitalConciergeEnabled (corrección P5)', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  function validate(body: Record<string, unknown>): Promise<unknown> {
    return pipe.transform(body, { type: 'body', metatype: UpdateFamilyDto });
  }

  it('valida los campos (antes Partial<CreateFamilyDto> no validaba nada)', async () => {
    await expect(validate({ name: 123 })).rejects.toThrow(BadRequestException);
    await expect(validate({ unitId: 'no-uuid' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(validate({ campoExtra: true })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('no acepta organizationId (una familia no cambia de condominio)', async () => {
    await expect(
      validate({ organizationId: '22222222-2222-4222-8222-222222222222' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('digitalConciergeEnabled: booleano', async () => {
    await expect(validate({ digitalConciergeEnabled: 'si' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(validate({ digitalConciergeEnabled: true })).resolves.toEqual(
      expect.objectContaining({ digitalConciergeEnabled: true }),
    );
  });

  it('el servicio guarda digitalConciergeEnabled (lo lee el hub en /units/ai-enabled)', async () => {
    const save = jest.fn((family: Family) => Promise.resolve(family));
    const service = new FamiliesService(
      {
        findOne: jest.fn().mockResolvedValue({
          id: FAMILY_ID,
          organizationId: ORG_A,
          name: 'Familia A',
          digitalConciergeEnabled: false,
          members: [],
        }),
        save,
      } as unknown as Repository<Family>,
      {} as Repository<User>,
      {} as NotificationsService,
      {} as UnitsService,
      createTenantContextDouble(CTX_A) as unknown as TenantContextService,
      {} as DataSource,
    );

    await service.update(FAMILY_ID, { digitalConciergeEnabled: true });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ id: FAMILY_ID, digitalConciergeEnabled: true }),
    );
  });

  it('PATCH /families/:id exige families.update (la única vía para activarlo)', () => {
    expect(
      handlerMetadata(FamiliesController, 'update', PERMISSIONS_KEY),
    ).toEqual(['families.update']);
  });
});
