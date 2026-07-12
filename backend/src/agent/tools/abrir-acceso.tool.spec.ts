import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AbrirAccesoTool } from './abrir-acceso.tool';
import {
  DigitalConciergeService,
  type TenantScope,
} from '../../digital-concierge/services/digital-concierge.service';
import { FamiliesService } from '../../families/families.service';
import { VisitsService } from '../../visits/visits.service';
import { VisitStatus, VisitType } from '../../visits/entities/visit.entity';
import { HubGateway } from '../../hub/hub.gateway';
import type { ConciergeSession } from '../../digital-concierge/entities/concierge-session.entity';
import type { Family } from '../../families/entities/family.entity';
import type { Visit } from '../../visits/entities/visit.entity';
import type { Vehicle } from '../../vehicles/entities/vehicle.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';

/**
 * Fase 2, Bloque F2.2 (docs/modulos/agente-cerebro.md §12) — cobertura de
 * `AbrirAccesoTool` tras la corrección del hallazgo CRÍTICO de auditoría:
 * la política de autonomía original autorizaba por CASA (cualquier visita
 * vigente en la casa de destino, sin comparar identidad), lo que permitía a
 * un intruso marcar una casa con una visita ajena y pedir la apertura. La
 * política corregida exige una identidad VERIFICADA (patente LPR o QR
 * escaneado) que matchee la visita — nunca datos declarados por voz.
 *
 * NO llama a la BD ni al hub real: `DigitalConciergeService`/
 * `FamiliesService`/`VisitsService`/`HubGateway` mockeados.
 * `resolveVerifiedIdentity` es privado y hoy siempre resuelve `null` (ver su
 * docstring — no existe todavía un vínculo sesión↔detección/QR); los tests
 * que necesitan simular una identidad verificada lo espían con
 * `jest.spyOn(tool as any, 'resolveVerifiedIdentity')`, exactamente el punto
 * de extensión documentado para cuando ese vínculo se cablee.
 */
describe('AbrirAccesoTool', () => {
  let tool: AbrirAccesoTool;
  let conciergeService: jest.Mocked<
    Pick<DigitalConciergeService, 'findSessionForTenant'>
  >;
  let familiesService: jest.Mocked<Pick<FamiliesService, 'findByDepartment'>>;
  let visitsService: jest.Mocked<Pick<VisitsService, 'findAll'>>;
  let hubGateway: jest.Mocked<
    Pick<HubGateway, 'isHubConnected' | 'sendToHub' | 'sendToOrganization'>
  >;

  const NOW = new Date('2026-07-12T12:00:00Z');

  function makeCtx(
    overrides: Partial<AuthorizedContext> = {},
  ): AuthorizedContext {
    return {
      tenantId: 'condo-A',
      isSuperAdmin: false,
      userId: undefined,
      role: 'hub',
      scopes: ['digital-concierge.access'],
      requestId: 'req-1',
      sessionId: 'session-1',
      ...overrides,
    };
  }

  function makeSession(
    overrides: Partial<ConciergeSession> = {},
  ): ConciergeSession {
    return {
      id: 'session-row-1',
      sessionId: 'session-1',
      organizationId: 'condo-A',
      hubId: null,
      destinationHouse: '15',
      // Datos "declarados" por el visitante durante la llamada — NUNCA deben
      // por sí solos habilitar autonomía (ese era el bug). Se incluyen acá
      // para que un test que olvide espiar `resolveVerifiedIdentity` no
      // pueda, por accidente, hacer pasar un dato declarado como verificado.
      vehiclePlate: 'DECLARADA-POR-VOZ',
      visitorName: 'Visitante Anónimo',
      visitorRut: null,
      createdVisit: null,
      ...overrides,
    } as unknown as ConciergeSession;
  }

  /** Réplica fiel de la regla real de `findSessionForTenant` (ver otros specs de tools). */
  function realFindSessionForTenant(session: ConciergeSession) {
    return jest.fn(
      (
        _sessionId: string,
        tenantScope: TenantScope,
      ): Promise<ConciergeSession> => {
        if (
          !tenantScope.isSuperAdmin &&
          session.organizationId !== tenantScope.tenantId
        ) {
          throw new ForbiddenException(
            `La sesión "${session.id}" no pertenece al condominio del contexto autorizado`,
          );
        }
        return Promise.resolve(session);
      },
    );
  }

  function makeFamily(organizationId: string | null): Family {
    return { id: 'family-1', organizationId, name: 'Familia Pérez' } as Family;
  }

  function makeVisit(overrides: Partial<Visit> = {}): Visit {
    return {
      id: 'visit-1',
      type: VisitType.PEDESTRIAN,
      status: VisitStatus.PENDING,
      validFrom: new Date('2026-07-12T10:00:00Z'),
      validUntil: new Date('2026-07-12T20:00:00Z'),
      qrCode: null,
      vehicle: null,
      ...overrides,
    } as Visit;
  }

  /** Espía el punto de extensión documentado en `resolveVerifiedIdentity`. */
  function mockVerifiedIdentity(
    identity:
      | { kind: 'plate'; plate: string }
      | { kind: 'qr'; qrCode: string }
      | null,
  ): jest.SpyInstance {
    return jest
      .spyOn(tool as unknown as { resolveVerifiedIdentity: unknown }, 'resolveVerifiedIdentity' as never)
      .mockResolvedValue(identity as never);
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);

    conciergeService = { findSessionForTenant: jest.fn() };
    familiesService = { findByDepartment: jest.fn() };
    visitsService = { findAll: jest.fn() };
    hubGateway = {
      isHubConnected: jest.fn().mockReturnValue(false),
      sendToHub: jest.fn().mockReturnValue(true),
      sendToOrganization: jest.fn(),
    };

    tool = new AbrirAccesoTool(
      conciergeService as unknown as DigitalConciergeService,
      familiesService as unknown as FamiliesService,
      visitsService as unknown as VisitsService,
      hubGateway as unknown as HubGateway,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('requiresApproval (política de autonomía, fail-closed por diseño)', () => {
    it('sin ctx.sessionId escala siempre (true) — no hay hub/casa que validar', async () => {
      const needsApproval = await tool.requiresApproval(
        makeCtx({ sessionId: undefined }),
        { tipo: 'porton' },
      );

      expect(needsApproval).toBe(true);
      expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
    });

    it('sin destinationHouse en la sesión, escala (true)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(
        makeSession({ destinationHouse: null }),
      );

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(true);
      expect(familiesService.findByDepartment).not.toHaveBeenCalled();
    });

    it('ATAQUE DEL AUDITOR (H-CRIT-F2.2): visitante SIN identidad verificada que marca una casa con visita ajena vigente — escala (true), NUNCA abre por la sola existencia de la visita', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
      // La casa de destino SÍ tiene una visita vigente — de otra persona.
      // `resolveVerifiedIdentity` NO se mockea: se ejerce el comportamiento
      // real de producción (siempre `null` hoy, ver su docstring).
      visitsService.findAll.mockResolvedValue([
        makeVisit({
          status: VisitStatus.ACTIVE,
          vehicle: { plate: 'OTRO-VISITANTE' } as Vehicle,
        }),
      ]);

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(true);
      // Corta apenas se sabe que no hay identidad — ni siquiera necesita
      // resolver la familia para descartar la autonomía.
      expect(familiesService.findByDepartment).not.toHaveBeenCalled();
      expect(visitsService.findAll).not.toHaveBeenCalled();
    });

    it('identidad verificada por PATENTE (LPR) que matchea la visita vigente de la casa — NO escala (false), abre autónomo', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'plate', plate: 'abcd12' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
      visitsService.findAll.mockResolvedValue([
        makeVisit({
          status: VisitStatus.ACTIVE,
          vehicle: { plate: 'ABCD12' } as Vehicle,
        }),
      ]);

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(false);
      expect(visitsService.findAll).toHaveBeenCalledWith({
        familyId: 'family-1',
      });
    });

    it('identidad verificada por QR escaneado que matchea la visita vigente de la casa — NO escala (false)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'qr', qrCode: 'qr-abc-123' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
      visitsService.findAll.mockResolvedValue([
        makeVisit({ status: VisitStatus.PENDING, qrCode: 'qr-abc-123' }),
      ]);

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(false);
    });

    it('identidad verificada que NO matchea ninguna visita de la casa (patente distinta) — escala (true)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'plate', plate: 'ZZZZ99' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
      visitsService.findAll.mockResolvedValue([
        makeVisit({
          status: VisitStatus.ACTIVE,
          vehicle: { plate: 'ABCD12' } as Vehicle,
        }),
      ]);

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(true);
    });

    it('sin ninguna visita para la casa (aun con identidad verificada), escala (true) — caso "dudoso"', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'plate', plate: 'ABCD12' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
      visitsService.findAll.mockResolvedValue([]);

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(true);
    });

    it('con visita que matchea la identidad pero en estado no autorizado (CANCELLED/COMPLETED/DENIED), escala (true)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'plate', plate: 'ABCD12' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
      visitsService.findAll.mockResolvedValue([
        makeVisit({
          status: VisitStatus.CANCELLED,
          vehicle: { plate: 'ABCD12' } as Vehicle,
        }),
        makeVisit({
          id: 'visit-2',
          status: VisitStatus.COMPLETED,
          vehicle: { plate: 'ABCD12' } as Vehicle,
        }),
      ]);

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(true);
    });

    it('con visita que matchea la identidad pero fuera de la ventana de validez (ya expiró), escala (true)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'plate', plate: 'ABCD12' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
      visitsService.findAll.mockResolvedValue([
        makeVisit({
          status: VisitStatus.PENDING,
          vehicle: { plate: 'ABCD12' } as Vehicle,
          validFrom: new Date('2026-07-10T00:00:00Z'),
          validUntil: new Date('2026-07-11T00:00:00Z'), // antes de NOW
        }),
      ]);

      const needsApproval = await tool.requiresApproval(makeCtx(), {
        tipo: 'porton',
      });

      expect(needsApproval).toBe(true);
    });

    it('NO alcanza visitas de una familia de otro condominio aun con identidad verificada — escala (true), sin listar sus visitas', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'plate', plate: 'ABCD12' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-B'));

      const needsApproval = await tool.requiresApproval(
        makeCtx({ tenantId: 'condo-A' }),
        { tipo: 'porton' },
      );

      expect(needsApproval).toBe(true);
      expect(visitsService.findAll).not.toHaveBeenCalled();
    });

    it('un super-admin SÍ puede resolver autonomía sobre la familia de cualquier condominio (bypass intencional), siempre que la identidad matchee', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(makeSession());
      mockVerifiedIdentity({ kind: 'plate', plate: 'ABCD12' });
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-B'));
      visitsService.findAll.mockResolvedValue([
        makeVisit({
          status: VisitStatus.ACTIVE,
          vehicle: { plate: 'ABCD12' } as Vehicle,
        }),
      ]);

      const needsApproval = await tool.requiresApproval(
        makeCtx({ tenantId: 'condo-A', isSuperAdmin: true }),
        { tipo: 'porton' },
      );

      expect(needsApproval).toBe(false);
    });

    it('propaga (no traga) el error si la sesión no pertenece al tenant — nunca decide autonomía sobre datos de otro condominio', async () => {
      conciergeService.findSessionForTenant.mockImplementation(
        realFindSessionForTenant(makeSession({ organizationId: 'condo-B' })),
      );

      await expect(
        tool.requiresApproval(makeCtx({ tenantId: 'condo-A' }), {
          tipo: 'porton',
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('execute', () => {
    it('exige ctx.sessionId — lanza BadRequestException sin tocar el hub si falta', async () => {
      await expect(
        tool.execute(makeCtx({ sessionId: undefined }), { tipo: 'porton' }),
      ).rejects.toThrow(BadRequestException);

      expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
      expect(hubGateway.sendToHub).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
    });

    it('dirige la apertura al hub propio de la sesión cuando está conectado (tipo "porton" -> vehicular)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(
        makeSession({ hubId: 'hub-001', organizationId: 'condo-A' }),
      );
      hubGateway.isHubConnected.mockReturnValue(true);

      const result = await tool.execute(makeCtx(), { tipo: 'porton' });

      expect(hubGateway.sendToHub).toHaveBeenCalledWith(
        'hub-001',
        'hub:door_open',
        expect.objectContaining({ type: 'vehicular' }),
      );
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
      expect(result.abierto).toBe(true);
      expect(result.mensaje).toContain('portón');
    });

    it('(a) dirige por condominio (sendToOrganization) cuando el hub propio no está conectado (tipo "puerta" -> pedestrian)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue(
        makeSession({ hubId: 'hub-001', organizationId: 'condo-A' }),
      );
      hubGateway.isHubConnected.mockReturnValue(false);

      const result = await tool.execute(makeCtx(), { tipo: 'puerta' });

      expect(hubGateway.sendToHub).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(
        'condo-A',
        'hub:door_open',
        expect.objectContaining({ type: 'pedestrian' }),
      );
      expect(result.abierto).toBe(true);
      expect(result.mensaje).toContain('puerta');
    });

    it('(d) nunca dirige la apertura a la organización de OTRO condominio — la sesión ya viene tenant-scoped', async () => {
      conciergeService.findSessionForTenant.mockImplementation(
        realFindSessionForTenant(makeSession({ organizationId: 'condo-B' })),
      );

      await expect(
        tool.execute(makeCtx({ tenantId: 'condo-A' }), { tipo: 'porton' }),
      ).rejects.toThrow(ForbiddenException);

      expect(hubGateway.sendToHub).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
    });
  });
});
