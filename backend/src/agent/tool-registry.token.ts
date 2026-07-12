/**
 * Token de inyección para el catálogo de tools del agente-cerebro (Fase 1,
 * Bloque A2a). Cada `VigiliaTool` concreta se registra como provider normal
 * de Nest y se agrega a este array vía una factory en `agent.module.ts` —
 * así el catálogo crece (Fase 2: vehículos, visitas, portón/puerta, etc.)
 * sin tocar `ToolRegistryService`.
 */
export const VIGILIA_TOOLS = Symbol('VIGILIA_TOOLS');
