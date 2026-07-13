import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { FamiliesService } from '../../families/families.service';
import { NON_TERMINAL_VISIT_STATUSES } from '../../visits/visits.constants';
import { VisitsService } from '../../visits/visits.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

const inputSchema = z.object({
  casa: z
    .string()
    .min(1)
    .describe(
      'Número, código o nombre de casa/departamento tal como lo dijo el visitante (mismo formato que buscar_residente).',
    ),
  soloActivas: z
    .boolean()
    .optional()
    .describe(
      'Si es true (default), solo devuelve visitas pendientes o en curso — no completadas/canceladas/expiradas/rechazadas.',
    ),
});
type ConsultarVisitasInput = z.infer<typeof inputSchema>;

const visitaSchema = z.object({
  id: z.string(),
  visitante: z.string(),
  tipo: z.string(),
  estado: z.string(),
  validoDesde: z.string(),
  validoHasta: z.string(),
  patente: z.string().nullable().optional(),
});

const outputSchema = z.object({
  encontrado: z.boolean(),
  mensaje: z.string().optional(),
  casa: z.string().optional(),
  cantidad: z.number().int().nonnegative().optional(),
  visitas: z.array(visitaSchema).optional(),
});
type ConsultarVisitasOutput = z.infer<typeof outputSchema>;

/**
 * Segunda `VigiliaTool` de consulta de Fase 2 (Bloque F2.1 —
 * docs/modulos/agente-cerebro.md §12). `access: 'read'`.
 *
 * SEGURIDAD: `VisitsService` ya es tenant-aware (PR #50, en main) —
 * `findAll({ familyId })` filtra por `organizationId` vía `TenantContextService`
 * salvo que se pase `skipTenantScope`, que esta tool nunca pasa. Aun así, el
 * `familyId` que se le pasa NUNCA sale del input del modelo: se deriva
 * EXCLUSIVAMENTE de `FamiliesService.findByDepartment`, que también es
 * tenant-scoped (misma garantía que ya documenta `BuscarResidenteTool` — su
 * `findOne` interno aplica `scopeWhere` contra el tenant de la request).
 * Además, se re-valida explícitamente `family.organizationId === ctx.tenantId`
 * ANTES de listar sus visitas — defensa en profundidad por capas (mismo
 * criterio que el fix M1 de `NotificarResidenteTool`): un modelo nunca puede
 * alcanzar visitas de otro condominio pasando un identificador de casa,
 * porque nunca controla el `familyId` real usado en la consulta.
 */
@Injectable()
export class ConsultarVisitasTool
  implements VigiliaTool<ConsultarVisitasInput, ConsultarVisitasOutput>
{
  readonly name = 'consultar_visitas';
  readonly description =
    'Consulta las visitas (pendientes o en curso, salvo que se pida lo contrario) registradas para una casa/departamento. Requiere el número o código de casa.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'read' as const;
  readonly requiresApproval = false;
  readonly requiredScopes = ['digital-concierge.access'];

  constructor(
    private readonly familiesService: FamiliesService,
    private readonly visitsService: VisitsService,
  ) {}

  async execute(
    ctx: AuthorizedContext,
    input: ConsultarVisitasInput,
  ): Promise<ConsultarVisitasOutput> {
    const family = await this.familiesService.findByDepartment(input.casa);

    if (
      !family ||
      (!ctx.isSuperAdmin && family.organizationId !== ctx.tenantId)
    ) {
      return {
        encontrado: false,
        mensaje: `No se encontró ninguna familia registrada en ${input.casa}.`,
      };
    }

    const soloActivas = input.soloActivas ?? true;
    const allVisits = await this.visitsService.findAll({ familyId: family.id });
    const visits = soloActivas
      ? allVisits.filter((visit) => NON_TERMINAL_VISIT_STATUSES.has(visit.status))
      : allVisits;

    return {
      encontrado: true,
      casa: input.casa,
      cantidad: visits.length,
      visitas: visits.map((visit) => ({
        id: visit.id,
        visitante: visit.visitorName,
        tipo: visit.type,
        estado: visit.status,
        validoDesde: visit.validFrom.toISOString(),
        validoHasta: visit.validUntil.toISOString(),
        patente: visit.vehicle?.plate ?? null,
      })),
    };
  }
}
