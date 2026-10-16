import { ForbiddenException } from '@nestjs/common';
import { z, ZodError } from 'zod';
import { ToolDispatcherService } from './tool-dispatcher.service';
import { ToolRegistryService } from './tool-registry.service';
import { PendingActionsService } from './pending-actions.service';
import { LogsService } from '../logs/logs.service';
import type { CreateSystemLogDto } from '../logs/dto/create-system-log.dto';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Corrección P7 (cyber A1, crítico): `execute-tool` auditaba el input CRUDO
 * en las denegaciones de canal/permiso y en los fallos de Zod, y la regex de
 * email era cuadrática: un body de 200 KB bloqueaba el backend ~25 s. Ahora
 * de un input rechazado se audita solo su forma (claves, tipos y largos) y
 * nunca los valores; y todo termina en < 200 ms aunque el input sea de 1 MB.
 */
describe('auditoría de tools: input rechazado sin valores y sin ReDoS (corrección P7)', () => {
  const LIMIT_MS = 200;
  let dispatcher: ToolDispatcherService;
  let logsService: { log: jest.Mock<Promise<void>, [CreateSystemLogDto]> };

  const humanCtx: AuthorizedContext = {
    tenantId: 'tenant-A',
    isSuperAdmin: false,
    userId: 'user-1',
    role: 'Conserje',
    channel: 'human',
    scopes: ['digital-concierge.access'],
    requestId: 'req-1',
  };

  const tool: VigiliaTool<{ casa: string }, { ok: boolean }> = {
    name: 'fake_tool',
    description: 'tool de test',
    inputSchema: z.object({ casa: z.string().max(32) }),
    outputSchema: z.object({ ok: z.boolean() }),
    access: 'read',
    requiresApproval: false,
    requiredScopes: ['digital-concierge.access'],
    allowedChannels: ['physical-hub', 'human'],
    execute: jest.fn().mockResolvedValue({ ok: true }),
  };

  beforeEach(() => {
    logsService = {
      log: jest
        .fn<Promise<void>, [CreateSystemLogDto]>()
        .mockResolvedValue(undefined),
    };
    dispatcher = new ToolDispatcherService(
      { get: jest.fn() } as unknown as ToolRegistryService,
      logsService as unknown as LogsService,
      { create: jest.fn() } as unknown as PendingActionsService,
    );
  });

  function lastAudit(): CreateSystemLogDto {
    const calls = logsService.log.mock.calls;
    return calls[calls.length - 1][0];
  }

  async function timed(run: () => Promise<unknown>): Promise<number> {
    const start = process.hrtime.bigint();
    await run().catch(() => undefined);
    return Number(process.hrtime.bigint() - start) / 1e6;
  }

  const PII_INPUT = {
    casa: 'x'.repeat(100),
    nombre: 'Juan Pérez',
    email: 'victima@correo.cl',
  };

  it('fallo de Zod: audita claves y largos, nunca los valores', async () => {
    await expect(
      dispatcher.execute(tool, humanCtx, PII_INPUT),
    ).rejects.toBeInstanceOf(ZodError);

    const audit = lastAudit();
    expect(audit.metadata?.validationError).toBe(true);
    expect(audit.metadata?.inputShape).toEqual({
      type: 'object',
      keys: { casa: 'string(100)', nombre: 'string(10)', email: 'string(17)' },
    });
    expect(audit.metadata).not.toHaveProperty('input');
    const persisted = JSON.stringify(audit);
    expect(persisted).not.toMatch(/Juan|victima|x{20}/);
  });

  it('canal denegado: audita solo la forma', async () => {
    await expect(
      dispatcher.execute(
        tool,
        { ...humanCtx, channel: 'web-kiosk' },
        PII_INPUT,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const audit = lastAudit();
    expect(audit.metadata?.inputShape).toEqual(
      expect.objectContaining({ type: 'object' }),
    );
    expect(JSON.stringify(audit)).not.toMatch(/Juan|victima/);
  });

  it('permiso denegado: audita solo la forma', async () => {
    await expect(
      dispatcher.execute(tool, { ...humanCtx, scopes: [] }, PII_INPUT),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(JSON.stringify(lastAudit())).not.toMatch(/Juan|victima/);
  });

  it('un input válido sí se audita, redactado por campo', async () => {
    await dispatcher.execute(tool, humanCtx, { casa: '15' });

    expect(lastAudit().metadata?.input).toEqual({ casa: '15' });
    expect(lastAudit().metadata).not.toHaveProperty('inputShape');
  });

  describe.each([1e5, 1e6])('input crudo de %d caracteres', (size) => {
    const big = 'a'.repeat(size);

    it.each([
      ['fallo de Zod (string enorme)', humanCtx, { casa: big }],
      ['fallo de Zod (clave enorme)', humanCtx, { [big]: big }],
      ['canal denegado', { ...humanCtx, channel: 'web-kiosk' }, { casa: big }],
      ['permiso denegado', { ...humanCtx, scopes: [] }, { casa: big }],
      ['input que no es objeto', humanCtx, big],
    ] as Array<[string, AuthorizedContext, unknown]>)(
      '%s: termina en < 200 ms y no guarda el valor',
      async (_case, ctx, input) => {
        const elapsed = await timed(() => dispatcher.execute(tool, ctx, input));

        expect(elapsed).toBeLessThan(LIMIT_MS);
        const persisted = JSON.stringify(lastAudit());
        expect(persisted.length).toBeLessThan(8_000);
      },
    );
  });
});
