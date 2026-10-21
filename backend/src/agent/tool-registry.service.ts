import { Inject, Injectable, Logger } from '@nestjs/common';
import { isToolAvailableFor } from './tool-access.util';
import { VIGILIA_TOOLS } from './tool-registry.token';
import type { AuthorizedContext } from './types/authorized-context.type';
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

  /**
   * Fase 4 · P4.B (D8): tools que este contexto puede ejecutar (canal Y
   * scopes, mismo criterio que el dispatcher). Es lo único que ve el modelo:
   * `agent-config` (voz Realtime) y el `ToolSet` del canal de texto se arman
   * con esta lista, así el modelo no conoce tools que no puede usar.
   */
  getAvailableFor(
    ctx: Pick<AuthorizedContext, 'channel' | 'scopes'>,
  ): VigiliaTool<unknown, unknown>[] {
    return this.getAll().filter((tool) => isToolAvailableFor(tool, ctx));
  }
}
