import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubsService } from './hub.service';
import { Hub, HubType } from './entities/hub.entity';
import { CreateHubDto } from './dto/create-hub.dto';
import { HubGateway } from './hub.gateway';

/**
 * Tarea "kiosko web como device del condominio" (2026-07-12): cubre el
 * provisioning de un `Hub` de tipo `web-kiosk` (totem web de
 * `/digital-concierge`, sin control de relés GPIO) además del flujo
 * `physical-hub` ya existente — retrocompat: omitir `type` debe seguir
 * provisionando un `physical-hub`.
 */
describe('HubsService', () => {
  let service: HubsService;
  let hubRepository: jest.Mocked<Repository<Hub>>;
  let hubGateway: { disconnectHub: jest.Mock };

  const baseDto: CreateHubDto = {
    hubId: 'hub-001',
    location: 'Edificio A - Panel de Calle',
    organizationId: '11111111-1111-4111-8111-111111111111',
  };

  beforeEach(async () => {
    hubGateway = { disconnectHub: jest.fn().mockReturnValue(true) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubsService,
        {
          provide: getRepositoryToken(Hub),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((input) => input),
            save: jest.fn((input) =>
              Promise.resolve({ id: 'generated-id', ...input }),
            ),
          },
        },
        { provide: HubGateway, useValue: hubGateway },
      ],
    }).compile();

    service = module.get(HubsService);
    hubRepository = module.get(getRepositoryToken(Hub));
  });

  describe('provision', () => {
    it('provisiona un physical-hub por defecto cuando no se envía "type" (retrocompat)', async () => {
      hubRepository.findOne.mockResolvedValue(null);

      const { hub, secret } = await service.provision({ ...baseDto });

      expect(hub.type).toBe(HubType.PHYSICAL_HUB);
      expect(secret).toEqual(expect.any(String));
      expect(secret.length).toBeGreaterThan(0);
      expect(
        (hub as unknown as Hub & { secretHash?: string }).secretHash,
      ).toBeUndefined();
    });

    it('provisiona un web-kiosk cuando se envía type="web-kiosk"', async () => {
      hubRepository.findOne.mockResolvedValue(null);

      const { hub } = await service.provision({
        ...baseDto,
        hubId: 'kiosk-001',
        type: HubType.WEB_KIOSK,
      });

      expect(hub.type).toBe(HubType.WEB_KIOSK);
      expect(hub.hubId).toBe('kiosk-001');
      expect(hub.organizationId).toBe(baseDto.organizationId);
    });

    it('genera y devuelve el secret en claro una sola vez, sin persistirlo', async () => {
      hubRepository.findOne.mockResolvedValue(null);

      const { hub, secret } = await service.provision({
        ...baseDto,
        type: HubType.WEB_KIOSK,
      });

      expect(secret).toBeDefined();
      expect(hubRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ secretHash: expect.any(String) }),
      );
      expect(
        (hub as unknown as Hub & { secretHash?: string }).secretHash,
      ).toBeUndefined();
    });

    it('rechaza un hubId duplicado sin importar el type', async () => {
      hubRepository.findOne.mockResolvedValue({ hubId: 'hub-001' } as Hub);

      await expect(
        service.provision({ ...baseDto, type: HubType.WEB_KIOSK }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByHubId', () => {
    it('lanza NotFoundException si el hub no existe', async () => {
      hubRepository.findOne.mockResolvedValue(null);
      await expect(service.findByHubId('inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /**
   * Fase 4 · P4: un socket autenticado con una identidad que ya no vale
   * (secret rotado, hub desactivado, tipo o condominio cambiados) se corta.
   */
  describe('desconexión del socket conectado', () => {
    const existingHub = (): Hub =>
      ({
        id: 'hub-row-1',
        hubId: 'hub-001',
        type: HubType.PHYSICAL_HUB,
        organizationId: baseDto.organizationId,
        secretHash: 'hash-viejo',
        active: true,
        location: 'Portón',
      }) as Hub;

    it('rotate-secret desconecta el socket del hub, después de guardar el secret nuevo', async () => {
      hubRepository.findOne.mockResolvedValue(existingHub());

      const { secret } = await service.rotateSecret('hub-001');

      expect(secret).toEqual(expect.any(String));
      expect(hubGateway.disconnectHub).toHaveBeenCalledWith(
        'hub-001',
        'secret rotado',
      );
      expect(hubRepository.save.mock.invocationCallOrder[0]).toBeLessThan(
        hubGateway.disconnectHub.mock.invocationCallOrder[0],
      );
    });

    it('PATCH active:false desconecta el socket', async () => {
      hubRepository.findOne.mockResolvedValue(existingHub());

      await service.update('hub-001', { active: false });

      expect(hubGateway.disconnectHub).toHaveBeenCalledWith(
        'hub-001',
        'hub desactivado',
      );
    });

    it('PATCH que cambia el type (physical-hub -> web-kiosk) desconecta el socket', async () => {
      hubRepository.findOne.mockResolvedValue(existingHub());

      await service.update('hub-001', { type: HubType.WEB_KIOSK });

      expect(hubGateway.disconnectHub).toHaveBeenCalledWith(
        'hub-001',
        expect.stringContaining('tipo cambiado'),
      );
    });

    it('PATCH que cambia el condominio desconecta el socket', async () => {
      hubRepository.findOne.mockResolvedValue(existingHub());

      await service.update('hub-001', {
        organizationId: '22222222-2222-4222-8222-222222222222',
      });

      expect(hubGateway.disconnectHub).toHaveBeenCalledWith(
        'hub-001',
        'condominio cambiado',
      );
    });

    it('PATCH que no toca la identidad (p. ej. location) NO desconecta', async () => {
      hubRepository.findOne.mockResolvedValue(existingHub());

      await service.update('hub-001', { location: 'Portón norte' });

      expect(hubGateway.disconnectHub).not.toHaveBeenCalled();
    });
  });
});

/**
 * Corrección P5 (QA A3): aviso al arrancar con el conteo de hubs ACTIVOS sin
 * condominio (no ven unidades ni residentes desde la P5.C).
 */
describe('HubsService — aviso de hubs sin condominio (corrección P5)', () => {
  let count: jest.Mock;
  let service: HubsService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    count = jest.fn();
    service = new HubsService(
      { count } as unknown as Repository<Hub>,
      {} as HubGateway,
    );
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('con hubs activos sin condominio: avisa con el conteo', async () => {
    count.mockResolvedValue(2);

    await service.onApplicationBootstrap();

    const [[options]] = count.mock.calls as Array<
      [{ where: { active: boolean; organizationId: { type: string } } }]
    >;
    expect(options.where.active).toBe(true);
    expect(options.where.organizationId.type).toBe('isNull');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 hub(s)'));
  });

  it('sin hubs huérfanos: no avisa', async () => {
    count.mockResolvedValue(0);

    await expect(service.warnAboutHubsWithoutOrganization()).resolves.toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('si la consulta falla, no rompe el arranque', async () => {
    count.mockRejectedValue(new Error('db down'));

    await expect(
      service.warnAboutHubsWithoutOrganization(),
    ).resolves.toBeNull();
  });
});
