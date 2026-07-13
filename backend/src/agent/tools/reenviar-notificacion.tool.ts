import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DigitalConciergeService } from '../../digital-concierge/services/digital-concierge.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

const inputSchema = z.object({});
type ReenviarNotificacionInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  reenviado: z.boolean(),
  mensaje: z.string(),
});
type ReenviarNotificacionOutput = z.infer<typeof outputSchema>;

/**
 * Cuarta `VigiliaTool` de paridad (Fase 1, Bloque A2b —
 * docs/modulos/agente-cerebro.md §7/§10.2 paso 4). Reemplaza el `case
 * 'reenviar_notificacion'` del extinto `switch` de
 * `DigitalConciergeService.executeTool` — delega TAL CUAL a
 * `DigitalConciergeService.resendNotification` (ahora `public`), que reenvía
 * a los residentes YA guardados en `session.residentsNotified` (ningún id
 * nuevo entra por acá, por eso no hay superficie de fix M1 en esta tool: los
 * destinatarios ya fueron validados por `notificar_residente`).
 *
 * `access: 'write'` — reenvía notificaciones reales (aunque no cambia
 * estado de negocio nuevo).
 */
@Injectable()
export class ReenviarNotificacionTool
  implements VigiliaTool<ReenviarNotificacionInput, ReenviarNotificacionOutput>
{
  readonly name = 'reenviar_notificacion';
  readonly description =
    'Reenvía la notificación de llegada a los residentes que ya fueron notificados previamente en esta sesión (usar si hubo timeout o el residente pide que se reenvíe).';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'write' as const;
  readonly requiresApproval = false;
  readonly requiredScopes = ['digital-concierge.access'];

  constructor(private readonly conciergeService: DigitalConciergeService) {}

  async execute(
    ctx: AuthorizedContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- firma exigida por VigiliaTool.execute; el inputSchema es z.object({}), no hay input real que leer.
    _input: ReenviarNotificacionInput,
  ): Promise<ReenviarNotificacionOutput> {
    if (!ctx.sessionId) {
      throw new BadRequestException(
        `La tool "${this.name}" requiere una sesión de conserjería activa (ctx.sessionId)`,
      );
    }

    const session = await this.conciergeService.findSessionForTenant(
      ctx.sessionId,
      ctx,
    );
    return this.conciergeService.resendNotification(session);
  }
}
