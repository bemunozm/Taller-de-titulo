import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DigitalConciergeService } from '../../digital-concierge/services/digital-concierge.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

/**
 * Topes de la entrada (Fase 4 · P6.M, corrección QA), acordes a las columnas
 * de `concierge_sessions`. `nombre`, `motivo` y `casa` se guardan tal cual:
 * mismo largo que la columna (128 / 256 / 50); antes un valor más largo
 * llegaba a la BD y respondía 500. `rut`, `telefono` y `patente` se
 * normalizan y validan antes de guardarse (RUT formateado, +569XXXXXXXX,
 * patente sin espacios) y el valor guardado cabe en su columna (32 / 15 /
 * 10); el tope de la entrada dictada es algo mayor para tolerar espacios y
 * guiones de la transcripción, y acota el texto que vuelve en el mensaje de
 * error.
 */
export const VISITOR_DATA_MAX_LENGTHS = {
  nombre: 128,
  rut: 32,
  telefono: 32,
  patente: 20,
  motivo: 256,
  casa: 50,
} as const;

const inputSchema = z.object({
  nombre: z
    .string()
    .min(1)
    .max(VISITOR_DATA_MAX_LENGTHS.nombre)
    .optional()
    .describe('Nombre completo del visitante.'),
  rut: z
    .string()
    .min(1)
    .max(VISITOR_DATA_MAX_LENGTHS.rut)
    .optional()
    .describe('RUT o pasaporte del visitante, tal como lo dictó.'),
  telefono: z
    .string()
    .min(1)
    .max(VISITOR_DATA_MAX_LENGTHS.telefono)
    .optional()
    .describe('Teléfono de contacto del visitante.'),
  patente: z
    .string()
    .min(1)
    .max(VISITOR_DATA_MAX_LENGTHS.patente)
    .optional()
    .describe('Patente del vehículo, si el visitante viene motorizado.'),
  motivo: z
    .string()
    .min(1)
    .max(VISITOR_DATA_MAX_LENGTHS.motivo)
    .optional()
    .describe('Motivo de la visita.'),
  casa: z
    .string()
    .min(1)
    .max(VISITOR_DATA_MAX_LENGTHS.casa)
    .optional()
    .describe('Número/código de la casa o departamento de destino.'),
});
type GuardarDatosVisitanteInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  message: z.string(),
  saved: z.object({
    nombre: z.string().nullable(),
    rut: z.string().nullable(),
    telefono: z.string().nullable(),
    patente: z.string().nullable(),
    motivo: z.string().nullable(),
    casa: z.string().nullable(),
  }),
  // Cierre de brecha Fase 1 → Fase 2 (ver `DigitalConciergeService.saveVisitorData`
  // y `common/utils/chilean-format.util.ts`): `ok: false` indica que uno de
  // los campos declarados por voz (rut/telefono/patente) no pasó la
  // validación de dominio y NO se guardó — `campo`/`mensaje` le dicen a
  // Sofía (agent/prompts/sofia.prompt.ts) qué pedirle de nuevo al visitante.
  ok: z.boolean(),
  campo: z.enum(['rut', 'telefono', 'patente']).optional(),
  mensaje: z.string().optional(),
});
type GuardarDatosVisitanteOutput = z.infer<typeof outputSchema>;

/**
 * Segunda `VigiliaTool` de paridad (Fase 1, Bloque A2b —
 * docs/modulos/agente-cerebro.md §7/§10.2 paso 4). Reemplaza el `case
 * 'guardar_datos_visitante'` del extinto `switch` de
 * `DigitalConciergeService.executeTool` — delega TAL CUAL a
 * `DigitalConciergeService.saveVisitorData` (ahora `public`, ver su
 * docstring), que sigue siendo el dueño de la lógica de negocio (acumula
 * datos parciales del visitante en la `ConciergeSession`).
 *
 * `access: 'write'` — muta la `ConciergeSession` (no crea/mueve estado de
 * negocio "duro" como una `Visit`, por eso no requiere aprobación).
 *
 * Requiere `ctx.sessionId`: esta tool opera sobre EL turno de UNA
 * `ConciergeSession` de citófono — `findSessionForTenant` (ver su
 * docstring en `digital-concierge.service.ts`) resuelve la sesión Y verifica
 * que pertenezca al condominio del `ctx` antes de mutarla, así un contexto
 * del condominio A nunca puede escribir en la sesión del condominio B aunque
 * conozca su `sessionId`.
 */
@Injectable()
export class GuardarDatosVisitanteTool
  implements
    VigiliaTool<GuardarDatosVisitanteInput, GuardarDatosVisitanteOutput>
{
  readonly name = 'guardar_datos_visitante';
  readonly description =
    'Guarda un dato del visitante en la sesión actual (nombre, rut, teléfono, patente, motivo o casa de destino). Se llama una vez por cada dato recolectado, a medida que el visitante lo entrega.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'write' as const;
  readonly requiresApproval = false;
  // Mismo baseline que `buscar_residente` — ver authorized-context.factory.ts
  // (HUB_BASELINE_SCOPES) y el reporte del bloque A2b sobre por qué no se
  // introduce granularidad por-tool todavía (Fase 2 la agrega junto con la
  // política de autonomía real).
  readonly requiredScopes = ['digital-concierge.access'];
  /**
   * Fase 4 · P4.B (D8): conversación con el visitante, disponible en todos
   * los canales con identidad (citófono físico, kiosko web y humano).
   */
  readonly allowedChannels = ['physical-hub', 'web-kiosk', 'human'] as const;

  constructor(private readonly conciergeService: DigitalConciergeService) {}

  async execute(
    ctx: AuthorizedContext,
    input: GuardarDatosVisitanteInput,
  ): Promise<GuardarDatosVisitanteOutput> {
    if (!ctx.sessionId) {
      throw new BadRequestException(
        `La tool "${this.name}" requiere una sesión de conserjería activa (ctx.sessionId)`,
      );
    }

    const session = await this.conciergeService.findSessionForTenant(
      ctx.sessionId,
      ctx,
    );
    return this.conciergeService.saveVisitorData(session, input);
  }
}
