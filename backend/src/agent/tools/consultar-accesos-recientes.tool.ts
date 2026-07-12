import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { DetectionsService } from '../../detections/detections.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';

const inputSchema = z.object({
  limite: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe(
      'Cantidad máxima de accesos recientes a devolver (por defecto 10, máximo 50).',
    ),
});
type ConsultarAccesosRecientesInput = z.infer<typeof inputSchema>;

const accesoSchema = z.object({
  patente: z.string().nullable(),
  decision: z.string(),
  motivo: z.string().nullable(),
  fecha: z.string(),
  residente: z.string().nullable(),
});

const outputSchema = z.object({
  cantidad: z.number().int().nonnegative(),
  accesos: z.array(accesoSchema),
});
type ConsultarAccesosRecientesOutput = z.infer<typeof outputSchema>;

const DEFAULT_LIMIT = 10;

/**
 * Tercera `VigiliaTool` de consulta de Fase 2 (Bloque F2.1 —
 * docs/modulos/agente-cerebro.md §12). `access: 'read'`. Fuente: `AccessAttempt`
 * (decisión de acceso ya tomada — Permitido/Denegado/Pendiente), no
 * `PlateDetection` cruda: es la entidad que responde "qué pasó en el acceso",
 * que es lo que un residente/conserje pregunta por el citófono/chat.
 *
 * SEGURIDAD: a diferencia de `Visit`, `AccessAttempt.organizationId` (y el de
 * `PlateDetection` del que hereda) SÍ se estampa de forma confiable en cada
 * creación — resource-derived desde la cámara asociada
 * (`DetectionsService.resolveCameraOrganizationId`), no desde
 * `TenantContext`. Por eso `DetectionsService.listAttempts` puede filtrar
 * directo por `organizationId` (parámetro `tenantScope`, agregado en este
 * bloque — ver su docstring) en vez de necesitar el rodeo de
 * "derivar-y-comparar" que usan `consultar_vehiculo`/`consultar_visitas`.
 */
@Injectable()
export class ConsultarAccesosRecientesTool
  implements
    VigiliaTool<ConsultarAccesosRecientesInput, ConsultarAccesosRecientesOutput>
{
  readonly name = 'consultar_accesos_recientes';
  readonly description =
    'Lista los accesos (entradas/salidas de vehículos) más recientes del condominio, con su decisión (Permitido/Denegado/Pendiente) y el residente asociado si aplica.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'read' as const;
  readonly requiresApproval = false;
  readonly requiredScopes = ['digital-concierge.access'];

  constructor(private readonly detectionsService: DetectionsService) {}

  async execute(
    ctx: AuthorizedContext,
    input: ConsultarAccesosRecientesInput,
  ): Promise<ConsultarAccesosRecientesOutput> {
    const limite = input.limite ?? DEFAULT_LIMIT;

    const attempts = await this.detectionsService.listAttempts(limite, {
      organizationId: ctx.tenantId,
      isSuperAdmin: ctx.isSuperAdmin,
    });

    return {
      cantidad: attempts.length,
      accesos: attempts.map((attempt) => ({
        patente: attempt.detection?.plate ?? null,
        decision: attempt.decision,
        motivo: attempt.reason,
        fecha: attempt.createdAt.toISOString(),
        residente: attempt.residente?.name ?? null,
      })),
    };
  }
}
