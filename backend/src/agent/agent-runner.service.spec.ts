import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { AgentRunnerService } from './agent-runner.service';
import type { AgentChannel } from './agent-channel';
import type { ToolDispatcherService } from './tool-dispatcher.service';
import { ToolRegistryService } from './tool-registry.service';
import { ABRIR_ACCESO_TOOL_NAME } from './tools/abrir-acceso.tool';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

/** Settings con los que se construyó el último `ToolLoopAgent`. */
const mockAgentSettings: Array<Record<string, unknown>> = [];

// `ai` y `@ai-sdk/openai` son ESM-only (no cargan en Jest/CJS). `tool()` se
// reemplaza por la identidad y `ToolLoopAgent` por un doble que guarda sus
// settings: basta para verificar QUÉ tools recibe el modelo en cada turno.
jest.mock('ai', () => ({
  tool: (definition: unknown) => definition,
  ToolLoopAgent: jest.fn((settings: Record<string, unknown>) => {
    mockAgentSettings.push(settings);
    return { stream: jest.fn(() => Promise.resolve({})) };
  }),
}));
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: jest.fn() }));

/**
 * Fase 4 · P4.B (D8): el `ToolSet` del canal de texto se arma POR TURNO con
 * las tools que el contexto puede ejecutar (antes era fijo, todo el
 * catálogo). El prompt tampoco menciona `abrir_acceso` si el canal no la ve.
 */
describe('AgentRunnerService — ToolSet filtrado por contexto (Fase 4 · P4.B)', () => {
  let runner: AgentRunnerService;
  let dispatcher: { execute: jest.Mock };

  function fakeTool(
    name: string,
    overrides: Partial<VigiliaTool<unknown, unknown>> = {},
  ): VigiliaTool<unknown, unknown> {
    return {
      name,
      description: `tool ${name}`,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      access: 'read',
      requiresApproval: false,
      requiredScopes: ['digital-concierge.access'],
      allowedChannels: ['physical-hub', 'web-kiosk', 'human'],
      execute: jest.fn(),
      ...overrides,
    };
  }

  function ctxFor(channel: AgentChannel, scopes: string[]): AuthorizedContext {
    return {
      tenantId: 'condo-A',
      isSuperAdmin: false,
      role: 'test',
      channel,
      scopes,
      requestId: 'req-1',
    };
  }

  beforeEach(() => {
    mockAgentSettings.length = 0;
    dispatcher = { execute: jest.fn().mockResolvedValue({ ok: true }) };
    const registry = new ToolRegistryService([
      fakeTool('buscar_residente'),
      fakeTool(ABRIR_ACCESO_TOOL_NAME, {
        access: 'write',
        allowedChannels: ['physical-hub', 'human'],
      }),
      fakeTool('consultar_visitas', {
        requiredScopes: ['digital-concierge.manage'],
        allowedChannels: ['human'],
      }),
    ]);
    runner = new AgentRunnerService(
      {} as LanguageModel,
      registry,
      dispatcher as unknown as ToolDispatcherService,
    );
  });

  it.each([
    ['web-kiosk', ['digital-concierge.access'], ['buscar_residente']],
    [
      'physical-hub',
      ['digital-concierge.access'],
      ['abrir_acceso', 'buscar_residente'],
    ],
    [
      'human',
      ['digital-concierge.access', 'digital-concierge.manage'],
      ['abrir_acceso', 'buscar_residente', 'consultar_visitas'],
    ],
    ['unknown', ['digital-concierge.access'], []],
  ] as Array<[AgentChannel, string[], string[]]>)(
    'canal %s: buildToolSet expone solo las tools que puede ejecutar',
    (channel, scopes, expected) => {
      const tools = runner.buildToolSet(ctxFor(channel, scopes));

      expect(Object.keys(tools).sort()).toEqual(expected);
    },
  );

  it('streamChat arma el agente del turno con el ToolSet y el prompt del canal (kiosko: sin abrir_acceso)', async () => {
    const ctx = ctxFor('web-kiosk', ['digital-concierge.access']);

    await runner.streamChat({ houseNumber: '15', messages: [], ctx });

    expect(mockAgentSettings).toHaveLength(1);
    const settings = mockAgentSettings[0];
    expect(Object.keys(settings.tools as object)).toEqual(['buscar_residente']);
    expect(settings.toolsContext).toEqual({ buscar_residente: ctx });
    expect(settings.instructions).not.toContain('abrir_acceso');
  });

  it('streamChat con hub físico: el prompt sí describe abrir_acceso', async () => {
    const ctx = ctxFor('physical-hub', ['digital-concierge.access']);

    await runner.streamChat({ houseNumber: '15', messages: [], ctx });

    const settings = mockAgentSettings[0];
    expect(Object.keys(settings.tools as object).sort()).toEqual([
      'abrir_acceso',
      'buscar_residente',
    ]);
    expect(settings.instructions).toContain('abrir_acceso(tipo:');
  });

  it('el adaptador de cada tool delega en el dispatcher con el contexto del turno', async () => {
    const ctx = ctxFor('physical-hub', ['digital-concierge.access']);
    const tools = runner.buildToolSet(ctx);
    const adapter = tools.buscar_residente as unknown as {
      execute: (
        input: unknown,
        options: { context: AuthorizedContext },
      ) => Promise<unknown>;
    };

    await adapter.execute({ casa: '15' }, { context: ctx });

    expect(dispatcher.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'buscar_residente' }),
      ctx,
      { casa: '15' },
    );
  });
});
