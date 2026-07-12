import type { ZodType } from 'zod';
import type { AuthorizedContext, Permission } from './authorized-context.type';

/**
 * Contrato de tool del agente-cerebro — docs/modulos/agente-cerebro.md §5.
 * Es el "corazón" del diseño: el activo durable que sobrevive a cualquier
 * cambio de framework de orquestación (hoy Vercel AI SDK).
 *
 * Reglas duras (no negociables, ver §5 del doc):
 * 1. `tenantId` nunca es un campo de `TInput` — siempre viene de `ctx`.
 * 2. `access` separa read/write explícitamente.
 * 3. Zod valida la entrada Y la salida (aduana modelo↔código).
 * 4. Cada `execute` es auditado por el dispatcher (logs.service).
 * 5. El cálculo/decisión de negocio vive en el servicio de dominio inyectado
 *    en la tool — la tool es un adaptador delgado, no el lugar de la lógica.
 * 6. `requiredScopes` se evalúa en NestJS ANTES de invocar `execute`.
 */
export interface VigiliaTool<TInput = unknown, TOutput = unknown> {
  /** Nombre único de la tool (el que ve/llama el modelo). */
  readonly name: string;

  /** Descripción para el modelo — invertir tiempo acá importa más que en el código. */
  readonly description: string;

  /** Valida el input que arma el modelo. */
  readonly inputSchema: ZodType<TInput>;

  /** Valida lo que devuelve `execute` antes de mandarlo de vuelta al modelo. */
  readonly outputSchema: ZodType<TOutput>;

  /** `read` no muta estado; `write` sí (candidata a `requiresApproval`/política). */
  readonly access: 'read' | 'write';

  /**
   * Si `true`, ejecutar esta tool requiere aprobación humana explícita
   * (política de autonomía, §6 del doc). En A2a ninguna tool la usa todavía
   * (solo hay tools `read`) — el dispatcher deja el campo listo para cuando
   * Fase 2 agregue writes sensibles (portón/puerta).
   */
  readonly requiresApproval: boolean;

  /** Permisos (nombres `module.action` de DEFAULT_PERMISSIONS) requeridos para ejecutar. */
  readonly requiredScopes: Permission[];

  /** Lógica de la tool — delega el cálculo real al servicio de dominio inyectado. */
  execute(ctx: AuthorizedContext, input: TInput): Promise<TOutput>;
}
