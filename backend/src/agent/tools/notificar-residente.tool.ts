import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DigitalConciergeService } from '../../digital-concierge/services/digital-concierge.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

const inputSchema = z.object({
  residentes_ids: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'IDs de TODOS los residentes de la familia a notificar (obtenidos del resultado de buscar_residente).',
    ),
});
type NotificarResidenteInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  notificado: z.boolean(),
  mensaje: z.string(),
  residentes_notificados: z.array(z.string()).optional(),
  cantidad_notificados: z.number().int().nonnegative().optional(),
  visita_creada: z.boolean().optional(),
  visita_id: z.string().optional(),
});
type NotificarResidenteOutput = z.infer<typeof outputSchema>;

/**
 * Tercera `VigiliaTool` de paridad (Fase 1, Bloque A2b —
 * docs/modulos/agente-cerebro.md §7/§10.2 paso 4). Reemplaza el `case
 * 'notificar_residente'` del extinto `switch` de
 * `DigitalConciergeService.executeTool` — delega a
 * `DigitalConciergeService.notifyResident` (ahora `public`), que crea la
 * `Visit` en PENDING y notifica a cada residente.
 *
 * `access: 'write'` — crea una `Visit` y dispara notificaciones reales.
 *
 * SEGURIDAD (fix M1, ver docstring de `notifyResident` en
 * `digital-concierge.service.ts`): esta tool es la superficie exacta que
 * motivó el hallazgo — el modelo arma `residentes_ids` a partir de lo que
 * DIJO `buscar_residente`, pero nada impide que un modelo comprometido (o un
 * bug de razonamiento) invente/reutilice un id de otro condominio. Por eso
 * `ctx` (no el input) es lo que se pasa como `tenantScope` a
 * `notifyResident`: cada id se descarta si su `family.organizationId` no
 * coincide con `ctx.tenantId`, ANTES de notificar o crear la visita.
 */
@Injectable()
export class NotificarResidenteTool
  implements VigiliaTool<NotificarResidenteInput, NotificarResidenteOutput>
{
  readonly name = 'notificar_residente';
  readonly description =
    'Notifica a TODOS los residentes de una familia sobre la llegada de un visitante y crea automáticamente la visita en estado pendiente. Requiere los IDs devueltos por buscar_residente.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'write' as const;
  readonly requiresApproval = false;
  readonly requiredScopes = ['digital-concierge.access'];

  constructor(private readonly conciergeService: DigitalConciergeService) {}

  async execute(
    ctx: AuthorizedContext,
    input: NotificarResidenteInput,
  ): Promise<NotificarResidenteOutput> {
    if (!ctx.sessionId) {
      throw new BadRequestException(
        `La tool "${this.name}" requiere una sesión de conserjería activa (ctx.sessionId)`,
      );
    }

    const session = await this.conciergeService.findSessionForTenant(ctx.sessionId, ctx);
    return this.conciergeService.notifyResident(session, input, ctx);
  }
}
