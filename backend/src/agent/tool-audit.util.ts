import { ZodError } from 'zod';
import {
  LogLevel,
  LogType,
  ServiceName,
} from '../logs/entities/system-log.entity';
import { LogsService } from '../logs/logs.service';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

/**
 * Regla dura #4 del §5 (docs/modulos/agente-cerebro.md): cada `execute` de
 * una `VigiliaTool` queda auditado, exitoso o no. Extraído de
 * `ToolDispatcherService` en Fase 2, Bloque F2.1 para que
 * `PendingActionsService.approve` (que también ejecuta una tool, en un turno
 * HTTP distinto al que la escaló) audite con EXACTAMENTE la misma forma —
 * "mantén la auditoría en ambos caminos" (§12 del diseño) sin duplicar la
 * lógica en dos archivos.
 */
export async function auditToolCall(
  logsService: LogsService,
  tool: VigiliaTool<unknown, unknown>,
  ctx: AuthorizedContext,
  input: unknown,
  output: unknown,
  success: boolean,
  durationMs: number,
  error?: unknown,
): Promise<void> {
  const isValidationError = error instanceof ZodError;

  await logsService.log({
    level: success ? LogLevel.INFO : LogLevel.WARN,
    type: LogType.AGENT_TOOL_CALL,
    service: ServiceName.BACKEND,
    message: `agent-tool ${tool.name}: ${success ? 'ok' : 'denegado/error'} (${durationMs}ms)`,
    responseTime: durationMs,
    correlationId: ctx.requestId,
    errorMessage: error ? describeToolError(error) : undefined,
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
}

export function describeToolError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
