import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Repository } from 'typeorm';
import { PendingActionsService } from './pending-actions.service';
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
  let hubGateway: jest.Mocked<
    Pick<HubGateway, 'isHubConnected' | 'sendToHub' | 'sendToOrganization'>
  >;
  let idCounter: number;

  const baseCtx: AuthorizedContext = {
    tenantId: 'condo-A',
    isSuperAdmin: false,
    userId: undefined,
    role: 'hub',
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
        const saved = { ...entity, id } as PendingAction;
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
    hubGateway = {
      isHubConnected: jest.fn().mockReturnValue(false),
      sendToHub: jest.fn().mockReturnValue(true),
      sendToOrganization: jest.fn(),
    };

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
        } as ConciergeSession);

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
   * Gap de UX cerrado en esta tarea: hasta ahora `approve`/`reject` solo
   * notificaban a los conserjes (in-app) — el visitante que sigue en la
   * llamada de citófono nunca se enteraba en vivo. `notifyVisitorLive` reusa
   * el MISMO canal (`visitor:response:<sessionId>`) y mecanismo
   * (`HubGateway.sendToHub`/`sendToOrganization`) que
   * `DigitalConciergeService.respondToVisitor` — acá se mockea `HubGateway`
   * directo (mismo patrón que `abrir-acceso.tool.spec.ts`), NO
   * `DigitalConciergeService.respondToVisitor`.
   */
  describe('aviso en vivo al visitante (visitor:response:<sessionId>)', () => {
    it('approve() con sessionId y sesión ACTIVE emite visitor:response:<sessionId> con outcome "approved"', async () => {
      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' }); // baseCtx.sessionId === 'session-1'

      await service.approve(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(
        'condo-A',
        'visitor:response:session-1',
        expect.objectContaining({
          sessionId: 'session-1',
          outcome: 'approved',
          toolName: 'abrir_porton_test',
        }),
      );
      expect(hubGateway.sendToHub).not.toHaveBeenCalled();
    });

    it('approve() dirige el evento al hub propio de la sesión cuando está conectado (mismo criterio que abrir_acceso)', async () => {
      conciergeService.findSessionForTenant.mockResolvedValue({
        ...activeSession,
        hubId: 'hub-1',
      } as ConciergeSession);
      hubGateway.isHubConnected.mockReturnValue(true);

      const tool = makeTool();
      toolRegistry.get.mockReturnValue(tool);
      const action = await service.create(tool, baseCtx, { x: 'a' });

      await service.approve(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      expect(hubGateway.sendToHub).toHaveBeenCalledWith(
        'hub-1',
        'visitor:response:session-1',
        expect.objectContaining({ outcome: 'approved' }),
      );
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
    });

    it('reject() con sessionId y sesión ACTIVE emite visitor:response:<sessionId> con outcome "rejected"', async () => {
      const tool = makeTool();
      const action = await service.create(tool, baseCtx, { x: 'a' });

      await service.reject(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      expect(hubGateway.sendToOrganization).toHaveBeenCalledWith(
        'condo-A',
        'visitor:response:session-1',
        expect.objectContaining({
          sessionId: 'session-1',
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

      expect(hubGateway.sendToHub).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
      expect(conciergeService.findSessionForTenant).not.toHaveBeenCalled();
    });

    it('sesión ya no ACTIVE al momento de avisar: no emite (best-effort, no rompe el reject)', async () => {
      const tool = makeTool();
      const action = await service.create(tool, baseCtx, { x: 'a' });
      conciergeService.findSessionForTenant.mockResolvedValue({
        ...activeSession,
        status: SessionStatus.COMPLETED,
      } as ConciergeSession);

      const rejected = await service.reject(
        action.id,
        { tenantId: 'condo-A', isSuperAdmin: false },
        'user-1',
      );

      expect(rejected.status).toBe(PendingActionStatus.REJECTED);
      expect(hubGateway.sendToHub).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
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
      expect(hubGateway.sendToHub).not.toHaveBeenCalled();
      expect(hubGateway.sendToOrganization).not.toHaveBeenCalled();
    });
  });
});
