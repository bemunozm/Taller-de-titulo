import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificarResidenteTool } from './notificar-residente.tool';
import {
  DigitalConciergeService,
  type TenantScope,
} from '../../digital-concierge/services/digital-concierge.service';
import type { ConciergeSession } from '../../digital-concierge/entities/concierge-session.entity';
import type { AuthorizedContext } from '../types/authorized-context.type';

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
