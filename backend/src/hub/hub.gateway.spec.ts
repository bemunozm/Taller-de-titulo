import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubGateway } from './hub.gateway';
import { Hub } from './entities/hub.entity';
import { hashPassword } from '../auth/utils/auth.util';

/**
 * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — hallazgos H1
 * y H2 de la auditoría de seguridad). Antes de esta tarea `HubGateway` no
 * tenía NINGUNA cobertura de tests (ver blast-radius del codebase-explorer).
 *
 * Cubre:
 *  - H1: el handshake WS valida el `hubSecret` contra el `secretHash` PROPIO
 *    del hub identificado por `hubId` — un hub no puede autenticarse con el
 *    secret de otro hub (impersonación), ni con un hubId inexistente.
 *  - H2: `sendToOrganization` dirige el evento SOLO a los hubs conectados
 *    cuya `organizationId` coincide — nunca cruza el límite de tenant, y no
 *    hace nada si `organizationId` es `null` (evita el "cajón nulo").
 */
describe('HubGateway', () => {
  let gateway: HubGateway;
  let hubRepository: jest.Mocked<Repository<Hub>>;

  const ORG_A = '11111111-1111-4111-8111-111111111111';
  const ORG_B = '22222222-2222-4222-8222-222222222222';

  let secretHashA: string;
  let secretHashB: string;

  const makeMockSocket = (id: string) => ({
    id,
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  beforeAll(async () => {
    secretHashA = await hashPassword('secret-hub-A');
    secretHashB = await hashPassword('secret-hub-B');
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HubGateway,
        {
          provide: getRepositoryToken(Hub),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    gateway = module.get(HubGateway);
    hubRepository = module.get(getRepositoryToken(Hub));
  });

  function mockHub(hubId: string, organizationId: string | null, secretHash: string | null) {
    return {
      id: 'uuid-irrelevant',
      hubId,
      organizationId,
      secretHash,
      active: true,
    } as Hub;
  }

  describe('handleConnection (H1 — aislamiento por secret propio)', () => {
    it('conecta un hub con SU propio secret correcto', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A, secretHashA));
      const socket = makeMockSocket('sock-1') as any;

      await gateway.handleConnection({
        ...socket,
        handshake: { auth: { hubId: 'hub-A', hubSecret: 'secret-hub-A' } },
      });

      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith('hub:connected', expect.objectContaining({ hubId: 'hub-A' }));
      expect(gateway.isHubConnected('hub-A')).toBe(true);
    });

    it('RECHAZA un hub que se anuncia como hub-A pero manda el secret de hub-B (impersonación)', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub('hub-A', ORG_A, secretHashA));
      const socket = makeMockSocket('sock-2') as any;

      await gateway.handleConnection({
        ...socket,
        handshake: { auth: { hubId: 'hub-A', hubSecret: 'secret-hub-B' } },
      });

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.emit).not.toHaveBeenCalledWith('hub:connected', expect.anything());
      expect(gateway.isHubConnected('hub-A')).toBe(false);
    });

    it('RECHAZA un hubId desconocido', async () => {
      hubRepository.findOne.mockResolvedValue(null);
      const socket = makeMockSocket('sock-3') as any;

      await gateway.handleConnection({
        ...socket,
        handshake: { auth: { hubId: 'hub-fantasma', hubSecret: 'lo-que-sea' } },
      });

      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('RECHAZA un hub sin secretHash provisionado (legacy, sin CRUD)', async () => {
      hubRepository.findOne.mockResolvedValue(mockHub('hub-legacy', ORG_A, null));
      const socket = makeMockSocket('sock-4') as any;

      await gateway.handleConnection({
        ...socket,
        handshake: { auth: { hubId: 'hub-legacy', hubSecret: 'cualquier-cosa' } },
      });

      expect(socket.disconnect).toHaveBeenCalled();
    });
  });

  describe('sendToOrganization (H2 — door_open dirigido, nunca cruza tenant)', () => {
    async function connectHub(hubId: string, organizationId: string | null, secretHash: string, plaintextSecret: string) {
      hubRepository.findOne.mockResolvedValueOnce(mockHub(hubId, organizationId, secretHash));
      const socket = makeMockSocket(`sock-${hubId}`) as any;
      await gateway.handleConnection({
        ...socket,
        handshake: { auth: { hubId, hubSecret: plaintextSecret } },
      });
      return socket;
    }

    it('envía el evento SOLO a los hubs de la organización indicada', async () => {
      const socketA = await connectHub('hub-A', ORG_A, secretHashA, 'secret-hub-A');
      const socketB = await connectHub('hub-B', ORG_B, secretHashB, 'secret-hub-B');

      const delivered = gateway.sendToOrganization(ORG_A, 'hub:door_open', { type: 'vehicular' });

      expect(delivered).toBe(1);
      expect(socketA.emit).toHaveBeenCalledWith('hub:door_open', { type: 'vehicular' });
      expect(socketB.emit).not.toHaveBeenCalledWith('hub:door_open', expect.anything());
    });

    it('envía a AMBOS hubs si comparten la misma organización', async () => {
      const socketA1 = await connectHub('hub-A1', ORG_A, secretHashA, 'secret-hub-A');
      const socketA2 = await connectHub('hub-A2', ORG_A, secretHashB, 'secret-hub-B');

      const delivered = gateway.sendToOrganization(ORG_A, 'hub:door_open', { type: 'pedestrian' });

      expect(delivered).toBe(2);
      expect(socketA1.emit).toHaveBeenCalledWith('hub:door_open', { type: 'pedestrian' });
      expect(socketA2.emit).toHaveBeenCalledWith('hub:door_open', { type: 'pedestrian' });
    });

    it('NO envía nada si organizationId es null (evita el "cajón nulo")', async () => {
      const socketNull = await connectHub('hub-null', null, secretHashA, 'secret-hub-A');

      const delivered = gateway.sendToOrganization(null, 'hub:door_open', { type: 'vehicular' });

      expect(delivered).toBe(0);
      expect(socketNull.emit).not.toHaveBeenCalledWith('hub:door_open', expect.anything());
    });

    it('retorna 0 si ningún hub conectado pertenece a esa organización', async () => {
      await connectHub('hub-A', ORG_A, secretHashA, 'secret-hub-A');

      const delivered = gateway.sendToOrganization(ORG_B, 'hub:door_open', { type: 'vehicular' });

      expect(delivered).toBe(0);
    });
  });
});
