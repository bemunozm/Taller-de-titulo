import { z } from 'zod';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Forma que espera un tool-call de OpenAI Realtime (y, en la práctica, la
 * mayoría de las APIs de function-calling) — la misma que hoy hardcodean
 * `frontend/src/views/DigitalConciergeView.tsx` y
 * `vigilia-hub/src/services/concierge-client.service.ts`
 * (`getToolDefinitions()`, "réplica exacta del frontend" según su propio
 * comentario).
 */
export interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Deriva las definiciones de tools que un cliente-transporte Realtime
 * necesita, a partir del catálogo `VigiliaTool` (Fase 1, Bloque A2b —
 * docs/modulos/agente-cerebro.md §4/§10.2 paso 4: "servir desde el backend
 * el system prompt y las definiciones de tools").
 *
 * El backend pasa a ser la ÚNICA fuente de verdad: `name`/`description` ya
 * viven en cada `VigiliaTool`, y `parameters` se genera con `z.toJSONSchema`
 * (soporte NATIVO de Zod 4, ya instalado en el proyecto — no hace falta
 * agregar `zod-to-json-schema` ni ninguna otra dependencia nueva) a partir
 * del MISMO `inputSchema` que el `ToolDispatcherService` usa para validar
 * cada llamada — no puede desincronizarse con lo que el dispatcher
 * realmente acepta, a diferencia de las 3 copias manuales que hoy mantienen
 * los clientes.
 *
 * Se descarta la clave `$schema` que agrega `z.toJSONSchema` (metadato de
 * JSON Schema en sí, no algo que un tool-call de Realtime espere dentro de
 * `parameters`).
 */
export function buildRealtimeToolDefinitions(
  tools: ReadonlyArray<VigiliaTool<unknown, unknown>>,
): RealtimeToolDefinition[] {
  return tools.map((tool) => {
    const jsonSchema = z.toJSONSchema(tool.inputSchema) as Record<
      string,
      unknown
    >;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se destructura solo para excluir `$schema` de `parameters` (ver docstring arriba).
    const { $schema: _$schema, ...parameters } = jsonSchema;

    return {
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters,
    };
  });
}
