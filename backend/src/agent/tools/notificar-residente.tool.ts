import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DigitalConciergeService } from '../../digital-concierge/services/digital-concierge.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';
import { exposesResidentNames } from './resident-names.policy';

const inputSchema = z.object({
  residentes_ids: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'IDs de TODOS los residentes de la familia a notificar (obtenidos del resultado de buscar_residente).',
    ),
});
type NotificarResidenteInput = z.infer<typeof inputSchema>;

/**
 * Fase 4 · P4.B (minimización): sin `visita_id`. Es un id interno que la
 * conversación no usa (el kiosko sigue la respuesta por `/status` con su
 * `sessionId`) y la salida llega al dispositivo.
 */
const outputSchema = z.object({
  notificado: z.boolean(),
  mensaje: z.string(),
  /** Nombres: solo para el canal humano (Fase 4 · P7.L, `resident-names.policy.ts`). */
  residentes_notificados: z.array(z.string()).optional(),
  cantidad_notificados: z.number().int().nonnegative().optional(),
  visita_creada: z.boolean().optional(),
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
  /**
   * Fase 4 · P4.B (D8): conversación con el visitante, disponible en todos
   * los canales con identidad (citófono físico, kiosko web y humano).
   */
  readonly allowedChannels = ['physical-hub', 'web-kiosk', 'human'] as const;

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

    const session = await this.conciergeService.findSessionForTenant(
      ctx.sessionId,
      ctx,
    );
    const result = await this.conciergeService.notifyResident(
      session,
      input,
      ctx,
    );
    return {
      notificado: result.notificado,
      mensaje: result.mensaje,
      // Fase 4 · P7.L: los nombres solo van al canal humano; un dispositivo
      // recibe el conteo (Sofía dice "notifiqué al residente de la casa X").
      ...(exposesResidentNames(ctx)
        ? { residentes_notificados: result.residentes_notificados }
        : {}),
      cantidad_notificados: result.cantidad_notificados,
      visita_creada: result.visita_creada,
    };
  }
}
