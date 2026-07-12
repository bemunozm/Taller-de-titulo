import { ConsultarVisitasTool } from './consultar-visitas.tool';
import { FamiliesService } from '../../families/families.service';
import { VisitsService } from '../../visits/visits.service';
import { VisitStatus, VisitType } from '../../visits/entities/visit.entity';
import type { Family } from '../../families/entities/family.entity';
import type { Visit } from '../../visits/entities/visit.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';

/**
 * Fase 2, Bloque F2.1 — cobertura de `ConsultarVisitasTool`
 * (docs/modulos/agente-cerebro.md §12). NO llama a la BD:
 * `FamiliesService`/`VisitsService` mockeados.
 *
 * Incluye la regresión cross-tenant que exige §6 del diseño: en esta rama
 * `VisitsService.findAll` NO es tenant-aware, así que la tool debe re-validar
 * `family.organizationId` contra `ctx.tenantId` ANTES de listar sus visitas
 * — el `familyId` nunca sale del input del modelo (siempre se deriva de
 * `FamiliesService.findByDepartment`, ya tenant-scoped).
 */
describe('ConsultarVisitasTool', () => {
  let tool: ConsultarVisitasTool;
  let familiesService: jest.Mocked<Pick<FamiliesService, 'findByDepartment'>>;
  let visitsService: jest.Mocked<Pick<VisitsService, 'findAll'>>;

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
      ...overrides,
    };
  }

  function makeFamily(organizationId: string | null): Family {
    return { id: 'family-1', organizationId, name: 'Familia Pérez' } as Family;
  }

  function makeVisit(overrides: Partial<Visit> = {}): Visit {
    return {
      id: 'visit-1',
      type: VisitType.PEDESTRIAN,
      status: VisitStatus.PENDING,
      visitorName: 'Ana Gómez',
      validFrom: new Date('2026-07-12T10:00:00Z'),
      validUntil: new Date('2026-07-12T20:00:00Z'),
      vehicle: null,
      ...overrides,
    } as Visit;
  }

  beforeEach(() => {
    familiesService = { findByDepartment: jest.fn() };
    visitsService = { findAll: jest.fn() };
    tool = new ConsultarVisitasTool(
      familiesService as unknown as FamiliesService,
      visitsService as unknown as VisitsService,
    );
  });

  it('devuelve encontrado:false cuando no existe la familia/casa', async () => {
    familiesService.findByDepartment.mockResolvedValue(null);

    const result = await tool.execute(makeCtx(), { casa: '99' });

    expect(result.encontrado).toBe(false);
    expect(visitsService.findAll).not.toHaveBeenCalled();
  });

  it('lista las visitas activas/pendientes de la casa por defecto (soloActivas implícito)', async () => {
    familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
    visitsService.findAll.mockResolvedValue([
      makeVisit({ status: VisitStatus.PENDING }),
      makeVisit({ id: 'visit-2', status: VisitStatus.COMPLETED }),
      makeVisit({ id: 'visit-3', status: VisitStatus.ACTIVE }),
    ]);

    const result = await tool.execute(makeCtx(), { casa: '15' });

    expect(visitsService.findAll).toHaveBeenCalledWith({
      familyId: 'family-1',
    });
    expect(result.encontrado).toBe(true);
    expect(result.cantidad).toBe(2);
    expect(result.visitas?.map((v) => v.id)).toEqual(['visit-1', 'visit-3']);
  });

  it('con soloActivas:false devuelve TODAS las visitas, incluidas completadas/canceladas', async () => {
    familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-A'));
    visitsService.findAll.mockResolvedValue([
      makeVisit({ status: VisitStatus.PENDING }),
      makeVisit({ id: 'visit-2', status: VisitStatus.COMPLETED }),
    ]);

    const result = await tool.execute(makeCtx(), {
      casa: '15',
      soloActivas: false,
    });

    expect(result.cantidad).toBe(2);
  });

  describe('regresión cross-tenant (§6 del diseño)', () => {
    it('NO alcanza visitas de una familia de otro condominio — responde "no encontrado"', async () => {
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-B'));

      const result = await tool.execute(makeCtx({ tenantId: 'condo-A' }), {
        casa: '15',
      });

      expect(result.encontrado).toBe(false);
      expect(visitsService.findAll).not.toHaveBeenCalled();
    });

    it('un super-admin SÍ puede consultar visitas de cualquier condominio (bypass intencional)', async () => {
      familiesService.findByDepartment.mockResolvedValue(makeFamily('condo-B'));
      visitsService.findAll.mockResolvedValue([makeVisit()]);

      const result = await tool.execute(
        makeCtx({ tenantId: 'condo-A', isSuperAdmin: true }),
        { casa: '15' },
      );

      expect(result.encontrado).toBe(true);
      expect(visitsService.findAll).toHaveBeenCalledWith({
        familyId: 'family-1',
      });
    });
  });
});
