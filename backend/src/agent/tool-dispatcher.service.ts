import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import {
  LogLevel,
  LogType,
  ServiceName,
} from '../logs/entities/system-log.entity';
import { LogsService } from '../logs/logs.service';
import { ToolRegistryService } from './tool-registry.service';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

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
   * ejecuta → valida output (Zod) → audita. Cualquier fallo en estos pasos
   * también se audita (para que un intento denegado o un input inválido
   * quede trazado, no solo las ejecuciones exitosas).
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
      await this.audit(
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
      await this.audit(
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

    try {
      const rawOutput = await tool.execute(ctx, parsedInput);
      const output = tool.outputSchema.parse(rawOutput);
      await this.audit(
        tool,
        ctx,
        parsedInput,
        output,
        true,
        Date.now() - startedAt,
      );
      return output;
    } catch (error) {
      await this.audit(
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

  private async audit(
    tool: VigiliaTool<unknown, unknown>,
    ctx: AuthorizedContext,
    input: unknown,
    output: unknown,
    success: boolean,
    durationMs: number,
    error?: unknown,
  ): Promise<void> {
    const isValidationError = error instanceof ZodError;

    await this.logsService.log({
      level: success ? LogLevel.INFO : LogLevel.WARN,
      type: LogType.AGENT_TOOL_CALL,
      service: ServiceName.BACKEND,
      message: `agent-tool ${tool.name}: ${success ? 'ok' : 'denegado/error'} (${durationMs}ms)`,
      responseTime: durationMs,
      correlationId: ctx.requestId,
      errorMessage: error ? this.describeError(error) : undefined,
      metadata: {
        toolName: tool.name,
        access: tool.access,
        requiredScopes: tool.requiredScopes,
        tenantId: ctx.tenantId,
        userId: ctx.userId ?? null,
        role: ctx.role,
        success,
        validationError: isValidationError,
        input,
        output,
      },
    });

    if (!success) {
      this.logger.warn(
        `Tool "${tool.name}" no se ejecutó (ctx.requestId=${ctx.requestId}): ${this.describeError(error)}`,
      );
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
