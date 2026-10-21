import type { FactoryProvider } from '@nestjs/common';
import { VIGILIA_TOOLS } from './tool-registry.token';
import { AbrirAccesoTool } from './tools/abrir-acceso.tool';
import { BuscarResidenteTool } from './tools/buscar-residente.tool';
import { ConsultarAccesosRecientesTool } from './tools/consultar-accesos-recientes.tool';
import { ConsultarVehiculoTool } from './tools/consultar-vehiculo.tool';
import { ConsultarVisitasTool } from './tools/consultar-visitas.tool';
import { FinalizarLlamadaTool } from './tools/finalizar-llamada.tool';
import { GuardarDatosVisitanteTool } from './tools/guardar-datos-visitante.tool';
import { NotificarResidenteTool } from './tools/notificar-residente.tool';
import { ReenviarNotificacionTool } from './tools/reenviar-notificacion.tool';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Catálogo de tools del agente-cerebro: las clases (providers de
 * `AgentModule`) y el provider `VIGILIA_TOOLS` que las agrupa para
 * `ToolRegistryService`. Separado de agent.module.ts (Fase 4 · P4.B, cyber
 * B2) para que los tests de la matriz tools × canal usen el catálogo REAL,
 * no uno armado a mano.
 *
 * Para agregar una tool: su clase acá (con `allowedChannels` y
 * `requiredScopes` explícitos). Registry, dispatcher y runner no cambian.
 */
export const VIGILIA_TOOL_CLASSES = [
  BuscarResidenteTool,
  GuardarDatosVisitanteTool,
  NotificarResidenteTool,
  ReenviarNotificacionTool,
  FinalizarLlamadaTool,
  ConsultarVehiculoTool,
  ConsultarVisitasTool,
  ConsultarAccesosRecientesTool,
  // Fase 2, Bloque F2.2 (docs/modulos/agente-cerebro.md §12): apertura física
  // de accesos con autonomía condicional (`requiresApproval` dinámico).
  AbrirAccesoTool,
] as const;

export const vigiliaToolsProvider: FactoryProvider<
  VigiliaTool<unknown, unknown>[]
> = {
  provide: VIGILIA_TOOLS,
  useFactory: (...tools: VigiliaTool<unknown, unknown>[]) => tools,
  inject: [...VIGILIA_TOOL_CLASSES],
};
