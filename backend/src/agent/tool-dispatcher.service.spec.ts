import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ToolDispatcherService } from './tool-dispatcher.service';
import { ToolRegistryService } from './tool-registry.service';
import { LogsService } from '../logs/logs.service';
import { LogType } from '../logs/entities/system-log.entity';
import type { CreateSystemLogDto } from '../logs/dto/create-system-log.dto';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Fase 1, Bloque A2t — cobertura del `ToolDispatcherService`
 * (docs/modulos/agente-cerebro.md §5). NO llama al LLM ni a OpenAI: se
 * ejercita el dispatcher directo, con una `VigiliaTool` de prueba y
 * `ToolRegistryService`/`LogsService` mockeados.
 */
describe('ToolDispatcherService', () => {
  let dispatcher: ToolDispatcherService;
  let registry: jest.Mocked<Pick<ToolRegistryService, 'get'>>;
  let logsService: jest.Mocked<Pick<LogsService, 'log'>>;

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

    dispatcher = new ToolDispatcherService(
      registry as unknown as ToolRegistryService,
      logsService as unknown as LogsService,
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
  });
});
