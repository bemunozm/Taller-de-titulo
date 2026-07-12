import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ToolLoopAgent,
  tool,
  type ModelMessage,
  type LanguageModel,
  type ToolSet,
  type StreamTextResult,
  type ToolLoopAgentSettings,
} from 'ai';
import { z } from 'zod';
import { AGENT_LANGUAGE_MODEL } from './agent-model.provider';
import { buildSofiaInstructions } from './prompts/sofia.prompt';
import { ToolDispatcherService } from './tool-dispatcher.service';
import { ToolRegistryService } from './tool-registry.service';
import type { AuthorizedContext } from './types/authorized-context.type';

/**
 * Zod del `AuthorizedContext` para el `contextSchema` de cada tool del AI
 * SDK (mecanismo `toolsContext`, ver node_modules/ai/docs/03-agents —
 * "Context and Agent State"). ESTE es el punto exacto donde se cumple la
 * regla dura #1 del §5: `toolsContext` se pasa por parámetro en cada
 * `agent.stream(...)` armado por NosotrosEnElController, nunca lo rellena el
 * modelo — el modelo solo controla `input` (lo validado por
 * `tool.inputSchema`), jamás `context`.
 */
const authorizedContextSchema = z.object({
  tenantId: z.string().nullable(),
  isSuperAdmin: z.boolean(),
  userId: z.string().optional(),
  role: z.string(),
  scopes: z.array(z.string()),
  requestId: z.string(),
  // Bloque A2b: presente solo cuando el consumidor opera sobre una
  // ConciergeSession (ver docstring en types/authorized-context.type.ts).
  // El canal de texto de este archivo (AgentController) no lo setea hoy.
  sessionId: z.string().optional(),
});

/**
 * Agent Runner (Fase 1, Bloque A2a — docs/modulos/agente-cerebro.md
 * §4/§10.2 pasos 1-2). Adapta el catálogo `VigiliaTool` (dominio propio) al
 * `ToolLoopAgent` del Vercel AI SDK — es la pieza "delgada y reemplazable"
 * del diseño (§2): si mañana cambia el framework de orquestación, el
 * catálogo/dispatcher no se tocan, solo este archivo.
 *
 * El `ToolSet` (adaptador de cada `VigiliaTool` a `tool()`) se arma UNA sola
 * vez en el constructor — no depende de ningún dato de request. El
 * `ToolLoopAgent` en sí, en cambio, se instancia UNA VEZ POR TURNO en
 * `streamChat`: en la versión instalada del AI SDK (`ai@7.0.22`),
 * `toolsContext` e `instructions` solo son configurables en el constructor
 * del agente, no como parámetro de `.generate()`/`.stream()` (a diferencia
 * de la función standalone `streamText`, y aparentemente de lo que muestra
 * node_modules/ai/docs/03-agents/02-building-agents.mdx — se verificó contra
 * el `.d.ts` real, no contra la doc, ver §"After Making Changes" de la skill
 * ai-sdk). Instanciar el agente es una construcción de objeto en memoria
 * (no hay llamada de red hasta `.stream()`), así que el costo es despreciable.
 */
@Injectable()
export class AgentRunnerService {
  private readonly logger = new Logger(AgentRunnerService.name);
  private readonly model: LanguageModel;
  private readonly tools: ToolSet;

  constructor(
    @Inject(AGENT_LANGUAGE_MODEL) model: LanguageModel,
    private readonly registry: ToolRegistryService,
    private readonly dispatcher: ToolDispatcherService,
  ) {
    this.model = model;
    this.tools = {};

    for (const vigiliaTool of this.registry.getAll()) {
      this.tools[vigiliaTool.name] = tool({
        description: vigiliaTool.description,
        inputSchema: vigiliaTool.inputSchema,
        contextSchema: authorizedContextSchema,
        // El dispatcher hace TODO el trabajo de seguridad/validación/auditoría
        // (regla dura #6 del §5) — este adaptador solo reenvía. No se pasa
        // `outputSchema` acá: `ToolDispatcherService.execute` ya valida la
        // salida contra `vigiliaTool.outputSchema` antes de devolverla.
        execute: async (input, { context }) =>
          this.dispatcher.execute(
            vigiliaTool,
            context as AuthorizedContext,
            input,
          ),
      });
    }
  }

  /**
   * Corre un turno de conversación por TEXTO (canal verificable de A2a — la
   * voz Realtime es un bloque posterior, ver §8 del doc). `ctx` viaja idéntico
   * a TODAS las tools del catálogo vía `toolsContext` (un solo
   * `AuthorizedContext` por turno, no uno distinto por tool) — armado y
   * fijado ACÁ, nunca por el modelo (regla dura #1 del §5).
   */
  async streamChat(params: {
    houseNumber: string;
    messages: ModelMessage[];
    ctx: AuthorizedContext;
    // Tipo de retorno explícito: TS con `declaration: true` no puede nombrar
    // el `OUTPUT` inferido (`Output`, re-exportado desde 'ai' con colisión
    // valor/tipo) en el `.d.ts` generado (TS4053) — se ancla a `never`
    // (ningún output estructurado en A2a) y `Context` se reemplaza por su
    // forma real (`Record<string, unknown>`, ver @ai-sdk/provider-utils).
  }): Promise<StreamTextResult<ToolSet, Record<string, unknown>, never>> {
    const toolsContext: Record<string, AuthorizedContext> = Object.fromEntries(
      this.registry
        .getAll()
        .map((vigiliaTool) => [vigiliaTool.name, params.ctx]),
    );

    // `ToolLoopAgentSettings['toolsContext']` se tipa como `InferToolSetContext<TOOLS>`,
    // que solo se resuelve a partir de un `ToolSet` con CLAVES LITERALES
    // conocidas en compilación (el patrón usual: `tools: { toolA: tool({...}) }`
    // escrito a mano). Acá `this.tools` es un `ToolSet` armado en runtime desde
    // el catálogo (`ToolRegistryService`), así que TypeScript no puede inferir
    // ese mapa y colapsa `toolsContext` a `never` — limitación real del tipado
    // del AI SDK con catálogos dinámicos, no un descuido. El objeto que se
    // castea es exactamente el que la firma en runtime espera
    // (`Record<toolName, AuthorizedContext>`); Zod (`contextSchema` de cada
    // tool) y `ToolDispatcherService` son la validación real, no este tipo.
    const settings = {
      model: this.model,
      tools: this.tools,
      instructions: buildSofiaInstructions(params.houseNumber),
      toolsContext,
      // Revisión de calidad — observabilidad: `onError` NO está en el tipo
      // público `ToolLoopAgentSettings` de `ai@7.0.22` (se verificó contra
      // node_modules/ai/dist/index.d.ts, no contra la doc — mismo criterio
      // que el resto de este archivo). PERO sí es reenviado en runtime: la
      // implementación real de `ToolLoopAgent.prepareCall`
      // (node_modules/ai/dist/index.js) solo extrae del `settings` un
      // allowlist fijo de callbacks conocidos (onStart/onStepStart/
      // onToolExecutionStart/onToolExecutionEnd/onStepEnd/onFinish/onEnd) y
      // pasa el RESTO tal cual al `streamText(...)` interno — que sí declara
      // `onError` y, si no se provee, cae por defecto a `console.error`
      // (fuera del logger de la app). Sin este callback, un fallo de
      // streaming (proveedor caído, rate limit, timeout, corte de stream) es
      // invisible en los logs — el `try/catch` alrededor de `agent.stream(...)`
      // no lo captura porque esos errores llegan como un chunk `{ type:
      // 'error' }` dentro del stream, no como una excepción síncrona.
      onError: ({ error }: { error: unknown }) => {
        this.logger.error(
          `Fallo en el stream del agente [requestId=${params.ctx.requestId}, tenantId=${params.ctx.tenantId ?? 'null'}]: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      },
    } as unknown as ToolLoopAgentSettings<
      never,
      ToolSet,
      Record<string, unknown>,
      never
    >;

    const agent = new ToolLoopAgent<
      never,
      ToolSet,
      Record<string, unknown>,
      never
    >(settings);

    return agent.stream({ messages: params.messages });
  }
}
