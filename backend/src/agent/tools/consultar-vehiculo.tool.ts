import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { VehiclesService } from '../../vehicles/vehicles.service';
import type { AuthorizedContext } from '../types/authorized-context.type';
import type { VigiliaTool } from '../types/vigilia-tool.type';
import { isInTenantScope } from '../../common/tenant/tenant-context.util';
import {
  vehicleAccessRuleFor,
  type VehicleAccessRule,
} from '../../vehicles/vehicle-access';

const inputSchema = z.object({
  patente: z
    .string()
    .min(1)
    .describe(
      'Patente del vehículo tal como la dijo o leyó el visitante/cámara (ej: "ABCD12", "AB1234").',
    ),
});
type ConsultarVehiculoInput = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  encontrado: z.boolean(),
  mensaje: z.string().optional(),
  patente: z.string().optional(),
  marca: z.string().nullable().optional(),
  modelo: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  carroceria: z.string().nullable().optional(),
  nivelAcceso: z.string().nullable().optional(),
  accesoPorton: z.string().optional(),
  activo: z.boolean().nullable().optional(),
  propietario: z.string().nullable().optional(),
});
type ConsultarVehiculoOutput = z.infer<typeof outputSchema>;

/** Qué hace el portón con el vehículo, en palabras para el agente (P5.C). */
const GATE_ACCESS_DESCRIPTION: Record<VehicleAccessRule, string> = {
  allow: 'abre (vehículo de residente)',
  'requires-visit': 'abre solo con una visita válida',
  concierge: 'lo decide el conserje',
};

/**
 * Primera `VigiliaTool` de consulta de Fase 2 (Bloque F2.1 —
 * docs/modulos/agente-cerebro.md §12). `access: 'read'` — no muta estado.
 *
 * SEGURIDAD: `VehiclesService.findByPlate` es DELIBERADAMENTE no
 * tenant-aware (lo usa `DetectionsService` en el flujo del worker LPR, sin
 * sesión de usuario — ver el comentario del propio constructor de
 * `VehiclesService`). Esta tool NO puede confiar en el servicio para el
 * aislamiento: re-valida acá que `vehicle.organizationId` coincida con
 * `ctx.tenantId` (mismo patrón de `NotificarResidenteTool`/fix M1, §6 del
 * diseño) ANTES de devolver cualquier dato — si no coincide, responde
 * "no encontrado" en vez de "prohibido", para no confirmarle a un modelo
 * comprometido que la patente SÍ existe en otro condominio.
 */
@Injectable()
export class ConsultarVehiculoTool
  implements VigiliaTool<ConsultarVehiculoInput, ConsultarVehiculoOutput>
{
  readonly name = 'consultar_vehiculo';
  readonly description =
    'Busca un vehículo registrado por su patente. Devuelve marca, modelo, color, carrocería, nivel de acceso (residente, visitante o servicio), qué hace el portón con él y propietario si existe y pertenece a este condominio.';
  readonly inputSchema = inputSchema;
  readonly outputSchema = outputSchema;
  readonly access = 'read' as const;
  readonly requiresApproval = false;
  /**
   * Fase 4 · P4.B (D8): consulta de datos del condominio, solo para humanos
   * con `digital-concierge.manage` (Conserje, Administrador). Un hub o un
   * kiosko no la ven ni la ejecutan; el prompt de voz no la usa.
   */
  readonly requiredScopes = ['digital-concierge.manage'];
  readonly allowedChannels = ['human'] as const;

  constructor(private readonly vehiclesService: VehiclesService) {}

  async execute(
    ctx: AuthorizedContext,
    input: ConsultarVehiculoInput,
  ): Promise<ConsultarVehiculoOutput> {
    const vehicle = await this.vehiclesService.findByPlate(input.patente);

    if (!vehicle || !isInTenantScope(vehicle.organizationId, ctx)) {
      return {
        encontrado: false,
        mensaje: `No se encontró ningún vehículo registrado con patente ${input.patente}.`,
      };
    }

    return {
      encontrado: true,
      patente: vehicle.plate,
      marca: vehicle.brand,
      modelo: vehicle.model,
      color: vehicle.color,
      // Fase 4 · P5.C (modelo corregido): `vehicleType` es la carrocería y
      // `accessLevel` lo único que decide el portón.
      carroceria: vehicle.vehicleType,
      nivelAcceso: vehicle.accessLevel,
      accesoPorton:
        GATE_ACCESS_DESCRIPTION[vehicleAccessRuleFor(vehicle.accessLevel)],
      activo: vehicle.active,
      propietario: vehicle.owner?.name ?? null,
    };
  }
}
