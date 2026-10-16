import type { ZodType } from 'zod';
import type { IdentifiedAgentChannel } from '../agent-channel';
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
   * Política de autonomía (§6 del doc). En A2a/F2.1 todas las tools usaban un
   * `boolean` fijo. Fase 2, Bloque F2.2 (docs/modulos/agente-cerebro.md §12):
   * se admite además una función — necesaria para tools como `abrir_acceso`,
   * donde la necesidad de aprobación depende del INPUT/contexto de CADA
   * llamada (¿el visitante de ESTA sesión tiene una visita pre-aprobada
   * vigente?), no de la tool en abstracto. `true`/resuelve a `true` => se
   * escala (ver `ToolDispatcherService.escalateForApproval`); `false`/resuelve
   * a `false` => se ejecuta directo.
   *
   * Retrocompatible: las tools existentes (`buscar_residente`,
   * `finalizar_llamada`, etc.) siguen declarando el `boolean` literal tal
   * cual — `ToolDispatcherService` distingue el caso en runtime con
   * `typeof tool.requiresApproval === 'function'`.
   */
  readonly requiresApproval:
    | boolean
    | ((ctx: AuthorizedContext, input: TInput) => boolean | Promise<boolean>);

  /** Permisos (nombres `module.action` de DEFAULT_PERMISSIONS) requeridos para ejecutar. */
  readonly requiredScopes: Permission[];

  /**
   * Fase 4 · P4.B (D8, cyber B2): canales desde los que se puede ver y
   * ejecutar la tool. OBLIGATORIO y sin default: cada tool declara su lista
   * explícita (una tool nueva no queda abierta a todos los canales por
   * omisión). `unknown` no se puede declarar y nunca ejecuta. El dispatcher
   * lo evalúa ANTES que los scopes, y `ToolRegistryService.getAvailableFor`
   * lo usa para no exponerle al modelo tools que no podría ejecutar.
   */
  readonly allowedChannels: readonly IdentifiedAgentChannel[];

  /** Lógica de la tool — delega el cálculo real al servicio de dominio inyectado. */
  execute(ctx: AuthorizedContext, input: TInput): Promise<TOutput>;
}
