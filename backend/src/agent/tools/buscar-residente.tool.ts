import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { FamiliesService } from '../../families/families.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

const inputSchema = z.object({
  casa: z
    .string()
    .min(1)
    .describe(
      'Número, código o nombre de casa/departamento tal como lo dijo el visitante (ej: "15", "Casa 15", "A-1234").',
    ),
});
type BuscarResidenteInput = z.infer<typeof inputSchema>;

const residenteSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  telefono: z.string().nullable(),
});

const outputSchema = z.object({
  encontrado: z.boolean(),
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
    'Busca un residente por número o código de casa/departamento. Acepta múltiples formatos: números solos ("15"), con prefijos ("Casa 15"), o códigos alfanuméricos ("A-1234", "B-201"). Devuelve TODOS los residentes de la familia.';
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

  constructor(private readonly familiesService: FamiliesService) {}

  async execute(
    _ctx: AuthorizedContext,
    input: BuscarResidenteInput,
  ): Promise<BuscarResidenteOutput> {
    const family = await this.familiesService.findByDepartment(input.casa);

    if (!family) {
      return {
        encontrado: false,
        mensaje: `No se encontró ningún residente en ${input.casa}. El visitante debe verificar el número o nombre correcto de la casa/departamento.`,
      };
    }

    if (!family.members || family.members.length === 0) {
      return {
        encontrado: false,
        mensaje: `La casa/departamento "${family.unit?.identifier ?? input.casa}" existe pero no tiene residentes registrados`,
      };
    }

    const residentes = family.members.map((member) => ({
      id: member.id,
      nombre: member.name,
      telefono: member.phone ?? null,
    }));

    return {
      encontrado: true,
      casa: input.casa,
      residentes,
      cantidad_residentes: residentes.length,
      familia: family.name,
    };
  }
}
