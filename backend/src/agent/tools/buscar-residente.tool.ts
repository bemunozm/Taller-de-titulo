import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { FamiliesService } from '../../families/families.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';
import { exposesResidentNames } from './resident-names.policy';

const inputSchema = z.object({
  casa: z
    .string()
    .min(1)
    .describe(
      'Código de la casa/departamento (ej: "15", "1203", "A-303") o solo su número (ej: "303"); no distingue mayúsculas. Sin prefijos como "Casa" o "Depto".',
    ),
});
type BuscarResidenteInput = z.infer<typeof inputSchema>;

/**
 * Fase 4 · P4.B (minimización): solo lo que la conversación necesita. `id`
 * (lo pide `notificar_residente`). Sin teléfono: la salida llega al
 * dispositivo (kiosko en un navegador público, o el modelo de voz) y el
 * visitante no lo necesita.
 *
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §5.1): `nombre` (y
 * `familia`) solo para el canal humano. Un dispositivo (`physical-hub`,
 * `web-kiosk`) recibe ids y conteo: Sofía nunca nombra a los residentes y
 * el modelo de voz no debe tener con qué armar la relación nombre-casa.
 */
const residenteSchema = z.object({
  id: z.string(),
  nombre: z.string().optional(),
});

const outputSchema = z.object({
  encontrado: z.boolean(),
  /**
   * Fase 4 · P6.R: el número coincide con VARIAS casas (p. ej. "303" con
   * A-303 y B-303). `opciones` trae solo sus códigos, sin nombres.
   */
  ambiguo: z.boolean().optional(),
  opciones: z.array(z.string()).optional(),
  mensaje: z.string().optional(),
  casa: z.string().optional(),
  familia: z.string().optional(),
  cantidad_residentes: z.number().int().nonnegative().optional(),
  residentes: z.array(residenteSchema).optional(),
});
type BuscarResidenteOutput = z.infer<typeof outputSchema>;

/**
 * Primera `VigiliaTool` de paridad (Fase 1, Bloque A2a —
 * docs/modulos/agente-cerebro.md §7/§10.2 paso 4). Reemplaza el `case
 * 'buscar_residente'` de `DigitalConciergeService.executeTool`
 * (`findResident`, digital-concierge.service.ts:502-548) — misma forma de
 * salida, para no romper el contrato que ya conocen los clientes.
 *
 * `access: 'read'` — no muta estado, por eso no tiene `requiresApproval` ni
 * necesita política de autonomía.
 *
 * Tenant-aware "gratis": `FamiliesService`/`UnitsService` ya están scopeados
 * por `TenantContextService` desde Fase 0 (tarea #19) — esta tool no filtra
 * nada manualmente, solo delega. Si el `ctx.tenantId` es `null` (hub aún no
 * asociado a un condominio), `FamiliesService` cae en el mismo "cajón nulo"
 * ya usado en el resto del sistema — no hay bypass posible entre tenants.
 */
@Injectable()
export class BuscarResidenteTool
  implements VigiliaTool<BuscarResidenteInput, BuscarResidenteOutput>
{
  readonly name = 'buscar_residente';
  readonly description =
    'Busca los residentes de una casa/departamento por su código exacto ("A-303", "1203") o, si no hay, por su número cuando es único en el condominio ("303" -> "A-303"). No distingue mayúsculas y no hace búsquedas aproximadas: "10" no encuentra la "101". Si el número corresponde a varias casas devuelve ambiguo:true con las opciones (solo códigos): pregunta al visitante a cuál va y vuelve a buscar con la opción elegida. Devuelve TODOS los residentes de la familia (con su id, que pide notificar_residente) y, en "casa", el código exacto encontrado. Nunca digas al visitante el nombre de un residente.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'read' as const;
  readonly requiresApproval = false;
  // Mismo permiso que ya protege el resto del módulo (§7 del doc:
  // `digital-concierge.access`, sembrado en DEFAULT_PERMISSIONS). Una sesión
  // de hub físico lo trae en el baseline que arma
  // `authorized-context.factory.ts`; una sesión humana necesita tenerlo
  // asignado por rol, igual que cualquier otro endpoint del sistema.
  readonly requiredScopes = ['digital-concierge.access'];
  /**
   * Fase 4 · P4.B (D8): conversación con el visitante, disponible en todos
   * los canales con identidad (citófono físico, kiosko web y humano).
   */
  readonly allowedChannels = ['physical-hub', 'web-kiosk', 'human'] as const;

  constructor(private readonly familiesService: FamiliesService) {}

  async execute(
    ctx: AuthorizedContext,
    input: BuscarResidenteInput,
  ): Promise<BuscarResidenteOutput> {
    const resolution = await this.familiesService.resolveHouse(input.casa);

    if (resolution.status === 'ambiguous') {
      // Solo los códigos de las casas candidatas: nunca nombres ni datos de
      // las familias (el visitante elige a cuál va).
      return {
        encontrado: false,
        ambiguo: true,
        opciones: resolution.options,
        mensaje: `Hay más de una casa con "${input.casa}": ${resolution.options.join(', ')}. Pregunta al visitante a cuál de estas va (sin mencionar nombres) y vuelve a buscar con la opción que elija.`,
      };
    }

    if (resolution.status === 'not-found') {
      return {
        encontrado: false,
        mensaje: `No se encontró ningún residente en ${input.casa}. El visitante debe verificar el número o nombre correcto de la casa/departamento.`,
      };
    }

    const { family } = resolution;
    // Código exacto de la casa encontrada (p. ej. "303" -> "A-303").
    const casa = family.unit?.identifier ?? input.casa;

    if (!family.members || family.members.length === 0) {
      return {
        encontrado: false,
        casa,
        mensaje: `La casa/departamento "${casa}" existe pero no tiene residentes registrados`,
      };
    }

    // Fase 4 · P7.L: fail-closed, los nombres solo van al canal humano.
    if (!exposesResidentNames(ctx)) {
      return {
        encontrado: true,
        casa,
        residentes: family.members.map((member) => ({ id: member.id })),
        cantidad_residentes: family.members.length,
      };
    }

    const residentes = family.members.map((member) => ({
      id: member.id,
      nombre: member.name,
    }));

    return {
      encontrado: true,
      casa,
      residentes,
      cantidad_residentes: residentes.length,
      familia: family.name,
    };
  }
}
