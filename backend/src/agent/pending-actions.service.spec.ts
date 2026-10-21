import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Repository } from 'typeorm';
import {
  PENDING_ACTION_MAX_AGE_MS,
  PendingActionsService,
} from './pending-actions.service';
import {
  PendingAction,
  PendingActionStatus,
} from './entities/pending-action.entity';
import { ToolRegistryService } from './tool-registry.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LogsService } from '../logs/logs.service';
import { DigitalConciergeService } from '../digital-concierge/services/digital-concierge.service';
import {
  ConciergeSession,
  SessionStatus,
} from '../digital-concierge/entities/concierge-session.entity';
import { HubGateway } from '../hub/hub.gateway';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Fase 2, Bloque F2.1 — cobertura del mecanismo de autonomía/aprobación
 * (docs/modulos/agente-cerebro.md §12), extendida en la revisión pre-F2.2
 * (FIX 1-4, ver docstrings de `PendingActionsService`). NO llama al LLM ni a
 * una BD real: el `Repository<PendingAction>` se mockea con un Map en
 * memoria que replica el comportamiento REAL de las operaciones que el
 * servicio usa.
 *
 * `update(criteria, partial)` evalúa `criteria.status` de la MISMA forma que
 * Postgres evaluaría el WHERE real, incluyendo los operadores de TypeORM que
 * el servicio usa hoy (`In([...])`) — un mock que solo distinguiera "definido
 * vs no definido" (como el que existía antes de esta revisión) no expone la
 * carrera del FIX 1: bajo ese mock, tanto el código viejo (`Not(EXECUTED)`)
 * como el nuevo (`In([PENDING, FAILED])`) "parecían" funcionar igual.
 */
function matchesStatusCriteria(
  current: PendingActionStatus,
  criteria: unknown,
): boolean {
  if (criteria === undefined) {
    return true;
  }
  if (
    criteria !== null &&
    typeof criteria === 'object' &&
    'type' in (criteria as Record<string, unknown>)
  ) {
    // Operador de TypeORM (`Not`, `In`, etc.) — mismos getters `.type`/`.value`
    // que expone `FindOperator` en runtime.
    const operator = criteria as { type: string; value: unknown };
    if (operator.type === 'not') {
      return current !== operator.value;
    }
    if (operator.type === 'in') {
      return (operator.value as PendingActionStatus[]).includes(current);
    }
    throw new Error(
      `Operador de status no soportado en el mock: ${operator.type}`,
    );
  }
  return current === criteria;
}

describe('PendingActionsService', () => {
  let service: PendingActionsService;
  let store: Map<string, PendingAction>;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    update: jest.Mock;
  };
  let toolRegistry: jest.Mocked<Pick<ToolRegistryService, 'get'>>;
  let notificationsService: jest.Mocked<
    Pick<NotificationsService, 'notifyByRoleForOrganization'>
  >;
  let logsService: jest.Mocked<Pick<LogsService, 'log'>>;
  let conciergeService: jest.Mocked<
    Pick<DigitalConciergeService, 'findSessionForTenant'>
  >;
  let hubGateway: jest.Mocked<Pick<HubGateway, 'sendVisitorResponse'>>;
  let idCounter: number;

  const baseCtx: AuthorizedContext = {
    tenantId: 'condo-A',
    isSuperAdmin: false,
    userId: undefined,
    role: 'hub',
    channel: 'physical-hub',
    scopes: ['digital-concierge.access'],
    requestId: 'req-1',
    sessionId: 'session-1',
  };

  const activeSession = {
    id: 'concierge-session-row-1',
    sessionId: 'session-1',
    status: SessionStatus.ACTIVE,
    organizationId: 'condo-A',
    hubId: null,
    startTime: new Date(),
  } as ConciergeSession;

  function makeTool(
    overrides: Partial<VigiliaTool<{ x: string }, { ok: boolean }>> = {},
  ): VigiliaTool<{ x: string }, { ok: boolean }> {
    return {
      name: 'abrir_porton_test',
      description: 'tool de test que requiere aprobación',
      inputSchema: z.object({ x: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      access: 'write',
      requiresApproval: true,
      requiredScopes: ['digital-concierge.access'],
      allowedChannels: ['physical-hub', 'web-kiosk', 'human'],
      execute: jest.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    };
  }

  beforeEach(() => {
    store = new Map();
    idCounter = 0;

    repo = {
      create: jest.fn(
        (partial: Partial<PendingAction>) => ({ ...partial }) as PendingAction,
      ),
      save: jest.fn((entity: PendingAction) => {
        const id = entity.id ?? `pending-${++idCounter}`;
        // Réplica de `@CreateDateColumn`: la BD fija `createdAt` al insertar.
        const saved = {
          ...entity,
          id,
          createdAt: entity.createdAt ?? new Date(),
        };
        store.set(id, saved);
        return Promise.resolve(saved);
      }),
      findOne: jest.fn(({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(store.get(id) ?? null),
      ),
      findOneOrFail: jest.fn(({ where: { id } }: { where: { id: string } }) => {
        const found = store.get(id);
        if (!found) return Promise.reject(new NotFoundException());
        return Promise.resolve(found);
      }),
      update: jest.fn(
        (
          criteria: { id: string; status?: unknown },
          partial: Partial<PendingAction>,
        ) => {
          const current = store.get(criteria.id);
          if (!current) return Promise.resolve({ affected: 0 });
          // Réplica fiel del WHERE real (ver `matchesStatusCriteria` arriba):
          // la mutación ocurre de forma síncrona, igual que en Postgres el
          // UPDATE es atómico a nivel de fila — dos invocaciones "en vuelo"
          // sobre la misma fila nunca ven un estado intermedio inconsistente.
          if (!matchesStatusCriteria(current.status, criteria.status)) {
            return Promise.resolve({ affected: 0 });
          }
          store.set(criteria.id, { ...current, ...partial });
          return Promise.resolve({ affected: 1 });
        },
      ),
    };

    toolRegistry = { get: jest.fn() };
    notificationsService = {
      notifyByRoleForOrganization: jest.fn().mockResolvedValue([]),
    };
    logsService = { log: jest.fn().mockResolvedValue(undefined) };
    conciergeService = {
      findSessionForTenant: jest.fn().mockResolvedValue(activeSession),
    };
    // Fase 4 · P4 (D7): el enrutamiento de visitor:response (solo al dueño de
    // la sesión, sin caer al condominio) vive en HubGateway.sendVisitorResponse
    // y se prueba en hub.gateway.spec.ts.
    hubGateway = { sendVisitorResponse: jest.fn().mockReturnValue(true) };

    service = new PendingActionsService(
      repo as unknown as Repository<PendingAction>,
      toolRegistry as unknown as ToolRegistryService,
      notificationsService as unknown as NotificationsService,
      logsService as unknown as LogsService,
      conciergeService as unknown as DigitalConciergeService,
      hubGateway as unknown as HubGateway,
    );
  });

  describe('create', () => {
    it('crea la PendingAction en estado pending, notifica SOLO a los conserjes del tenant, y NO ejecuta la tool', async () => {
      const tool = makeTool();

      const action = await service.create(tool, baseCtx, { x: 'a' });

      expect(action.status).toBe(PendingActionStatus.PENDING);
      expect(action.tenantId).toBe('condo-A');
      expect(action.toolName).toBe('abrir_porton_test');
      expect(action.input).toEqual({ x: 'a' });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).not.toHaveBeenCalled();
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).toHaveBeenCalledTimes(1);
      expect(
        notificationsService.notifyByRoleForOrganization,
      ).toHaveBeenCalledWith(
        'Conserje',
        'condo-A',
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ requiresAction: true }),
      );
    });
  });

  describe('approve', () => {
    it('aprueba y ejecuta la tool, marcando la acción como executed con su resultado', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });

      const { result, alreadyExecuted } = await service.approve(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-conserje-1',
      );

      expect(alreadyExecuted).toBe(false);
      expect(result).toEqual({ ok: true });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).toHaveBeenCalledWith(baseCtx, { x: 'a' });

      const stored = store.get(action.id);
      expect(stored?.status).toBe(PendingActionStatus.EXECUTED);
      expect(stored?.result).toEqual({ ok: true });
      expect(stored?.resolvedBy).toBe('user-conserje-1');
    });

    it('doble aprobación: la segunda NO re-ejecuta la tool y devuelve el mismo resultado', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });
      const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

      const first = await service.approve(action.id, tenantScope, 'user-1');
      const second = await service.approve(action.id, tenantScope, 'user-2');

      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).toHaveBeenCalledTimes(1);
      expect(first.alreadyExecuted).toBe(false);
      expect(second.alreadyExecuted).toBe(true);
      expect(second.result).toEqual(first.result);
      // La segunda aprobación NO debió sobrescribir quién resolvió la acción.
      expect(store.get(action.id)?.resolvedBy).toBe('user-1');
    });

    /**
     * FIX 1 — reproduce el bug de concurrencia real detectado en QA: dos
     * `approve()` concurrentes sobre la MISMA acción `pending` deben
     * resultar en UNA sola ejecución de `tool.execute`. Antes del fix, el
     * claim usaba `Not(EXECUTED)` — que también matchea `approved` — así que
     * ambas invocaciones concurrentes podían reclamar y ejecutar la tool.
     * `Promise.all` fuerza que ambas lleguen a `approve()` "en vuelo" al
     * mismo tiempo; el mock de `update` (ver `matchesStatusCriteria`) replica
     * la atomicidad real de un UPDATE de Postgres.
     *
     * La invariante que importa es "una sola ejecución + estado final
     * consistente" — NO qué valor exacto de `alreadyExecuted` observa el
     * perdedor: si su re-lectura ocurre mientras la tool del ganador SIGUE
     * en vuelo (`status` todavía `approved`, no `executed`), el perdedor
     * reporta `alreadyExecuted: false` con `result: null` — comportamiento
     * preexistente (no introducido por este fix) que es seguro (no ejecuta
     * de nuevo) aunque no informe el resultado final; queda anotado como
     * mejora de UX fuera de alcance de este bloque.
     */
    it('concurrencia real: dos approve() simultáneos sobre la misma acción ejecutan la tool UNA sola vez', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });
      const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

      const [first, second] = await Promise.all([
        service.approve(action.id, tenantScope, 'user-1'),
        service.approve(action.id, tenantScope, 'user-2'),
      ]);

      // Invariante crítica del FIX 1: pase lo que pase con la lectura de
      // cada lado, la tool JAMÁS se ejecuta dos veces.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).toHaveBeenCalledTimes(1);

      // Exactamente uno de los dos resultados es "la ejecución real" —
      // devuelve el resultado real y no viene marcado como ya-ejecutado.
      const outcomes = [first, second];
      const winners = outcomes.filter(
        (o) => !o.alreadyExecuted && o.result !== null,
      );
      expect(winners).toHaveLength(1);
      expect(winners[0].result).toEqual({ ok: true });

      // El estado final, independiente de lo que haya observado el
      // perdedor a mitad de carrera, siempre termina consistente.
      const stored = store.get(action.id);
      expect(stored?.status).toBe(PendingActionStatus.EXECUTED);
      expect(stored?.result).toEqual({ ok: true });
      // El `resolvedBy` quedó fijado por quien ganó el claim atómico (uno de
      // los dos, nunca sobrescrito después por el perdedor).
      expect(['user-1', 'user-2']).toContain(stored?.resolvedBy);
    });

    it('cross-tenant: rechazada con ForbiddenException, nunca ejecuta la tool', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' }); // tenant condo-A

      await expect(
        service.approve(
          action.id,
          { tenantId: 'condo-B', isSuperAdmin: false },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).not.toHaveBeenCalled();
    });

    it('un super-admin SÍ puede aprobar una acción de cualquier condominio (bypass intencional)', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' }); // tenant condo-A

      await expect(
        service.approve(
          action.id,
          { tenantId: 'condo-B', isSuperAdmin: true },
          'super-admin-1',
        ),
      ).resolves.toMatchObject({
        alreadyExecuted: false,
        result: { ok: true },
      });
    });

    it('lanza NotFoundException para una acción pendiente inexistente', async () => {
      await expect(
        service.approve(
          'no-existe',
          { tenantId: 'condo-A', isSuperAdmin: false },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si la acción ya fue rechazada', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });
      const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };
      await service.reject(action.id, tenantScope, 'user-1');

      await expect(
        service.approve(action.id, tenantScope, 'user-2'),
      ).rejects.toThrow(BadRequestException);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).not.toHaveBeenCalled();
    });

    /** FIX 2 — `tool.execute()` lanza tras la aprobación: la fila NO queda varada en `approved`. */
    describe('cuando tool.execute() lanza tras la aprobación (FIX 2)', () => {
      it('transiciona la acción a failed (con lastError) en vez de dejarla en approved', async () => {
        const tool = makeTool({
          execute: jest
            .fn()
            .mockRejectedValue(new Error('El hub no respondió')),
        });
        toolRegistry.get.mockReturnValue(tool);
        const action = await service.create(tool, baseCtx, { x: 'a' });
        const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

        await expect(
          service.approve(action.id, tenantScope, 'user-1'),
        ).rejects.toThrow('El hub no respondió');

        const stored = store.get(action.id);
        expect(stored?.status).toBe(PendingActionStatus.FAILED);
        expect(stored?.lastError).toContain('El hub no respondió');
      });

      it('permite reintentar: una segunda approve() sobre una acción failed vuelve a invocar tool.execute()', async () => {
        const execute = jest
          .fn()
          .mockRejectedValueOnce(new Error('timeout del relé'))
          .mockResolvedValueOnce({ ok: true });
        const tool = makeTool({ execute });
        toolRegistry.get.mockReturnValue(tool);
        const action = await service.create(tool, baseCtx, { x: 'a' });
        const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

        await expect(
          service.approve(action.id, tenantScope, 'user-1'),
        ).rejects.toThrow('timeout del relé');
        expect(store.get(action.id)?.status).toBe(PendingActionStatus.FAILED);

        const retried = await service.approve(action.id, tenantScope, 'user-2');

        expect(retried.alreadyExecuted).toBe(false);
        expect(retried.result).toEqual({ ok: true });
        expect(execute).toHaveBeenCalledTimes(2);
        expect(store.get(action.id)?.status).toBe(PendingActionStatus.EXECUTED);
      });
    });

    /** FIX 3 — re-validación de la ConciergeSession antes de ejecutar en diferido. */
    describe('re-validación de contexto al ejecutar diferido (FIX 3)', () => {
      it('si la ConciergeSession ya no está ACTIVE, NO ejecuta la tool y expira la acción', async () => {
        conciergeService.findSessionForTenant.mockResolvedValue({
          ...activeSession,
          status: SessionStatus.COMPLETED,
        });

        const tool = makeTool();
        toolRegistry.get.mockReturnValue(tool);
        const action = await service.create(tool, baseCtx, { x: 'a' });
        const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

        await expect(
          service.approve(action.id, tenantScope, 'user-1'),
        ).rejects.toThrow(BadRequestException);

        // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
        expect(tool.execute).not.toHaveBeenCalled();
        const stored = store.get(action.id);
        expect(stored?.status).toBe(PendingActionStatus.EXPIRED);
        expect(stored?.lastError).toContain('ya no está activa');

        // Una acción expirada es terminal: no se puede reintentar aprobando de nuevo.
        await expect(
          service.approve(action.id, tenantScope, 'user-2'),
        ).rejects.toThrow(BadRequestException);
        // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
        expect(tool.execute).not.toHaveBeenCalled();
      });

      it('si la ConciergeSession ya no existe/no pertenece al tenant, NO ejecuta la tool y expira la acción', async () => {
        conciergeService.findSessionForTenant.mockRejectedValue(
          new NotFoundException('sesión no encontrada'),
        );

        const tool = makeTool();
        toolRegistry.get.mockReturnValue(tool);
        const action = await service.create(tool, baseCtx, { x: 'a' });
        const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

        await expect(
          service.approve(action.id, tenantScope, 'user-1'),
        ).rejects.toThrow(BadRequestException);

        // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
        expect(tool.execute).not.toHaveBeenCalled();
        expect(store.get(action.id)?.status).toBe(PendingActionStatus.EXPIRED);
      });

      it('acciones sin sessionId (canal de texto) no revalidan sesión y ejecutan normalmente', async () => {
        const ctxSinSesion: AuthorizedContext = {
          ...baseCtx,
          sessionId: undefined,
        };
        const tool = makeTool();
        toolRegistry.get.mockReturnValue(tool);
        const action = await service.create(tool, ctxSinSesion, { x: 'a' });
        const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

        const { alreadyExecuted } = await service.approve(
          action.id,
          tenantScope,
          'user-1',
        );

        expect(alreadyExecuted).toBe(false);
        expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
        expect(tool.execute).toHaveBeenCalledTimes(1);
      });
    });

    /**
     * Fase 4 · P4.B (cyber B1, QA B9): el replay respeta el canal del
     * snapshot y una antigüedad máxima de 15 min.
     */
    describe('replay: canal del snapshot y antigüedad máxima', () => {
      const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

      /** Crea la acción y le reescribe campos en el "store" (la fila en BD). */
      async function storedAction(
        tool: VigiliaTool<{ x: string }, { ok: boolean }>,
        patch: Partial<PendingAction> = {},
      ): Promise<PendingAction> {
        toolRegistry.get.mockReturnValue(tool);
        const action = await service.create(tool, baseCtx, { x: 'a' });
        const updated = { ...action, ...patch };
        store.set(action.id, updated);
        return updated;
      }

      async function expectExpiredWithoutExecuting(
        tool: VigiliaTool<{ x: string }, { ok: boolean }>,
        action: PendingAction,
        lastError: string,
      ): Promise<void> {
        await expect(
          service.approve(action.id, tenantScope, 'user-1'),
        ).rejects.toThrow(BadRequestException);

        // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
        expect(tool.execute).not.toHaveBeenCalled();
        const stored = store.get(action.id);
        expect(stored?.status).toBe(PendingActionStatus.EXPIRED);
        expect(stored?.lastError).toContain(lastError);
        expect(hubGateway.sendVisitorResponse).not.toHaveBeenCalled();
      }

      it('snapshot SIN canal (anterior a P4.B o alterado): cuenta como unknown y expira sin ejecutar', async () => {
        const tool = makeTool();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se destructura solo para quitar `channel` del snapshot.
        const { channel: _omitted, ...withoutChannel } = baseCtx;
        const action = await storedAction(tool, {
          contextSnapshot: withoutChannel,
        });

        await expectExpiredWithoutExecuting(tool, action, 'canal "unknown"');
      });

      it('snapshot de un canal que la tool no permite (kiosko + apertura): expira sin ejecutar', async () => {
        const tool = makeTool({ allowedChannels: ['physical-hub', 'human'] });
        const action = await storedAction(tool, {
          contextSnapshot: { ...baseCtx, channel: 'web-kiosk' },
        });

        await expectExpiredWithoutExecuting(tool, action, 'canal "web-kiosk"');
      });

      it('acción con más de 15 min: expira sin ejecutar (sin depender del timeout de la sesión)', async () => {
        const tool = makeTool();
        const action = await storedAction(tool, {
          createdAt: new Date(Date.now() - PENDING_ACTION_MAX_AGE_MS - 1_000),
        });

        await expectExpiredWithoutExecuting(tool, action, 'más de 15 minutos');
        expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
      });

      it('sesión ACTIVE pero con más de 15 min (timeout aún no aplicado): expira sin ejecutar', async () => {
        conciergeService.findSessionForTenant.mockResolvedValue({
          ...activeSession,
          startTime: new Date(Date.now() - PENDING_ACTION_MAX_AGE_MS - 1_000),
        });
        const tool = makeTool();
        const action = await storedAction(tool);

        await expectExpiredWithoutExecuting(tool, action, 'más de 15 minutos');
      });

      it('canal permitido y dentro de plazo: ejecuta con el canal del snapshot', async () => {
        const tool = makeTool({ allowedChannels: ['physical-hub', 'human'] });
        const action = await storedAction(tool);

        await service.approve(action.id, tenantScope, 'user-1');

        // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
        expect(tool.execute).toHaveBeenCalledWith(
          expect.objectContaining({ channel: 'physical-hub' }),
          { x: 'a' },
        );
      });
    });
  });

  describe('reject', () => {
    it('rechaza — estado terminal, la tool nunca se ejecuta', async () => {
      const tool = makeTool();
      const action = await service.create(tool, baseCtx, { x: 'a' });
      const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };

      const rejected = await service.reject(action.id, tenantScope, 'user-1');

      expect(rejected.status).toBe(PendingActionStatus.REJECTED);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si la acción ya fue ejecutada', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });
      const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };
      await service.approve(action.id, tenantScope, 'user-1');

      await expect(
        service.reject(action.id, tenantScope, 'user-2'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza con ForbiddenException si la acción no pertenece al tenant', async () => {
      const tool = makeTool();
      const action = await service.create(tool, baseCtx, { x: 'a' }); // tenant condo-A

      await expect(
        service.reject(
          action.id,
          { tenantId: 'condo-B', isSuperAdmin: false },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('escalamiento y notificaciones tenant-scoped (FIX 4)', () => {
    it('notifyEscalation pasa el tenantId de la acción a notifyByRoleForOrganization', async () => {
      const tool = makeTool();
      await service.create(
        tool,
        { ...baseCtx, tenantId: 'condo-B' },
        { x: 'a' },
      );

      expect(
        notificationsService.notifyByRoleForOrganization,
      ).toHaveBeenCalledWith(
        'Conserje',
        'condo-B',
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.anything(),
      );
    });

    it('notifyResolution (al ejecutar) también pasa el tenantId de la acción, no el del aprobador', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(
        tool,
        { ...baseCtx, tenantId: 'condo-B' },
        { x: 'a' },
      );

      await service.approve(
        action.id,
        { tenantId: 'condo-B', isSuperAdmin: false },
        'user-1',
      );

      expect(
        notificationsService.notifyByRoleForOrganization,
      ).toHaveBeenLastCalledWith(
        'Conserje',
        'condo-B',
        expect.anything(),
        expect.any(String),
        expect.any(String),
        expect.anything(),
      );
    });
  });

  /**
   * `notifyVisitorLive` avisa al visitante que sigue en la llamada por el
   * MISMO canal que `DigitalConciergeService.respondToVisitor`
   * (`visitor:response:<sessionId>`). Fase 4 · P4: va por
   * `HubGateway.sendVisitorResponse` (solo al dueño de la sesión) y todo
   * payload lleva `approved` y `entryRegistered`; `entryRegistered` es `true`
   * solo si la tool realmente abrió el acceso.
   */
  describe('aviso en vivo al visitante (visitor:response:<sessionId>)', () => {
    function lastVisitorResponse(): [unknown, Record<string, unknown>] {
      const calls = hubGateway.sendVisitorResponse.mock.calls as unknown[][];
      expect(calls).toHaveLength(1);
      return calls[0] as [unknown, Record<string, unknown>];
    }

    it('approve() de una tool que no abre: approved true y entryRegistered false (nunca "pase")', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' }); // baseCtx.sessionId === 'session-1'

      await service.approve(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      const [target, payload] = lastVisitorResponse();
      expect(target).toBe(activeSession);
      expect(payload).toEqual(
        expect.objectContaining({
          approved: true,
          entryRegistered: false,
          outcome: 'approved',
          toolName: 'abrir_porton_test',
          pendingActionId: action.id,
        }),
      );
    });

    it('approve() de abrir_acceso que abrió (abierto: true): approved y entryRegistered true', async () => {
      const tool = makeTool({
        name: 'abrir_acceso',
        outputSchema: z.object({ abierto: z.boolean(), mensaje: z.string() }),
        execute: jest
          .fn()
          .mockResolvedValue({ abierto: true, mensaje: 'Listo' }),
      } as unknown as Partial<VigiliaTool<{ x: string }, { ok: boolean }>>);
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });

      await service.approve(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      const [, payload] = lastVisitorResponse();
      expect(payload).toEqual(
        expect.objectContaining({ approved: true, entryRegistered: true }),
      );
    });

    it('approve() de abrir_acceso sin hub físico (abierto: false): entryRegistered false', async () => {
      const tool = makeTool({
        name: 'abrir_acceso',
        outputSchema: z.object({ abierto: z.boolean(), mensaje: z.string() }),
        execute: jest
          .fn()
          .mockResolvedValue({ abierto: false, mensaje: 'No pude' }),
      } as unknown as Partial<VigiliaTool<{ x: string }, { ok: boolean }>>);
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });

      await service.approve(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      const [, payload] = lastVisitorResponse();
      expect(payload).toEqual(
        expect.objectContaining({ approved: true, entryRegistered: false }),
      );
    });

    it('reject() con sessionId y sesión ACTIVE: approved false, entryRegistered false, outcome "rejected"', async () => {
      const tool = makeTool();
      const action = await service.create(tool, baseCtx, { x: 'a' });

      await service.reject(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      const [, payload] = lastVisitorResponse();
      expect(payload).toEqual(
        expect.objectContaining({
          approved: false,
          entryRegistered: false,
          outcome: 'rejected',
        }),
      );
    });

    it('acciones sin sessionId (canal de texto): approve()/reject() no emiten nada', async () => {
      const ctxSinSesion: AuthorizedContext = {
        ...baseCtx,
        sessionId: undefined,
      };

      const tool1 = makeTool();
      toolRegistry.get.mockReturnValue(tool1);
      const approved = await service.create(tool1, ctxSinSesion, { x: 'a' });
      await service.approve(
        approved.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      const tool2 = makeTool();
      const rejected = await service.create(tool2, ctxSinSesion, { x: 'b' });
      await service.reject(
        rejected.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      expect(hubGateway.sendVisitorResponse).not.toHaveBeenCalled();
      expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
    });

    it('sesión ya no ACTIVE al momento de avisar: no emite (best-effort, no rompe el reject)', async () => {
      const tool = makeTool();
      const action = await service.create(tool, baseCtx, { x: 'a' });
      conciergeService.findSessionForTenant.mockResolvedValue({
        ...activeSession,
        status: SessionStatus.COMPLETED,
      });

      const rejected = await service.reject(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      expect(rejected.status).toBe(PendingActionStatus.REJECTED);
      expect(hubGateway.sendVisitorResponse).not.toHaveBeenCalled();
    });

    it('la sesión ya no existe/no pertenece al tenant al momento de avisar: no emite ni rompe el reject', async () => {
      const tool = makeTool();
      const action = await service.create(tool, baseCtx, { x: 'a' });
      conciergeService.findSessionForTenant.mockRejectedValue(
        new NotFoundException('sesión no encontrada'),
      );

      const rejected = await service.reject(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      expect(rejected.status).toBe(PendingActionStatus.REJECTED);
      expect(hubGateway.sendVisitorResponse).not.toHaveBeenCalled();
    });
  });

  /**
   * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): `pending_actions`
   * con los datos personales minimizados, sin romper el replay. Ver el
   * docstring de `replaySnapshotOf` en el servicio.
   */
  describe('datos personales al persistir (Fase 4 · P7.L)', () => {
    const tenantScope = { tenantId: 'condo-A', isSuperAdmin: false };
    const PII_INPUT = {
      nombre: 'Juan Pérez',
      rut: '12.345.678-5',
      tipo: 'porton',
    };
    const REDACTED_INPUT = {
      nombre: '[REDACTED]',
      rut: '***-5',
      tipo: 'porton',
    };
    const PII_OUTPUT = { ok: true, propietario: 'Ana Soto', patente: 'ABCD12' };

    /** Tool de prueba que escala, con datos personales en input y salida. */
    function makePiiTool(execute: jest.Mock): VigiliaTool<unknown, unknown> {
      return {
        name: 'registrar_visitante_test',
        description: 'tool de test con datos personales',
        inputSchema: z.object({
          nombre: z.string(),
          rut: z.string(),
          tipo: z.string(),
        }),
        outputSchema: z.object({
          ok: z.boolean(),
          propietario: z.string(),
          patente: z.string(),
        }),
        access: 'write',
        requiresApproval: true,
        requiredScopes: ['digital-concierge.access'],
        allowedChannels: ['physical-hub', 'web-kiosk', 'human'],
        execute,
      };
    }

    it('contextSnapshot: solo los campos del replay, copiados uno a uno', async () => {
      const ctxWithExtra = {
        ...baseCtx,
        userId: 'user-1',
        visitorName: 'Juan Pérez',
      } as AuthorizedContext;

      const action = await service.create(makeTool(), ctxWithExtra, {
        x: 'a',
      });

      expect(store.get(action.id)?.contextSnapshot).toStrictEqual({
        tenantId: 'condo-A',
        isSuperAdmin: false,
        userId: 'user-1',
        role: 'hub',
        channel: 'physical-hub',
        scopes: ['digital-concierge.access'],
        requestId: 'req-1',
        sessionId: 'session-1',
      });
    });

    it('input íntegro hasta ejecutar; al terminar, input y result redactados (la respuesta al aprobador no)', async () => {
      const execute = jest.fn().mockResolvedValue(PII_OUTPUT);
      const tool = makePiiTool(execute);
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, PII_INPUT);
      expect(store.get(action.id)?.input).toEqual(PII_INPUT);

      const first = await service.approve(action.id, tenantScope, 'user-1');

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'condo-A',
          channel: 'physical-hub',
        }),
        PII_INPUT,
      );
      expect(first.result).toEqual(PII_OUTPUT);
      const stored = store.get(action.id);
      expect(stored?.status).toBe(PendingActionStatus.EXECUTED);
      expect(stored?.input).toEqual(REDACTED_INPUT);
      expect(stored?.result).toEqual({
        ok: true,
        propietario: '[REDACTED]',
        patente: 'AB**12',
      });

      const second = await service.approve(action.id, tenantScope, 'user-2');

      expect(second.alreadyExecuted).toBe(true);
      expect(second.result).toEqual(stored?.result);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('failed: el input sigue íntegro para el reintento y lastError no guarda la patente', async () => {
      const execute = jest
        .fn()
        .mockRejectedValueOnce(new Error('El hub no abrió para ABCD12'))
        .mockResolvedValueOnce(PII_OUTPUT);
      const tool = makePiiTool(execute);
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, PII_INPUT);

      await expect(
        service.approve(action.id, tenantScope, 'user-1'),
      ).rejects.toThrow('El hub no abrió');
      const failed = store.get(action.id);
      expect(failed?.status).toBe(PendingActionStatus.FAILED);
      expect(failed?.input).toEqual(PII_INPUT);
      expect(failed?.lastError).toBe('El hub no abrió para AB**12');

      await service.approve(action.id, tenantScope, 'user-2');

      expect(execute).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenLastCalledWith(expect.anything(), PII_INPUT);
      expect(store.get(action.id)?.input).toEqual(REDACTED_INPUT);
    });

    it('rejected y expired (terminales): input redactado', async () => {
      const execute = jest.fn();
      const tool = makePiiTool(execute);
      toolRegistry.get.mockReturnValue(tool);

      const toReject = await service.create(tool, baseCtx, PII_INPUT);
      await service.reject(toReject.id, tenantScope, 'user-1');
      expect(store.get(toReject.id)?.status).toBe(PendingActionStatus.REJECTED);
      expect(store.get(toReject.id)?.input).toEqual(REDACTED_INPUT);

      conciergeService.findSessionForTenant.mockResolvedValue({
        ...activeSession,
        status: SessionStatus.COMPLETED,
      });
      const toExpire = await service.create(tool, baseCtx, PII_INPUT);
      await expect(
        service.approve(toExpire.id, tenantScope, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(store.get(toExpire.id)?.status).toBe(PendingActionStatus.EXPIRED);
      expect(store.get(toExpire.id)?.input).toEqual(REDACTED_INPUT);
      expect(execute).not.toHaveBeenCalled();
    });

    it('la auditoría de la ejecución (system_logs) guarda input y output redactados', async () => {
      const tool = makePiiTool(jest.fn().mockResolvedValue(PII_OUTPUT));
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, PII_INPUT);

      await service.approve(action.id, tenantScope, 'user-1');

      expect(logsService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            toolName: 'registrar_visitante_test',
            input: REDACTED_INPUT,
            output: { ok: true, propietario: '[REDACTED]', patente: 'AB**12' },
          }) as unknown,
        }),
      );
    });
  });
});
