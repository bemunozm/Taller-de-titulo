import type { RealtimeToolDefinition } from '../../agent/tool-definitions.util';

/**
 * Respuesta de `GET /concierge/agent-config/:houseNumber` (Fase 1, Bloque
 * A2b — docs/modulos/agente-cerebro.md §10.2 paso 4). Contiene TODO lo que
 * un cliente-transporte Realtime necesita para configurar su sesión sin
 * hardcodear ni el system prompt ni las definiciones de tools: ambos se
 * derivan del backend (única fuente de verdad — ver `sofia.prompt.ts` y
 * `tool-definitions.util.ts`).
 *
 * Parametrizado por `houseNumber` (no por `startSession`) porque el
 * `houseNumber` se conoce recién cuando el visitante marca en el DialPad —
 * DESPUÉS de que la sesión ya arrancó (ver `getHouseContext`, mismo patrón
 * de endpoint separado ya usado para el contexto histórico de la casa).
 */
export interface AgentConfigResponseDto {
  instructions: string;
  tools: RealtimeToolDefinition[];
}
