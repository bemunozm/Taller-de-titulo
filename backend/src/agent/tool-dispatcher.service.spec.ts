import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  ToolDispatcherService,
  type PendingApprovalResult,
} from './tool-dispatcher.service';
import { ToolRegistryService } from './tool-registry.service';
import { PendingActionsService } from './pending-actions.service';
import {
  PendingActionStatus,
  type PendingAction,
} from './entities/pending-action.entity';
import { LogsService } from '../logs/logs.service';
import { LogType } from '../logs/entities/system-log.entity';
import type { CreateSystemLogDto } from '../logs/dto/create-system-log.dto';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Fase 1, Bloque A2t — cobertura del `ToolDispatcherService`
 * (docs/modulos/agente-cerebro.md §5). NO llama al LLM ni a OpenAI: se
 * ejercita el dispatcher directo, con una `VigiliaTool` de prueba y
 * `ToolRegistryService`/`LogsService`/`PendingActionsService` mockeados.
 *
 * Fase 2, Bloque F2.1 (§12 del diseño): agrega cobertura del camino de
 * escalada (`requiresApproval: true`) — el dispatcher NO debe ejecutar la
 * tool, debe crear la `PendingAction` (vía `PendingActionsService.create`) y
 * devolver el envelope fijo `{ pendiente: true, ... }`, auditando igual que
 * el camino directo.
 */
describe('ToolDispatcherService', () => {
  let dispatcher: ToolDispatcherService;
  let registry: jest.Mocked<Pick<ToolRegistryService, 'get'>>;
  let logsService: jest.Mocked<Pick<LogsService, 'log'>>;
  let pendingActionsService: jest.Mocked<Pick<PendingActionsService, 'create'>>;

  const baseCtx: AuthorizedContext = {
    tenantId: 'tenant-A',
    isSuperAdmin: false,
    userId: 'user-1',
    role: 'user',
    scopes: ['digital-concierge.access'],
    requestId: 'req-1',
  };

  function makeTool(
    overrides: Partial<VigiliaTool<{ casa: string }, { ok: boolean }>> = {},
  ): VigiliaTool<{ casa: string }, { ok: boolean }> {
    return {
      name: 'fake_tool',
      description: 'tool de test',
      inputSchema: z.object({ casa: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      access: 'read',
      requiresApproval: false,
      requiredScopes: ['digital-concierge.access'],
      execute: jest.fn(),
      ...overrides,
    };
  }

  /** Última llamada de auditoría, tipada — evita `any` en las aserciones. */
  function lastAuditCall(): CreateSystemLogDto {
    const calls = logsService.log.mock.calls;
    return calls[calls.length - 1][0];
  }

  beforeEach(() => {
    registry = { get: jest.fn() };
    logsService = { log: jest.fn().mockResolvedValue(undefined) };
    pendingActionsService = { create: jest.fn() };

    dispatcher = new ToolDispatcherService(
      registry as unknown as ToolRegistryService,
      logsService as unknown as LogsService,
      pendingActionsService as unknown as PendingActionsService,
    );
  });

  describe('resolve', () => {
    it('devuelve la tool cuando existe en el catálogo', () => {
      const tool = makeTool();
      registry.get.mockReturnValue(tool);

      expect(dispatcher.resolve('fake_tool')).toBe(tool);
      expect(registry.get).toHaveBeenCalledWith('fake_tool');
    });

    it('lanza NotFoundException para una tool desconocida (error manejado)', () => {
      registry.get.mockReturnValue(undefined);

      expect(() => dispatcher.resolve('tool_inexistente')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('execute', () => {
    it('deniega por scope faltante SIN validar el input ni ejecutar la tool (scope antes que Zod)', async () => {
      const tool = makeTool({ requiredScopes: ['otro.scope'] });
      const ctxSinScope: AuthorizedContext = { ...baseCtx, scopes: [] };
      // Input deliberadamente inválido para el schema — si el dispatcher
      // llegara a invocar Zod, también lanzaría, pero con `validationError:
      // true`. Que la auditoría marque `false` prueba que el scope-check
      // cortó ANTES de tocar Zod.
      const inputInvalidoParaElSchema = { casa: 123 } as unknown;

      await expect(
        dispatcher.execute(tool, ctxSinScope, inputInvalidoParaElSchema),
      ).rejects.toThrow(ForbiddenException);

      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).not.toHaveBeenCalled();
      expect(logsService.log).toHaveBeenCalledTimes(1);
      const audit = lastAuditCall();
      expect(audit.metadata?.success).toBe(false);
      expect(audit.metadata?.validationError).toBe(false);
    });

    it('audita y lanza cuando el input no pasa Zod, sin ejecutar la tool', async () => {
      const tool = makeTool();

      await expect(
        dispatcher.execute(tool, baseCtx, { casa: 123 } as unknown),
      ).rejects.toThrow();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).not.toHaveBeenCalled();
      expect(logsService.log).toHaveBeenCalledTimes(1);
      const audit = lastAuditCall();
      expect(audit.metadata?.success).toBe(false);
      expect(audit.metadata?.validationError).toBe(true);
    });

    it('lanza cuando el output no pasa Zod, DESPUÉS de haber ejecutado la tool', async () => {
      const tool = makeTool({
        execute: jest.fn().mockResolvedValue({ ok: 'no-es-boolean' }),
      });

      await expect(
        dispatcher.execute(tool, baseCtx, { casa: '15' }),
      ).rejects.toThrow();

      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).toHaveBeenCalledTimes(1);
      expect(logsService.log).toHaveBeenCalledTimes(1);
      const audit = lastAuditCall();
      expect(audit.metadata?.success).toBe(false);
    });

    it('ejecuta y audita success:true en el camino feliz', async () => {
      const tool = makeTool({
        execute: jest.fn().mockResolvedValue({ ok: true }),
      });

      const result = await dispatcher.execute(tool, baseCtx, { casa: '15' });

      expect(result).toEqual({ ok: true });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).toHaveBeenCalledWith(baseCtx, { casa: '15' });
      expect(logsService.log).toHaveBeenCalledTimes(1);
      const audit = lastAuditCall();
      expect(audit.metadata?.success).toBe(true);
      expect(audit.type).toBe(LogType.AGENT_TOOL_CALL);
      expect(audit.correlationId).toBe(baseCtx.requestId);
    });

    it('con requiredScopes: [] ejecuta para cualquier contexto autenticado (sin gate de permisos)', async () => {
      const tool = makeTool({
        requiredScopes: [],
        execute: jest.fn().mockResolvedValue({ ok: true }),
      });
      const ctxSinScopes: AuthorizedContext = { ...baseCtx, scopes: [] };

      await expect(
        dispatcher.execute(tool, ctxSinScopes, { casa: '15' }),
      ).resolves.toEqual({ ok: true });
      // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
      expect(tool.execute).toHaveBeenCalledTimes(1);
    });

    describe('requiresApproval (Fase 2, Bloque F2.1 — §12 del diseño)', () => {
      function makePendingAction(
        overrides: Partial<PendingAction> = {},
      ): PendingAction {
        return {
          id: 'pending-1',
          tenantId: 'tenant-A',
          sessionId: null,
          toolName: 'fake_tool',
          input: { casa: '15' },
          requestId: 'req-1',
          status: PendingActionStatus.PENDING,
          contextSnapshot: baseCtx,
          result: null,
          createdAt: new Date(),
          resolvedBy: null,
          resolvedAt: null,
          ...overrides,
        } as PendingAction;
      }

      it('NO ejecuta la tool: crea la PendingAction y devuelve el envelope { pendiente: true, ... }', async () => {
        const tool = makeTool({ requiresApproval: true });
        pendingActionsService.create.mockResolvedValue(makePendingAction());

        const result = await dispatcher.execute(tool, baseCtx, { casa: '15' });

        // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
        expect(tool.execute).not.toHaveBeenCalled();
        expect(pendingActionsService.create).toHaveBeenCalledWith(
          tool,
          baseCtx,
          { casa: '15' },
        );
        const pendingResult = result as PendingApprovalResult;
        expect(pendingResult.pendiente).toBe(true);
        expect(pendingResult.pendingActionId).toBe('pending-1');
        expect(pendingResult.mensaje).toContain('fake_tool');
      });

      it('audita success:true en la escalada (mismo camino de auditoría que la ejecución directa)', async () => {
        const tool = makeTool({ requiresApproval: true });
        pendingActionsService.create.mockResolvedValue(makePendingAction());

        await dispatcher.execute(tool, baseCtx, { casa: '15' });

        expect(logsService.log).toHaveBeenCalledTimes(1);
        const audit = lastAuditCall();
        expect(audit.type).toBe(LogType.AGENT_TOOL_CALL);
        expect(audit.metadata?.success).toBe(true);
        expect(audit.correlationId).toBe(baseCtx.requestId);
      });

      it('sigue exigiendo el scope ANTES de escalar — no crea PendingAction sin permiso', async () => {
        const tool = makeTool({
          requiresApproval: true,
          requiredScopes: ['otro.scope'],
        });
        const ctxSinScope: AuthorizedContext = { ...baseCtx, scopes: [] };

        await expect(
          dispatcher.execute(tool, ctxSinScope, { casa: '15' }),
        ).rejects.toThrow(ForbiddenException);

        expect(pendingActionsService.create).not.toHaveBeenCalled();
      });

      describe('requiresApproval dinámico — función (Fase 2, Bloque F2.2 — §12 del diseño)', () => {
        it('evalúa la función con (ctx, parsedInput) y escala cuando resuelve true', async () => {
          const requiresApprovalFn = jest.fn().mockResolvedValue(true);
          const tool = makeTool({ requiresApproval: requiresApprovalFn });
          pendingActionsService.create.mockResolvedValue(makePendingAction());

          const result = await dispatcher.execute(tool, baseCtx, {
            casa: '15',
          });

          expect(requiresApprovalFn).toHaveBeenCalledWith(baseCtx, {
            casa: '15',
          });
          // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
          expect(tool.execute).not.toHaveBeenCalled();
          expect((result as PendingApprovalResult).pendiente).toBe(true);
        });

        it('evalúa la función y ejecuta directo cuando resuelve false (autonomía)', async () => {
          const requiresApprovalFn = jest.fn().mockResolvedValue(false);
          const tool = makeTool({
            requiresApproval: requiresApprovalFn,
            execute: jest.fn().mockResolvedValue({ ok: true }),
          });

          const result = await dispatcher.execute(tool, baseCtx, {
            casa: '15',
          });

          expect(result).toEqual({ ok: true });
          // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
          expect(tool.execute).toHaveBeenCalledWith(baseCtx, { casa: '15' });
          expect(pendingActionsService.create).not.toHaveBeenCalled();
        });

        it('soporta una función SÍNCRONA (boolean, no Promise) además de async', async () => {
          const tool = makeTool({
            requiresApproval: () => false,
            execute: jest.fn().mockResolvedValue({ ok: true }),
          });

          await expect(
            dispatcher.execute(tool, baseCtx, { casa: '15' }),
          ).resolves.toEqual({ ok: true });
        });

        it('si la función lanza, audita el fallo y propaga el error SIN crear PendingAction ni ejecutar la tool', async () => {
          const tool = makeTool({
            requiresApproval: jest
              .fn()
              .mockRejectedValue(
                new ForbiddenException('sesión de otro condominio'),
              ),
          });

          await expect(
            dispatcher.execute(tool, baseCtx, { casa: '15' }),
          ).rejects.toThrow(ForbiddenException);

          expect(pendingActionsService.create).not.toHaveBeenCalled();
          // eslint-disable-next-line @typescript-eslint/unbound-method -- jest.fn() mock, no `this` binding involved
          expect(tool.execute).not.toHaveBeenCalled();
          expect(logsService.log).toHaveBeenCalledTimes(1);
          const audit = lastAuditCall();
          expect(audit.metadata?.success).toBe(false);
        });

        it('sigue exigiendo el scope ANTES de evaluar la función de autonomía', async () => {
          const requiresApprovalFn = jest.fn().mockResolvedValue(true);
          const tool = makeTool({
            requiresApproval: requiresApprovalFn,
            requiredScopes: ['otro.scope'],
          });
          const ctxSinScope: AuthorizedContext = { ...baseCtx, scopes: [] };

          await expect(
            dispatcher.execute(tool, ctxSinScope, { casa: '15' }),
          ).rejects.toThrow(ForbiddenException);

          expect(requiresApprovalFn).not.toHaveBeenCalled();
        });
      });
    });
  });
});
