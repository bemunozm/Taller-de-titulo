import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PendingActionsService } from './pending-actions.service';
import { ToolRegistryService } from './tool-registry.service';
import { auditToolCall } from './tool-audit.util';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';
import { LogsService } from '../logs/logs.service';

/**
 * Forma fija que el agente recibe cuando una tool con `requiresApproval:
 * true` escala en vez de ejecutar (Fase 2, Bloque F2.1 —
 * docs/modulos/agente-cerebro.md §12). Deliberadamente NO se valida contra
 * `tool.outputSchema` (ese schema describe la salida de la tool YA
 * ejecutada, no este sobre "quedó pendiente") — es un envelope distinto,
 * fijo para todo el catálogo.
 */
export interface PendingApprovalResult {
  pendiente: true;
  pendingActionId: string;
  mensaje: string;
}

/**
 * Dispatcher del catálogo de tools (Fase 1, Bloque A2a —
 * docs/modulos/agente-cerebro.md §5). Es el ÚNICO lugar donde una tool pasa
 * de "lo que pidió el modelo" a "se ejecutó de verdad": evalúa `requiredScopes`
 * contra el `AuthorizedContext` (mismo criterio "alguno de los requeridos" que
 * `AuthorizationGuard` — implementación propia en `hasRequiredScopes`, ver su
 * docstring sobre por qué NO reusa `hasAnyPermission` de
 * auth/utils/permissions.util.ts — regla dura #6 del §5), luego valida
 * entrada/salida con Zod, ejecuta, y audita cada intento (exitoso o no) vía
 * `logs.service` (regla dura #4).
 *
 * Revisión de calidad: el chequeo de scopes corre ANTES de Zod (no después,
 * como antes de este fix) — un caller sin el scope requerido no debe recibir
 * feedback de validación (forma/tipos esperados del input) antes de enterarse
 * de que ni siquiera tiene permiso para llamar la tool.
 *
 * Fase 2, Bloque F2.1 (§12 del diseño): activa la política de autonomía que
 * el contrato `VigiliaTool.requiresApproval` prometía desde Fase 1 pero que
 * nadie leía. Si `tool.requiresApproval === true`, el input ya validado
 * (Zod) NO se ejecuta acá — se delega en `PendingActionsService.create`, que
 * persiste una `PendingAction` y escala (notifica). El dispatcher sigue
 * siendo el único punto de auditoría: ambos caminos (ejecución directa y
 * escalada) llaman a `auditToolCall` con la MISMA forma.
 *
 * El Agent Runner (AI SDK) NO llama `tool.execute` directamente: siempre pasa
 * por acá, tanto si la tool se invoca vía el loop del agente (adaptador en
 * `agent-runner.service.ts`) como si en el futuro se expone también por MCP u
 * otro consumidor (ver §4 del doc — "mismo AuthorizedContext y mismo
 * catálogo").
 */
@Injectable()
export class ToolDispatcherService {
  private readonly logger = new Logger(ToolDispatcherService.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly logsService: LogsService,
    private readonly pendingActionsService: PendingActionsService,
  ) {}

  /**
   * Resuelve una tool por nombre. Lanza si no existe — separado de
   * `execute()` para que el adaptador del AI SDK (agent-runner.service.ts)
   * pueda construir el `ToolSet` iterando el catálogo sin repetir este
   * lookup en cada llamada.
   */
  resolve(toolName: string): VigiliaTool<unknown, unknown> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      throw new NotFoundException(
        `Tool desconocida en el catálogo: "${toolName}"`,
      );
    }
    return tool;
  }

  /**
   * Ejecuta una tool ya resuelta: evalúa scopes → valida input (Zod) →
   * ejecuta (o escala, si `requiresApproval`) → valida output (Zod, solo en
   * el camino directo) → audita. Cualquier fallo en estos pasos también se
   * audita (para que un intento denegado o un input inválido quede trazado,
   * no solo las ejecuciones exitosas).
   *
   * Orden deliberado (FIX de revisión de calidad — antes se validaba Zod
   * primero): los scopes se chequean ANTES que el input, para que un caller
   * sin el permiso requerido reciba el 403 directamente, sin que el mensaje
   * de error de Zod (que describe la forma/tipos esperados del input) le
   * confirme detalles del contrato de la tool antes del "prohibido".
   */
  async execute(
    tool: VigiliaTool<unknown, unknown>,
    ctx: AuthorizedContext,
    rawInput: unknown,
  ): Promise<unknown> {
    const startedAt = Date.now();

    if (!this.hasRequiredScopes(tool, ctx)) {
      const error = new ForbiddenException(
        `El contexto autorizado no tiene los permisos requeridos por "${tool.name}" (${tool.requiredScopes.join(', ')})`,
      );
      await auditToolCall(
        this.logsService,
        tool,
        ctx,
        rawInput,
        undefined,
        false,
        Date.now() - startedAt,
        error,
      );
      throw error;
    }

    let parsedInput: unknown;

    try {
      parsedInput = tool.inputSchema.parse(rawInput);
    } catch (error) {
      await auditToolCall(
        this.logsService,
        tool,
        ctx,
        rawInput,
        undefined,
        false,
        Date.now() - startedAt,
        error,
      );
      throw error;
    }

    // Fase 2, Bloque F2.2 (§12 del diseño): `requiresApproval` puede ser un
    // `boolean` fijo (tools de F2.1) o una función (autonomía condicional al
    // input/contexto de ESTA llamada, p.ej. `abrir_acceso` — ¿el visitante de
    // esta sesión tiene una visita pre-aprobada vigente?). Se evalúa DESPUÉS
    // de Zod (mismo orden que antes: nunca se decide autonomía sobre un input
    // sin validar) y se audita si la evaluación misma lanza (p.ej. la tool
    // consulta una `ConciergeSession` inexistente/cross-tenant) — mismo
    // criterio de auditoría que el resto de pasos de este método.
    let needsApproval: boolean;

    try {
      needsApproval =
        typeof tool.requiresApproval === 'function'
          ? await tool.requiresApproval(ctx, parsedInput)
          : tool.requiresApproval;
    } catch (error) {
      await auditToolCall(
        this.logsService,
        tool,
        ctx,
        parsedInput,
        undefined,
        false,
        Date.now() - startedAt,
        error,
      );
      throw error;
    }

    if (needsApproval) {
      return this.escalateForApproval(tool, ctx, parsedInput, startedAt);
    }

    try {
      const rawOutput = await tool.execute(ctx, parsedInput);
      const output = tool.outputSchema.parse(rawOutput);
      await auditToolCall(
        this.logsService,
        tool,
        ctx,
        parsedInput,
        output,
        true,
        Date.now() - startedAt,
      );
      return output;
    } catch (error) {
      await auditToolCall(
        this.logsService,
        tool,
        ctx,
        parsedInput,
        undefined,
        false,
        Date.now() - startedAt,
        error,
      );
      throw error;
    }
  }

  /**
   * Camino de escalada (Fase 2, Bloque F2.1): crea la `PendingAction`
   * (`PendingActionsService.create` ya notifica) y devuelve el envelope fijo
   * `{ pendiente: true, ... }` para que Sofía le diga al visitante que está
   * consultando en vez de confirmar una acción que todavía no ocurrió.
   */
  private async escalateForApproval(
    tool: VigiliaTool<unknown, unknown>,
    ctx: AuthorizedContext,
    parsedInput: unknown,
    startedAt: number,
  ): Promise<PendingApprovalResult> {
    const pendingAction = await this.pendingActionsService.create(
      tool,
      ctx,
      parsedInput,
    );

    const result: PendingApprovalResult = {
      pendiente: true,
      pendingActionId: pendingAction.id,
      mensaje: `Tu solicitud ("${tool.name}") quedó pendiente de aprobación de un residente o conserje.`,
    };

    await auditToolCall(
      this.logsService,
      tool,
      ctx,
      parsedInput,
      result,
      true,
      Date.now() - startedAt,
    );

    return result;
  }

  /**
   * Regla dura #6 del §5: mismo criterio "alguno de los requeridos" que
   * `AuthorizationGuard` para el caso no-vacío. Implementación PROPIA
   * (no llama a `hasAnyPermission` de auth/utils/permissions.util.ts) porque
   * el caso `[]` tiene semántica opuesta a propósito: una tool con
   * `requiredScopes: []` no declaró ningún gate de permisos, así que
   * cualquier `AuthorizedContext` autenticado (hub físico o sesión humana)
   * puede ejecutarla — a diferencia de `@RequirePermissions()` vacío en una
   * ruta HTTP, que ahora deniega (ver el docstring de `hasAnyPermission`).
   */
  private hasRequiredScopes(
    tool: VigiliaTool<unknown, unknown>,
    ctx: AuthorizedContext,
  ): boolean {
    if (tool.requiredScopes.length === 0) {
      return true;
    }
    return tool.requiredScopes.some((scope) => ctx.scopes.includes(scope));
  }
}
