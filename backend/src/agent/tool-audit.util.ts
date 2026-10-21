import { ZodError } from 'zod';
import {
  LogLevel,
  LogType,
  ServiceName,
} from '../logs/entities/system-log.entity';
import { LogsService } from '../logs/logs.service';
import { scrubPiiInText } from '../common/privacy/pii-mask';
import {
  describeInputShape,
  redactPersonalData,
} from '../common/privacy/pii-redaction';
import { isAgentChannel } from './agent-channel';
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
 *
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): `input` y `output`
 * se guardan redactados por campo, según los esquemas Zod de las tools.
 * Nombres (visitante, residentes, familia, propietario) y motivo omitidos;
 * RUT, teléfono y patente enmascarados. Se conservan ids, casa, conteos y
 * banderas. Úsese SOLO con un input ya validado por la tool; un input
 * rechazado va por `auditToolRejection`.
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
  await writeToolAudit(logsService, tool, ctx, {
    success,
    durationMs,
    error,
    input: redactPersonalData(input),
    output: redactPersonalData(output),
  });
}

/**
 * Corrección P7 (cyber A1): auditoría de un input RECHAZADO antes de
 * validarse (canal o permiso denegado) o por Zod. De ese input solo se guarda
 * su forma (claves de primer nivel con tipo y largo, `describeInputShape`),
 * nunca los valores: puede pesar megabytes o traer datos personales fuera de
 * esquema, y no se recorre ni se le aplica ninguna regex.
 */
export async function auditToolRejection(
  logsService: LogsService,
  tool: VigiliaTool<unknown, unknown>,
  ctx: AuthorizedContext,
  rawInput: unknown,
  durationMs: number,
  error: unknown,
): Promise<void> {
  await writeToolAudit(logsService, tool, ctx, {
    success: false,
    durationMs,
    error,
    inputShape: describeInputShape(rawInput),
  });
}

interface ToolAuditEntry {
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: unknown;
  /** Input validado y redactado (`auditToolCall`). */
  readonly input?: unknown;
  readonly output?: unknown;
  /** Forma del input rechazado, sin valores (`auditToolRejection`). */
  readonly inputShape?: unknown;
}

async function writeToolAudit(
  logsService: LogsService,
  tool: VigiliaTool<unknown, unknown>,
  ctx: AuthorizedContext,
  entry: ToolAuditEntry,
): Promise<void> {
  const { success, durationMs, error } = entry;

  await logsService.log({
    level: success ? LogLevel.INFO : LogLevel.WARN,
    type: LogType.AGENT_TOOL_CALL,
    service: ServiceName.BACKEND,
    message: `agent-tool ${tool.name}: ${success ? 'ok' : 'denegado/error'} (${durationMs}ms)`,
    responseTime: durationMs,
    correlationId: ctx.requestId,
    // Recortado (~2 KB) y enmascarado: un error de Zod repite las claves del
    // input recibido.
    errorMessage: error ? scrubPiiInText(describeToolError(error)) : undefined,
    metadata: {
      toolName: tool.name,
      access: tool.access,
      requiredScopes: tool.requiredScopes,
      tenantId: ctx.tenantId,
      userId: ctx.userId ?? null,
      role: ctx.role,
      // Fase 4 · P4.B (D6): canal del turno (dispositivo físico, kiosko o
      // humano). Un snapshot de `PendingAction` previo a P4.B no lo trae.
      channel: isAgentChannel(ctx.channel) ? ctx.channel : 'unknown',
      success,
      validationError: error instanceof ZodError,
      ...(entry.inputShape === undefined
        ? { input: entry.input, output: entry.output }
        : { inputShape: entry.inputShape }),
    },
  });
}

export function describeToolError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
