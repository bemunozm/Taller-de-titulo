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
  let familiesService: jest.Mocked<Pick<FamiliesService, 'resolveHouse'>>;

  const ctxTenantA: AuthorizedContext = {
    tenantId: 'condo-A',
    isSuperAdmin: false,
    userId: undefined,
    role: 'hub',
    channel: 'physical-hub',
    scopes: ['digital-concierge.access'],
    requestId: 'req-1',
  };

  beforeEach(() => {
    familiesService = { resolveHouse: jest.fn() };
    tool = new BuscarResidenteTool(
      familiesService as unknown as FamiliesService,
    );
  });

  it('delega en FamiliesService.resolveHouse con el término de búsqueda tal cual', async () => {
    familiesService.resolveHouse.mockResolvedValue({ status: 'not-found' });

    await tool.execute(ctxTenantA, { casa: 'Casa 15' });

    expect(familiesService.resolveHouse).toHaveBeenCalledWith('Casa 15');
    expect(familiesService.resolveHouse).toHaveBeenCalledTimes(1);
  });

  it('devuelve encontrado:false cuando no existe la familia', async () => {
    familiesService.resolveHouse.mockResolvedValue({ status: 'not-found' });

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
    familiesService.resolveHouse.mockResolvedValue({
      status: 'found',
      family: familiaSinMiembros,
    });

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
    familiesService.resolveHouse.mockResolvedValue({
      status: 'found',
      family: familia,
    });

    // Canal humano (Fase 4 · P7.L): conserva nombres y familia.
    const result = await tool.execute(
      { ...ctxTenantA, channel: 'human', role: 'Conserje' },
      { casa: '15' },
    );

    expect(result).toEqual({
      encontrado: true,
      casa: '15',
      familia: 'Familia Pérez',
      cantidad_residentes: 2,
      residentes: [
        { id: 'user-1', nombre: 'Ana Pérez' },
        { id: 'user-2', nombre: 'Beto Pérez' },
      ],
    });
  });

  /**
   * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §5.1): un dispositivo
   * no recibe nombres de residentes ni de la familia; solo ids y conteo.
   */
  describe.each(['physical-hub', 'web-kiosk'] as const)(
    'dispositivo (%s): sin nombres de residentes',
    (channel) => {
      it('devuelve ids y conteo, sin nombre ni familia', async () => {
        familiesService.resolveHouse.mockResolvedValue({
          status: 'found',
          family: {
            name: 'Familia Pérez',
            unit: { identifier: '15' },
            members: [
              { id: 'user-1', name: 'Ana Pérez' },
              { id: 'user-2', name: 'Beto Pérez' },
            ],
          } as unknown as Family,
        });

        const output = tool.outputSchema.parse(
          await tool.execute({ ...ctxTenantA, channel }, { casa: '15' }),
        );

        expect(output).toStrictEqual({
          encontrado: true,
          casa: '15',
          residentes: [{ id: 'user-1' }, { id: 'user-2' }],
          cantidad_residentes: 2,
        });
        expect(JSON.stringify(output)).not.toMatch(/Pérez|Ana|Beto/);
      });
    },
  );

  it('canal no reconocido: tampoco recibe nombres (fail-closed)', async () => {
    familiesService.resolveHouse.mockResolvedValue({
      status: 'found',
      family: {
        name: 'Familia Pérez',
        unit: { identifier: '15' },
        members: [{ id: 'user-1', name: 'Ana Pérez' }],
      } as unknown as Family,
    });

    const output = await tool.execute(
      { ...ctxTenantA, channel: 'unknown' },
      { casa: '15' },
    );

    expect(JSON.stringify(output)).not.toContain('Pérez');
    expect(output.residentes).toEqual([{ id: 'user-1' }]);
  });

  it('Fase 4 · P4.B (minimización): no expone el teléfono ni otros datos del residente al dispositivo', async () => {
    const familia = {
      name: 'Familia Pérez',
      unit: { identifier: '15' },
      members: [
        {
          id: 'user-1',
          name: 'Ana Pérez',
          phone: '+56911111111',
          email: 'ana@example.com',
          rut: '11.111.111-1',
        },
      ],
    } as unknown as Family;
    familiesService.resolveHouse.mockResolvedValue({
      status: 'found',
      family: familia,
    });

    const output = tool.outputSchema.parse(
      await tool.execute(ctxTenantA, { casa: '15' }),
    );

    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('+56911111111');
    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain('11.111.111-1');
    // Fase 4 · P7.L: el dispositivo tampoco recibe el nombre.
    expect(serialized).not.toContain('Ana Pérez');
    expect(output.residentes).toEqual([{ id: 'user-1' }]);
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
    familiesService.resolveHouse.mockResolvedValue({ status: 'not-found' });
    const ctxTenantB: AuthorizedContext = {
      ...ctxTenantA,
      tenantId: 'condo-B',
    };

    await tool.execute(ctxTenantA, { casa: '15' });
    await tool.execute(ctxTenantB, { casa: '15' });

    expect(familiesService.resolveHouse).toHaveBeenNthCalledWith(1, '15');
    expect(familiesService.resolveHouse).toHaveBeenNthCalledWith(2, '15');
    expect(familiesService.resolveHouse).toHaveBeenCalledTimes(2);
  });

  /**
   * Fase 4 · P6.R: el kiosko y el teclado del hub marcan solo el número. Si
   * corresponde a varias casas, la tool devuelve las opciones (solo códigos)
   * para que Sofía pregunte; si es única, la encuentra y devuelve su código.
   */
  describe('casa ambigua o por número (P6.R)', () => {
    it('número con varias casas: { encontrado: false, ambiguo: true, opciones } sin nombres', async () => {
      familiesService.resolveHouse.mockResolvedValue({
        status: 'ambiguous',
        options: ['A-303', 'B-303'],
      });

      const output = tool.outputSchema.parse(
        await tool.execute(ctxTenantA, { casa: '303' }),
      );

      expect(output).toEqual({
        encontrado: false,
        ambiguo: true,
        opciones: ['A-303', 'B-303'],
        mensaje: expect.stringContaining('A-303, B-303') as unknown,
      });
      expect(output.residentes).toBeUndefined();
      expect(output.familia).toBeUndefined();
    });

    it('número único: encuentra la casa y devuelve su código exacto en "casa"', async () => {
      familiesService.resolveHouse.mockResolvedValue({
        status: 'found',
        family: {
          name: 'Familia Soto',
          unit: { identifier: 'A-303' },
          members: [{ id: 'user-9', name: 'Carla Soto' }],
        } as unknown as Family,
      });

      const output = await tool.execute(ctxTenantA, { casa: '303' });

      expect(output).toEqual(
        expect.objectContaining({ encontrado: true, casa: 'A-303' }),
      );
      expect(output.ambiguo).toBeUndefined();
    });
  });
});
