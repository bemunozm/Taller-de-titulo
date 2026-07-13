import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SessionStatus } from '../../digital-concierge/entities/concierge-session.entity';
import { DigitalConciergeService } from '../../digital-concierge/services/digital-concierge.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

const inputSchema = z.object({});
type FinalizarLlamadaInput = z.infer<typeof inputSchema>;

/**
 * `finalizada: true` es la señal de "fin de conversación" que este bloque
 * (A2b) introduce — ver docstring de la clase para el diseño completo.
 */
const outputSchema = z.object({
  finalizada: z.boolean(),
  mensaje: z.string(),
});
type FinalizarLlamadaOutput = z.infer<typeof outputSchema>;

/**
 * Quinta `VigiliaTool` de paridad (Fase 1, Bloque A2b —
 * docs/modulos/agente-cerebro.md §7/§10.2 paso 4/6) — la única de las 5 tools
 * de facto que HOY es 100% local en los clientes (frontend y vigilia-hub):
 * ninguno de los dos llama al backend, cada uno espera unos segundos (para
 * que termine el audio de despedida) y corta la sesión de Realtime por su
 * cuenta (ver `DigitalConciergeView.tsx` / `concierge-client.service.ts`,
 * caso `if (name === 'finalizar_llamada')`).
 *
 * DISEÑO DE LA SEÑAL DE FIN (decisión de este bloque): con el cerebro en el
 * backend, "colgar" deja de ser una decisión que el cliente toma solo — pasa
 * a ser una tool real del catálogo, auditada y tenant-aware como cualquier
 * otra. El backend marca la `ConciergeSession` como `COMPLETED` (reusa
 * `DigitalConciergeService.endSession`, MISMA lógica que ya usa el endpoint
 * `POST /concierge/session/:id/end` — no se reinventa) y devuelve
 * `{ finalizada: true, mensaje }`: EXACTAMENTE la misma forma que los
 * clientes ya construían a mano. El bloque de "clientes delgados" (siguiente,
 * fuera de alcance acá) solo necesita: (a) dejar de manejar
 * `finalizar_llamada` localmente, (b) llamarla como cualquier otra tool vía
 * `POST /concierge/session/:id/execute-tool`, y (c) al recibir
 * `data.finalizada === true` en el `ToolResultDto`, cortar el canal de audio
 * (WebRTC en frontend, WS+GPIO en vigilia-hub) — el mismo campo que ya leían
 * de su propio JSON local, ahora viene del backend.
 *
 * `access: 'write'` — muta el estado de la sesión (`COMPLETED`) y, vía
 * `endSession`, puede marcar notificaciones pendientes como expiradas.
 */
@Injectable()
export class FinalizarLlamadaTool
  implements VigiliaTool<FinalizarLlamadaInput, FinalizarLlamadaOutput>
{
  readonly name = 'finalizar_llamada';
  readonly description =
    'Finaliza la llamada con el visitante. Se usa SOLO después de despedirse completamente — no mencionar que se está finalizando la llamada, solo despedirse naturalmente.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'write' as const;
  readonly requiresApproval = false;
  readonly requiredScopes = ['digital-concierge.access'];

  constructor(private readonly conciergeService: DigitalConciergeService) {}

  async execute(
    ctx: AuthorizedContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma exigida por VigiliaTool.execute; el inputSchema es z.object({}), no hay input real que leer.
    _input: FinalizarLlamadaInput,
  ): Promise<FinalizarLlamadaOutput> {
    if (!ctx.sessionId) {
      throw new BadRequestException(
        `La tool "${this.name}" requiere una sesión de conserjería activa (ctx.sessionId)`,
      );
    }

    // Verifica tenant ANTES de tocar la sesión (mismo criterio que el resto
    // de tools de escritura de este bloque) — endSession() en sí no es
    // tenant-aware (opera solo por sessionId), así que la defensa vive acá.
    await this.conciergeService.findSessionForTenant(ctx.sessionId, ctx);
    await this.conciergeService.endSession(
      ctx.sessionId,
      SessionStatus.COMPLETED,
    );

    return {
      finalizada: true,
      mensaje: 'OK. La llamada se cerrará automáticamente.',
    };
  }
}
