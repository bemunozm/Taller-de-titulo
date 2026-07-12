import { Inject, Injectable, Logger } from '@nestjs/common';
import { VIGILIA_TOOLS } from './tool-registry.token';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Catálogo en memoria de `VigiliaTool` (Fase 1, Bloque A2a —
 * docs/modulos/agente-cerebro.md §4/§10.2). El Agent Runner lo consulta para
 * armar el `ToolSet` del AI SDK; el `ToolDispatcherService` lo consulta para
 * resolver una tool por nombre al ejecutar una llamada.
 */
@Injectable()
export class ToolRegistryService {
  private readonly logger = new Logger(ToolRegistryService.name);
  private readonly tools = new Map<string, VigiliaTool<unknown, unknown>>();

  constructor(@Inject(VIGILIA_TOOLS) tools: VigiliaTool<unknown, unknown>[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Tool duplicada en el catálogo: "${tool.name}"`);
      }
      this.tools.set(tool.name, tool);
    }
    this.logger.log(
      `Catálogo de tools cargado: ${[...this.tools.keys()].join(', ') || '(vacío)'}`,
    );
  }

  get(name: string): VigiliaTool<unknown, unknown> | undefined {
    return this.tools.get(name);
  }

  getAll(): VigiliaTool<unknown, unknown>[] {
    return [...this.tools.values()];
  }
}
