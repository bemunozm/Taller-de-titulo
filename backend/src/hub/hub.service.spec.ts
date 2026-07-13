import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubsService } from './hub.service';
import { Hub, HubType } from './entities/hub.entity';
import { CreateHubDto } from './dto/create-hub.dto';

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

  const baseDto: CreateHubDto = {
    hubId: 'hub-001',
    location: 'Edificio A - Panel de Calle',
    organizationId: '11111111-1111-4111-8111-111111111111',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubsService,
        {
          provide: getRepositoryToken(Hub),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((input) => input),
            save: jest.fn((input) => Promise.resolve({ id: 'generated-id', ...input })),
          },
        },
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
      expect((hub as unknown as Hub & { secretHash?: string }).secretHash).toBeUndefined();
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

      const { hub, secret } = await service.provision({ ...baseDto, type: HubType.WEB_KIOSK });

      expect(secret).toBeDefined();
      expect(hubRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ secretHash: expect.any(String) }),
      );
      expect((hub as unknown as Hub & { secretHash?: string }).secretHash).toBeUndefined();
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
      await expect(service.findByHubId('inexistente')).rejects.toThrow(NotFoundException);
    });
  });
});
