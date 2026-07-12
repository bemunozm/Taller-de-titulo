import { BuscarResidenteTool } from './buscar-residente.tool';
import { FamiliesService } from '../../families/families.service';
import type { Family } from '../../families/entities/family.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';

/**
 * Fase 1, Bloque A2t — cobertura de `BuscarResidenteTool`
 * (docs/modulos/agente-cerebro.md §7/§10.2 paso 4). NO llama al LLM: se
 * ejercita `execute()` directo con `FamiliesService` mockeado.
 */
describe('BuscarResidenteTool', () => {
  let tool: BuscarResidenteTool;
  let familiesService: jest.Mocked<Pick<FamiliesService, 'findByDepartment'>>;

  const ctxTenantA: AuthorizedContext = {
    tenantId: 'condo-A',
    isSuperAdmin: false,
    userId: undefined,
    role: 'hub',
    scopes: ['digital-concierge.access'],
    requestId: 'req-1',
  };

  beforeEach(() => {
    familiesService = { findByDepartment: jest.fn() };
    tool = new BuscarResidenteTool(
      familiesService as unknown as FamiliesService,
    );
  });

  it('delega en FamiliesService.findByDepartment con el término de búsqueda tal cual', async () => {
    familiesService.findByDepartment.mockResolvedValue(null);

    await tool.execute(ctxTenantA, { casa: 'Casa 15' });

    expect(familiesService.findByDepartment).toHaveBeenCalledWith('Casa 15');
    expect(familiesService.findByDepartment).toHaveBeenCalledTimes(1);
  });

  it('devuelve encontrado:false cuando no existe la familia', async () => {
    familiesService.findByDepartment.mockResolvedValue(null);

    const result = await tool.execute(ctxTenantA, { casa: '99' });

    expect(result.encontrado).toBe(false);
    expect(result.mensaje).toContain('99');
  });

  it('devuelve encontrado:false cuando la familia existe pero no tiene residentes', async () => {
    const familiaSinMiembros = {
      name: 'Familia Vacía',
      unit: { identifier: '15' },
      members: [],
    } as unknown as Family;
    familiesService.findByDepartment.mockResolvedValue(familiaSinMiembros);

    const result = await tool.execute(ctxTenantA, { casa: '15' });

    expect(result.encontrado).toBe(false);
    expect(result.mensaje).toContain('15');
  });

  it('devuelve encontrado:true con TODOS los residentes mapeados cuando la familia tiene miembros', async () => {
    const familia = {
      name: 'Familia Pérez',
      unit: { identifier: '15' },
      members: [
        { id: 'user-1', name: 'Ana Pérez', phone: '+56911111111' },
        { id: 'user-2', name: 'Beto Pérez', phone: null },
      ],
    } as unknown as Family;
    familiesService.findByDepartment.mockResolvedValue(familia);

    const result = await tool.execute(ctxTenantA, { casa: '15' });

    expect(result).toEqual({
      encontrado: true,
      casa: '15',
      familia: 'Familia Pérez',
      cantidad_residentes: 2,
      residentes: [
        { id: 'user-1', nombre: 'Ana Pérez', telefono: '+56911111111' },
        { id: 'user-2', nombre: 'Beto Pérez', telefono: null },
      ],
    });
  });

  /**
   * Regresión de tenant-scoping (§6 del diseño): esta tool NO recibe ni
   * reenvía `ctx.tenantId` a `FamiliesService` — el aislamiento entre
   * condominios lo garantiza `FamiliesService`/`TenantContextService` (Fase
   * 0, tarea #19), no la tool. Cambiar el `ctx` entre llamadas no puede
   * alterar qué se le pide al servicio de dominio: la única superficie de
   * ataque posible (un `ctx.tenantId` que la tool reenviara manualmente) no
   * existe en esta implementación.
   */
  it('no pasa tenantId/ctx a FamiliesService — no hay superficie para que un ctx cruzado filtre otro condominio', async () => {
    familiesService.findByDepartment.mockResolvedValue(null);
    const ctxTenantB: AuthorizedContext = {
      ...ctxTenantA,
      tenantId: 'condo-B',
    };

    await tool.execute(ctxTenantA, { casa: '15' });
    await tool.execute(ctxTenantB, { casa: '15' });

    expect(familiesService.findByDepartment).toHaveBeenNthCalledWith(1, '15');
    expect(familiesService.findByDepartment).toHaveBeenNthCalledWith(2, '15');
    expect(familiesService.findByDepartment).toHaveBeenCalledTimes(2);
  });
});
