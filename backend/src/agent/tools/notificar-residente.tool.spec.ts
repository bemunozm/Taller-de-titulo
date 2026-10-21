import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificarResidenteTool } from './notificar-residente.tool';
import {
  DigitalConciergeService,
  type TenantScope,
} from '../../digital-concierge/services/digital-concierge.service';
import type { ConciergeSession } from '../../digital-concierge/entities/concierge-session.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';
import { BuscarResidenteTool } from './buscar-residente.tool';
import type { FamiliesService } from '../../families/families.service';
import type { Family } from '../../families/entities/family.entity';

/**
 * Fase 1, Bloque A2t — cobertura de `NotificarResidenteTool`
 * (docs/modulos/agente-cerebro.md §7/§10.2 paso 4). NO llama al LLM: se
 * ejercita `execute()` directo con `DigitalConciergeService` mockeado.
 *
 * Incluye la regresión cross-tenant que exige §6 del diseño (fix M1): una
 * tool ejecutada con `ctx.tenantId` del condominio A no puede alcanzar una
 * `ConciergeSession` de OTRO condominio. `findSessionForTenant` se mockea
 * replicando la regla REAL de `DigitalConciergeService.findSessionForTenant`
 * (comparar `session.organizationId` contra `tenantScope.tenantId`, salvo
 * super-admin) para que el test ejercite la lógica de scoping de verdad, no
 * solo que "se llamó a la función".
 */
describe('NotificarResidenteTool', () => {
  let tool: NotificarResidenteTool;
  let conciergeService: jest.Mocked<
    Pick<DigitalConciergeService, 'findSessionForTenant' | 'notifyResident'>
  >;

  function makeCtx(
    overrides: Partial<AuthorizedContext> = {},
  ): AuthorizedContext {
    return {
      tenantId: 'condo-A',
      isSuperAdmin: false,
      userId: undefined,
      role: 'hub',
      channel: 'physical-hub',
      scopes: ['digital-concierge.access'],
      requestId: 'req-1',
      sessionId: 'session-1',
      ...overrides,
    };
  }

  function makeSession(organizationId: string | null): ConciergeSession {
    return { id: 'session-1', organizationId } as unknown as ConciergeSession;
  }

  /** Réplica fiel de la regla real (ver docstring de `findSessionForTenant`). */
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

  beforeEach(() => {
    conciergeService = {
      findSessionForTenant: jest.fn(),
      notifyResident: jest.fn(),
    };
    tool = new NotificarResidenteTool(
      conciergeService as unknown as DigitalConciergeService,
    );
  });

  it('exige ctx.sessionId — lanza BadRequestException sin llamar al servicio si falta', async () => {
    const ctxSinSesion = makeCtx({ sessionId: undefined });

    await expect(
      tool.execute(ctxSinSesion, { residentes_ids: ['user-1'] }),
    ).rejects.toThrow(BadRequestException);

    expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
    expect(conciergeService.notifyResident).not.toHaveBeenCalled();
  });

  it('delega en findSessionForTenant(ctx.sessionId, ctx) y luego en notifyResident(session, input, ctx)', async () => {
    const session = makeSession('condo-A');
    conciergeService.findSessionForTenant.mockResolvedValue(session);
    conciergeService.notifyResident.mockResolvedValue({
      notificado: true,
      mensaje: 'ok',
    });
    const ctx = makeCtx();

    const result = await tool.execute(ctx, {
      residentes_ids: ['user-1', 'user-2'],
    });

    expect(conciergeService.findSessionForTenant).toHaveBeenCalledWith(
      'session-1',
      ctx,
    );
    expect(conciergeService.notifyResident).toHaveBeenCalledWith(
      session,
      { residentes_ids: ['user-1', 'user-2'] },
      ctx,
    );
    expect(result).toEqual({ notificado: true, mensaje: 'ok' });
  });

  it('Fase 4 · P4.B (minimización): no devuelve el id interno de la visita al dispositivo', async () => {
    conciergeService.findSessionForTenant.mockResolvedValue(
      makeSession('condo-A'),
    );
    conciergeService.notifyResident.mockResolvedValue({
      notificado: true,
      residentes_notificados: ['Ana'],
      cantidad_notificados: 1,
      visita_creada: true,
      visita_id: 'visit-uuid-interno',
      mensaje: 'Notificación enviada',
    });

    const output = tool.outputSchema.parse(
      await tool.execute(makeCtx(), { residentes_ids: ['user-1'] }),
    );

    // Fase 4 · P7.L: el dispositivo tampoco recibe los nombres.
    expect(output).toStrictEqual({
      notificado: true,
      cantidad_notificados: 1,
      visita_creada: true,
      mensaje: 'Notificación enviada',
    });
    expect(JSON.stringify(output)).not.toContain('visit-uuid-interno');
  });

  /**
   * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §5.1): los nombres de
   * los residentes notificados solo van al canal humano.
   */
  describe('nombres de los residentes notificados por canal (P7.L)', () => {
    beforeEach(() => {
      conciergeService.findSessionForTenant.mockResolvedValue(
        makeSession('condo-A'),
      );
      conciergeService.notifyResident.mockResolvedValue({
        notificado: true,
        residentes_notificados: ['Ana Pérez', 'Beto Pérez'],
        cantidad_notificados: 2,
        visita_creada: true,
        visita_id: 'visit-1',
        mensaje: 'Notificación enviada a 2 residente(s)',
      });
    });

    it.each(['physical-hub', 'web-kiosk', 'unknown'] as const)(
      '%s: solo el conteo, sin nombres',
      async (channel) => {
        const output = tool.outputSchema.parse(
          await tool.execute(makeCtx({ channel }), {
            residentes_ids: ['user-1', 'user-2'],
          }),
        );

        expect(output).toStrictEqual({
          notificado: true,
          cantidad_notificados: 2,
          visita_creada: true,
          mensaje: 'Notificación enviada a 2 residente(s)',
        });
        expect(JSON.stringify(output)).not.toContain('Pérez');
      },
    );

    it('humano: conserva los nombres', async () => {
      const output = tool.outputSchema.parse(
        await tool.execute(makeCtx({ channel: 'human', role: 'Conserje' }), {
          residentes_ids: ['user-1', 'user-2'],
        }),
      );

      expect(output.residentes_notificados).toEqual([
        'Ana Pérez',
        'Beto Pérez',
      ]);
      expect(output.cantidad_notificados).toBe(2);
    });
  });

  /**
   * Fase 4 · P7.L: el flujo del dispositivo sigue funcionando sin nombres:
   * `buscar_residente` entrega los ids y `notificar_residente` los usa tal
   * cual.
   */
  it('flujo de dispositivo: los ids de buscar_residente alcanzan para notificar a todos', async () => {
    const familiesService = {
      resolveHouse: jest.fn().mockResolvedValue({
        status: 'found',
        family: {
          name: 'Familia Pérez',
          unit: { identifier: '15' },
          members: [
            { id: 'user-1', name: 'Ana Pérez' },
            { id: 'user-2', name: 'Beto Pérez' },
          ],
        } as unknown as Family,
      }),
    };
    const buscar = new BuscarResidenteTool(
      familiesService as unknown as FamiliesService,
    );
    const session = makeSession('condo-A');
    conciergeService.findSessionForTenant.mockResolvedValue(session);
    conciergeService.notifyResident.mockResolvedValue({
      notificado: true,
      residentes_notificados: ['Ana Pérez', 'Beto Pérez'],
      cantidad_notificados: 2,
      visita_creada: true,
      visita_id: 'visit-1',
      mensaje: 'Notificación enviada a 2 residente(s)',
    });
    const ctx = makeCtx({ channel: 'physical-hub' });

    const found = buscar.outputSchema.parse(
      await buscar.execute(ctx, { casa: '15' }),
    );
    const ids = (found.residentes ?? []).map((residente) => residente.id);
    const notified = tool.outputSchema.parse(
      await tool.execute(ctx, tool.inputSchema.parse({ residentes_ids: ids })),
    );

    expect(ids).toEqual(['user-1', 'user-2']);
    expect(conciergeService.notifyResident).toHaveBeenCalledWith(
      session,
      { residentes_ids: ['user-1', 'user-2'] },
      ctx,
    );
    expect(notified.notificado).toBe(true);
    expect(notified.cantidad_notificados).toBe(2);
    expect(JSON.stringify([found, notified])).not.toContain('Pérez');
  });

  describe('regresión cross-tenant (fix M1, §6 del diseño)', () => {
    it('NO alcanza la sesión de otro condominio: findSessionForTenant rechaza y notifyResident nunca se llama', async () => {
      const sessionDeCondominioB = makeSession('condo-B');
      conciergeService.findSessionForTenant.mockImplementation(
        realFindSessionForTenant(sessionDeCondominioB),
      );
      const ctxDeCondominioA = makeCtx({
        tenantId: 'condo-A',
        isSuperAdmin: false,
      });

      await expect(
        tool.execute(ctxDeCondominioA, { residentes_ids: ['user-1'] }),
      ).rejects.toThrow(ForbiddenException);

      expect(conciergeService.notifyResident).not.toHaveBeenCalled();
    });

    it('SÍ alcanza la sesión cuando pertenece al mismo condominio del ctx', async () => {
      const sessionDeCondominioA = makeSession('condo-A');
      conciergeService.findSessionForTenant.mockImplementation(
        realFindSessionForTenant(sessionDeCondominioA),
      );
      conciergeService.notifyResident.mockResolvedValue({
        notificado: true,
        mensaje: 'ok',
      });
      const ctxDeCondominioA = makeCtx({
        tenantId: 'condo-A',
        isSuperAdmin: false,
      });

      await expect(
        tool.execute(ctxDeCondominioA, { residentes_ids: ['user-1'] }),
      ).resolves.toEqual({ notificado: true, mensaje: 'ok' });
      expect(conciergeService.notifyResident).toHaveBeenCalledTimes(1);
    });

    it('un super-admin SÍ puede alcanzar una sesión de cualquier condominio (bypass intencional)', async () => {
      const sessionDeCondominioB = makeSession('condo-B');
      conciergeService.findSessionForTenant.mockImplementation(
        realFindSessionForTenant(sessionDeCondominioB),
      );
      conciergeService.notifyResident.mockResolvedValue({
        notificado: true,
        mensaje: 'ok',
      });
      const ctxSuperAdmin = makeCtx({
        tenantId: 'condo-A',
        isSuperAdmin: true,
      });

      await expect(
        tool.execute(ctxSuperAdmin, { residentes_ids: ['user-1'] }),
      ).resolves.toEqual({ notificado: true, mensaje: 'ok' });
    });
  });
});
