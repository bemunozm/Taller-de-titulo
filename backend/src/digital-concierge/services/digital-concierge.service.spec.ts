import { Repository } from 'typeorm';
import { DigitalConciergeService } from './digital-concierge.service';
import { ConciergeSession } from '../entities/concierge-session.entity';
import { RealtimeVoiceTokenService } from './realtime-voice-token.service';
import { UsersService } from '../../users/users.service';
import { FamiliesService } from '../../families/families.service';
import { VisitsService } from '../../visits/visits.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { HubGateway } from '../../hub/hub.gateway';
import { SmsService } from '../../common/services/sms.service';
import { QRCodeService } from '../../common/services/qrcode.service';

/**
 * Cierre de brecha Fase 1 → Fase 2 (docs/modulos/agente-cerebro.md §7/§10.2):
 * cobertura de `saveVisitorData` tras revivir en el dominio la
 * validación/normalización de RUT/teléfono/patente que el frontend hacía
 * antes de adelgazarse (ver `common/utils/chilean-format.util.ts`).
 *
 * Solo se mockea `sessionRepository` (lo único que `saveVisitorData` toca) —
 * el resto de las dependencias del constructor no se usan en este método, y
 * se pasan como stubs tipados (mismo patrón que
 * `agent/tools/abrir-acceso.tool.spec.ts`).
 */
describe('DigitalConciergeService.saveVisitorData', () => {
  let service: DigitalConciergeService;
  let sessionRepository: jest.Mocked<Pick<Repository<ConciergeSession>, 'save'>>;

  function makeSession(overrides: Partial<ConciergeSession> = {}): ConciergeSession {
    return {
      id: 'session-row-1',
      sessionId: 'session-1',
      organizationId: 'condo-A',
      visitorName: null,
      visitorRut: null,
      visitorPhone: null,
      vehiclePlate: null,
      visitReason: null,
      destinationHouse: null,
      ...overrides,
    } as ConciergeSession;
  }

  beforeEach(() => {
    sessionRepository = {
      save: jest.fn((session: ConciergeSession) => Promise.resolve(session)),
    };

    service = new DigitalConciergeService(
      sessionRepository as unknown as Repository<ConciergeSession>,
      {} as unknown as RealtimeVoiceTokenService,
      {} as unknown as UsersService,
      {} as unknown as FamiliesService,
      {} as unknown as VisitsService,
      {} as unknown as NotificationsService,
      {} as unknown as NotificationsGateway,
      {} as unknown as HubGateway,
      {} as unknown as SmsService,
      {} as unknown as QRCodeService,
    );
  });

  describe('RUT / pasaporte', () => {
    it('normaliza y guarda un RUT válido en formato canónico', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { rut: '123456785' });

      expect(result.ok).toBe(true);
      expect(session.visitorRut).toBe('12.345.678-5');
      expect(result.saved.rut).toBe('12.345.678-5');
      expect(sessionRepository.save).toHaveBeenCalledWith(session);
    });

    it('NO guarda un RUT con dígito verificador inválido y pide corrección', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { rut: '12345678-9' });

      expect(result.ok).toBe(false);
      expect(result.campo).toBe('rut');
      expect(result.mensaje).toContain('12345678-9');
      expect(session.visitorRut).toBeNull();
      expect(result.saved.rut).toBeNull();
    });

    it('acepta un pasaporte extranjero válido (no parece RUT) sin exigir dígito verificador', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { rut: 'ab123456' });

      expect(result.ok).toBe(true);
      expect(session.visitorRut).toBe('AB123456');
    });

    it('rechaza un valor que no parece RUT ni pasaporte válido', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { rut: 'x' });

      expect(result.ok).toBe(false);
      expect(result.campo).toBe('rut');
      expect(session.visitorRut).toBeNull();
    });
  });

  describe('teléfono', () => {
    it('normaliza un teléfono nacional válido a formato E.164 chileno', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { telefono: '912345678' });

      expect(result.ok).toBe(true);
      expect(session.visitorPhone).toBe('+56912345678');
      expect(result.saved.telefono).toBe('+56912345678');
    });

    it('NO guarda un teléfono que no normaliza a un formato chileno válido', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { telefono: '123' });

      expect(result.ok).toBe(false);
      expect(result.campo).toBe('telefono');
      expect(session.visitorPhone).toBeNull();
    });
  });

  describe('patente', () => {
    it('normaliza y guarda una patente válida en formato actual (4 letras + 2 dígitos)', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { patente: 'bb.cd-12' });

      expect(result.ok).toBe(true);
      expect(session.vehiclePlate).toBe('BBCD12');
    });

    it('normaliza y guarda una patente válida en formato anterior (2 letras + 4 dígitos)', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { patente: 'ab-1234' });

      expect(result.ok).toBe(true);
      expect(session.vehiclePlate).toBe('AB1234');
    });

    it('NO guarda una patente con formato inválido', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, { patente: 'abc123' });

      expect(result.ok).toBe(false);
      expect(result.campo).toBe('patente');
      expect(session.vehiclePlate).toBeNull();
    });
  });

  describe('campos sin validación de dominio (nombre, motivo, casa)', () => {
    it('los guarda tal cual, sin transformarlos', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, {
        nombre: 'Juan Pérez',
        motivo: 'Visita familiar',
        casa: '15',
      });

      expect(result.ok).toBe(true);
      expect(session.visitorName).toBe('Juan Pérez');
      expect(session.visitReason).toBe('Visita familiar');
      expect(session.destinationHouse).toBe('15');
    });
  });

  describe('múltiples campos en una sola llamada', () => {
    it('guarda los campos válidos y reporta solo el primer campo inválido (prioridad rut > telefono > patente)', async () => {
      const session = makeSession();

      const result = await service.saveVisitorData(session, {
        rut: '12345678-9', // inválido
        telefono: '912345678', // válido
        patente: 'abc123', // inválido
      });

      expect(result.ok).toBe(false);
      expect(result.campo).toBe('rut');
      expect(session.visitorRut).toBeNull();
      expect(session.visitorPhone).toBe('+56912345678'); // sí se guarda pese al error en rut
      expect(session.vehiclePlate).toBeNull();
    });
  });
});
