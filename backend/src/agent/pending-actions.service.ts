import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ConciergeSession,
  SessionStatus,
} from '../digital-concierge/entities/concierge-session.entity';
import { DigitalConciergeService } from '../digital-concierge/services/digital-concierge.service';
import { HubGateway } from '../hub/hub.gateway';
import { LogsService } from '../logs/logs.service';
import {
  NotificationPriority,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PendingAction,
  PendingActionStatus,
} from './entities/pending-action.entity';
import { ToolRegistryService } from './tool-registry.service';
import { auditToolCall, describeToolError } from './tool-audit.util';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';
import type { TenantScope } from '../common/tenant/tenant-context.types';
import { ABRIR_ACCESO_TOOL_NAME } from './tools/abrir-acceso.tool';
import { isAgentChannel, type AgentChannel } from './agent-channel';
import { isToolAllowedOnChannel } from './tool-access.util';
import { isInTenantScope } from '../common/tenant/tenant-context.util';
import { scrubPiiInText } from '../common/privacy/pii-mask';
import { redactPersonalData } from '../common/privacy/pii-redaction';

/**
 * Antigüedad máxima para ejecutar una acción aprobada (Fase 4 · P4.B, cyber
 * B1): 15 minutos, el mismo timeout de la sesión del citófono. Pasado ese
 * tiempo, el visitante que la originó ya no está esperando.
 */
export const PENDING_ACTION_MAX_AGE_MS = 15 * 60_000;

/**
 * ¿La tool ejecutada abrió un acceso físico? Solo `abrir_acceso` lo hace, y lo
 * confirma con `abierto: true` (un hub físico recibió la orden). Cualquier
 * otra salida cuenta como "no se abrió" (fail-closed).
 */
function accessWasOpened(toolName: string, output: unknown): boolean {
  return (
    toolName === ABRIR_ACCESO_TOOL_NAME &&
    typeof output === 'object' &&
    output !== null &&
    (output as { abierto?: unknown }).abierto === true
  );
}

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §3): lo que se persiste
 * de una acción pendiente, con los datos personales minimizados.
 *
 *  - `contextSnapshot`: SOLO los campos de `AuthorizedContext` que necesita
 *    el replay (condominio, usuario, rol, canal, scopes, request y sesión),
 *    copiados uno a uno: un campo que se agregue al contexto no se persiste
 *    por omisión. Ninguno es un dato personal (son ids y permisos).
 *  - `input`: ÍNTEGRO mientras la acción se puede ejecutar (`pending`,
 *    `approved` en curso y `failed`, que se reintenta con el mismo input):
 *    `approve()` lo pasa tal cual a `tool.execute`. Al llegar a un estado
 *    terminal (`executed`, `rejected`, `expired`) ya no se va a ejecutar, y
 *    se reemplaza por su versión redactada (`redactPersonalData`).
 *  - `result` y `lastError`: redactados al persistir. La primera aprobación
 *    devuelve al aprobador la salida en memoria; una relectura (doble
 *    aprobación) devuelve la persistida, ya redactada.
 *
 * Hoy solo `abrir_acceso` escala (input `{ tipo }`, salida `{ abierto,
 * mensaje }`): no hay datos personales, pero la regla vale para cualquier
 * tool que escale en el futuro.
 */
function replaySnapshotOf(ctx: AuthorizedContext): AuthorizedContext {
  return {
    tenantId: ctx.tenantId,
    isSuperAdmin: ctx.isSuperAdmin,
    userId: ctx.userId,
    role: ctx.role,
    channel: ctx.channel,
    scopes: [...ctx.scopes],
    requestId: ctx.requestId,
    sessionId: ctx.sessionId,
  };
}

/** Versión persistible (jsonb) de un valor redactado. */
function redactedJson(value: unknown): Record<string, unknown> {
  // TypeORM's `QueryDeepPartialEntity` no acepta un `unknown` literal para
  // una columna jsonb en `update()` (ver el comentario de `result` abajo).
  return redactPersonalData(value) as Record<string, unknown>;
}

/**
 * Fase 2, Bloque F2.1 (docs/modulos/agente-cerebro.md §12): mecanismo de
 * autonomía/aprobación. Es el único lugar donde una `PendingAction` pasa de
 * "pendiente" a "ejecutada" — `ToolDispatcherService` la crea (y notifica),
 * este servicio la resuelve.
 *
 * Deliberadamente NO depende de `ToolDispatcherService` (evita un ciclo de
 * providers): resuelve la tool directo desde `ToolRegistryService` y comparte
 * la auditoría vía `tool-audit.util.ts`, no vía el dispatcher.
 */
@Injectable()
export class PendingActionsService {
  private readonly logger = new Logger(PendingActionsService.name);

  constructor(
    @InjectRepository(PendingAction)
    private readonly repo: Repository<PendingAction>,
    private readonly toolRegistry: ToolRegistryService,
    private readonly notificationsService: NotificationsService,
    private readonly logsService: LogsService,
    // Revisión pre-F2.2 (FIX 3): re-validar la `ConciergeSession` al ejecutar
    // en diferido. Inyectable sin tocar el wiring de módulos: `AgentModule` ya
    // importa `forwardRef(() => DigitalConciergeModule)` (sus tools de
    // escritura ya usan este mismo servicio, ver finalizar-llamada.tool.ts) y
    // `DigitalConciergeModule` ya exporta `DigitalConciergeService`.
    private readonly conciergeService: DigitalConciergeService,
    // Aviso en vivo al visitante (ver `notifyVisitorLive` más abajo): MISMO
    // gateway que ya inyecta `AbrirAccesoTool` (`HubModule` ya exportado y
    // disponible en `AgentModule`, ver agent.module.ts) — ningún cambio de
    // wiring de módulos necesario.
    private readonly hubGateway: HubGateway,
  ) {}

  /**
   * Crea la acción pendiente y escala (notifica). Se llama desde
   * `ToolDispatcherService.execute` cuando `tool.requiresApproval === true`,
   * DESPUÉS de validar scopes e input (Zod) — `input` ya es el parseado, no
   * el `rawInput` del modelo.
   */
  async create(
    tool: VigiliaTool<unknown, unknown>,
    ctx: AuthorizedContext,
    input: unknown,
  ): Promise<PendingAction> {
    const entity = this.repo.create({
      tenantId: ctx.tenantId,
      sessionId: ctx.sessionId ?? null,
      toolName: tool.name,
      // Íntegro: lo necesita el replay (ver `replaySnapshotOf`).
      input,
      requestId: ctx.requestId,
      status: PendingActionStatus.PENDING,
      contextSnapshot: replaySnapshotOf(ctx),
      result: null,
      resolvedBy: null,
      resolvedAt: null,
    });

    const saved = await this.repo.save(entity);

    await this.notifyEscalation(saved, tool);

    return saved;
  }

  /**
   * Busca una acción pendiente ASEGURANDO que pertenezca al condominio del
   * `tenantScope` — mismo patrón que
   * `DigitalConciergeService.findSessionForTenant` (§6 del diseño: un
   * conserje/residente del condominio A no puede aprobar/ver una acción
   * escalada en el condominio B, aunque conozca o adivine su id).
   */
  async findForTenant(
    id: string,
    tenantScope: TenantScope,
  ): Promise<PendingAction> {
    const action = await this.repo.findOne({ where: { id } });

    if (!action) {
      throw new NotFoundException(`Acción pendiente "${id}" no encontrada`);
    }

    // Fase 4 · P5.C: un scope sin condominio no alcanza ninguna acción.
    if (!isInTenantScope(action.tenantId, tenantScope)) {
      throw new ForbiddenException(
        `La acción pendiente "${id}" no pertenece al condominio del contexto autorizado`,
      );
    }

    return action;
  }

  /**
   * Aprueba y ejecuta idempotentemente.
   *
   * FIX 1 (revisión pre-F2.2 — bug de concurrencia crítico detectado en QA):
   * la idempotencia NO depende de comparar `requestId` sino de una
   * actualización atómica condicionada al estado ACTUAL de la fila
   * (`repo.update` con el WHERE de abajo): si dos aprobaciones llegan
   * concurrentes sobre una acción `pending`, el WHERE debe reclamarla desde
   * `pending` (o `failed`, ver FIX 2) EXCLUSIVAMENTE — nunca desde `approved`.
   * Antes usaba `Not(EXECUTED)`, que SÍ matchea `approved` y dejaba que una
   * segunda aprobación concurrente reclamara (y ejecutara) una acción que la
   * primera ya estaba ejecutando. Con el claim acotado a
   * `In([PENDING, FAILED])`, la segunda invocación ve `affected === 0` y, al
   * releer, encuentra `approved` (ejecución en curso) o `executed` (ya
   * terminó) — nunca vuelve a invocar `tool.execute`.
   *
   * FIX 2 (estado terminal de fallo + retry): si `tool.execute()` lanza
   * DESPUÉS del claim, la fila NO se queda varada en `approved` — transiciona
   * a `failed` con `lastError` (ver catch abajo). Decisión de retry: `failed`
   * SÍ es reclamable por una nueva llamada a `approve()` (mismo WHERE que
   * `pending`, arriba) — se reintenta la MISMA acción (mismo `input`/
   * `contextSnapshot`) en vez de exigir un endpoint separado o crear una
   * acción nueva. Justificación: un fallo transitorio (p.ej. el hub/relé
   * físico no respondió) debe poder reintentarse con la misma aprobación de
   * un conserje, sin reabrir el flujo de escalada completo. `expired` (FIX 3)
   * NO es reclamable — es terminal a propósito.
   */
  async approve(
    id: string,
    tenantScope: TenantScope,
    resolvedByUserId: string,
  ): Promise<{
    pendingAction: PendingAction;
    result: unknown;
    alreadyExecuted: boolean;
  }> {
    const action = await this.findForTenant(id, tenantScope);

    if (action.status === PendingActionStatus.EXECUTED) {
      return {
        pendingAction: action,
        result: action.result,
        alreadyExecuted: true,
      };
    }

    if (action.status === PendingActionStatus.REJECTED) {
      throw new BadRequestException(
        `La acción pendiente "${id}" ya fue rechazada, no se puede aprobar`,
      );
    }

    if (action.status === PendingActionStatus.EXPIRED) {
      throw new BadRequestException(
        `La acción pendiente "${id}" expiró (el contexto que la originó ya no es válido), no se puede aprobar`,
      );
    }

    // Transición atómica pending/failed -> approved (FIX 1 + FIX 2): si otra
    // request ya ganó la carrera, o la acción está en un estado no
    // reclamable (`approved` en curso, `executed`), afecta 0 filas — releemos
    // el estado final en vez de asumir que "nosotros" debemos ejecutar.
    const claimed = await this.repo.update(
      {
        id,
        status: In([PendingActionStatus.PENDING, PendingActionStatus.FAILED]),
      },
      {
        status: PendingActionStatus.APPROVED,
        resolvedBy: resolvedByUserId,
        resolvedAt: new Date(),
      },
    );

    if (!claimed.affected) {
      const current = await this.findForTenant(id, tenantScope);
      return {
        pendingAction: current,
        result: current.result,
        alreadyExecuted: current.status === PendingActionStatus.EXECUTED,
      };
    }

    const tool = this.toolRegistry.get(action.toolName);
    if (!tool) {
      throw new NotFoundException(
        `Tool desconocida en el catálogo: "${action.toolName}" (acción pendiente "${id}")`,
      );
    }

    // FIX 3: re-validar que el contexto que originó la escalada siga vigente
    // ANTES de ejecutar — ver docstring de `validateExecutionContext`. Si no
    // es válido, esto deja la acción en `expired` y lanza (fail-closed): el
    // catch de abajo nunca llega a invocar `tool.execute`.
    // Fase 4 · P4.B (cyber B1, QA B9): también la antigüedad y el canal del
    // snapshot (ver `validateReplay`).
    const replayCtx = await this.validateReplay(action, tool);
    await this.validateExecutionContext(action, tool);
    const startedAt = Date.now();

    try {
      const rawOutput = await tool.execute(replayCtx, action.input);
      const output = tool.outputSchema.parse(rawOutput);

      await this.repo.update(
        { id, status: PendingActionStatus.APPROVED },
        {
          status: PendingActionStatus.EXECUTED,
          // TypeORM's `QueryDeepPartialEntity` no acepta un `unknown` literal
          // para una columna jsonb (aunque la entidad lo tipa `unknown |
          // null`) — el output de una `VigiliaTool` siempre es el objeto que
          // valida su `outputSchema` (Zod `z.object({...})` por convención,
          // ver §5 del diseño), nunca un primitivo.
          // Fase 4 · P7.L: terminal → input y result redactados.
          input: redactedJson(action.input),
          result: redactedJson(output),
        },
      );

      await auditToolCall(
        this.logsService,
        tool,
        replayCtx,
        action.input,
        output,
        true,
        Date.now() - startedAt,
      );
      await this.notifyResolution(action, tool, 'executed');
      await this.notifyVisitorLive(
        action,
        'approved',
        accessWasOpened(tool.name, output),
      );

      const finalAction = await this.repo.findOneOrFail({ where: { id } });
      return {
        pendingAction: finalAction,
        result: output,
        alreadyExecuted: false,
      };
    } catch (error) {
      await auditToolCall(
        this.logsService,
        tool,
        replayCtx,
        action.input,
        undefined,
        false,
        Date.now() - startedAt,
        error,
      );

      // Fase 4 · P7.L: sin RUT, teléfono, email ni patente (log y lastError).
      const errorMessage = scrubPiiInText(describeToolError(error));
      this.logger.error(
        `Fallo al ejecutar la tool "${tool.name}" tras aprobación (acción pendiente "${id}"): ${errorMessage}`,
      );

      // FIX 2: NO dejar la fila varada en `approved` — transiciona a `failed`
      // (reclamable por un reintento vía `approve()`, ver docstring arriba).
      // Claim acotado a `approved` porque es el único estado desde el que
      // este catch puede correr (lo acabamos de reclamar más arriba).
      // `input` sigue íntegro: `failed` se puede reintentar.
      await this.repo.update(
        { id, status: PendingActionStatus.APPROVED },
        { status: PendingActionStatus.FAILED, lastError: errorMessage },
      );
      await this.notifyResolution(action, tool, 'failed');

      throw error;
    }
  }

  /**
   * Fase 4 · P4.B (cyber B1, QA B9): condiciones del replay, ANTES de
   * ejecutar. Si alguna falla, la acción pasa a `expired` sin ejecutar
   * (fail-closed) y se lanza `BadRequestException`:
   *  - Antigüedad: la acción tiene más de `PENDING_ACTION_MAX_AGE_MS` (15 min,
   *    el mismo timeout de la sesión del citófono). No depende del timeout
   *    perezoso de la sesión.
   *  - Canal: la tool debe estar permitida en el canal del snapshot
   *    (`isToolAllowedOnChannel`). Un snapshot sin canal (anterior a P4.B o
   *    alterado) cuenta como `unknown` y nunca ejecuta.
   *
   * @returns el contexto del snapshot, con el canal normalizado.
   */
  private async validateReplay(
    action: PendingAction,
    tool: VigiliaTool<unknown, unknown>,
  ): Promise<AuthorizedContext> {
    const ageMs = Date.now() - new Date(action.createdAt).getTime();
    if (!(ageMs <= PENDING_ACTION_MAX_AGE_MS)) {
      const reason = `La acción tiene más de ${PENDING_ACTION_MAX_AGE_MS / 60_000} minutos`;
      await this.expireAction(action, tool, reason);
      throw new BadRequestException(
        `La acción pendiente "${action.id}" expiró: ${reason}`,
      );
    }

    const snapshot = action.contextSnapshot as AuthorizedContext;
    const channel: AgentChannel = isAgentChannel(
      (action.contextSnapshot as { channel?: unknown } | null)?.channel,
    )
      ? snapshot.channel
      : 'unknown';
    if (!isToolAllowedOnChannel(tool, channel)) {
      const reason = `La tool "${tool.name}" no está disponible en el canal "${channel}" del contexto original`;
      await this.expireAction(action, tool, reason);
      throw new BadRequestException(
        `La acción pendiente "${action.id}" expiró: ${reason}`,
      );
    }

    return { ...snapshot, channel };
  }

  /**
   * FIX 3 (revisión pre-F2.2): re-valida que el contexto que originó la
   * escalada SIGA vigente justo antes de ejecutar la tool en diferido —
   * crítico de cara a F2.2 (apertura física del portón): entre que el agente
   * escaló la acción y que un humano la aprueba puede pasar un rato largo, y
   * el citófono que la originó pudo haber colgado hace tiempo.
   *
   * (a) Si la acción está atada a una `ConciergeSession` (`action.sessionId`
   *     no nulo): exige que la sesión siga `SessionStatus.ACTIVE` — mismo
   *     patrón que ya usa `FinalizarLlamadaTool` (`findSessionForTenant`
   *     antes de tocar la sesión). Si la sesión terminó (`finalizar_llamada`,
   *     timeout, cancelación) o ya no pertenece al tenant de la acción
   *     (`findSessionForTenant` lanza `NotFoundException`/`ForbiddenException`),
   *     NO se ejecuta: la acción pasa a `expired` (fail-closed) y se lanza
   *     `BadRequestException` — el `catch` de `approve()` nunca ve este error
   *     (ocurre ANTES del `try` que envuelve `tool.execute`).
   *
   * (b) Tenant/permiso del contexto: investigado con CodeGraph — hoy el
   *     sistema NO tiene un concepto de "organización suspendida/inactiva"
   *     ni de revocación dinámica de scopes (ni `Family`, ni la tabla
   *     `member` de better-auth, ni ninguna otra entidad expone un flag de
   *     ese tipo). Lo único verificable con lo que existe HOY es que el
   *     tenant de la `ConciergeSession` siga siendo el mismo que el de la
   *     acción — ya cubierto por (a) vía `findSessionForTenant`. Decisión:
   *     no se fabrica un chequeo de "organización activa" inexistente; se
   *     documenta como deuda conocida (reportada en la tarea) — si en el
   *     futuro se agrega ese concepto, este es el lugar para sumarlo.
   *
   * Acciones SIN `sessionId` (p.ej. el canal de texto de `AgentController`,
   * ver docstring de `AuthorizedContext.sessionId`) no tienen una
   * `ConciergeSession` que revalidar — se dejan pasar sin este chequeo.
   */
  private async validateExecutionContext(
    action: PendingAction,
    tool: VigiliaTool<unknown, unknown>,
  ): Promise<void> {
    if (!action.sessionId) {
      return;
    }

    let session: ConciergeSession;
    try {
      session = await this.conciergeService.findSessionForTenant(
        action.sessionId,
        { tenantId: action.tenantId, isSuperAdmin: false },
      );
    } catch (error) {
      const reason = `La sesión de conserjería "${action.sessionId}" ya no es válida para esta acción: ${describeToolError(error)}`;
      await this.expireAction(action, tool, reason);
      throw new BadRequestException(
        `La acción pendiente "${action.id}" expiró: ${reason}`,
      );
    }

    if (session.status !== SessionStatus.ACTIVE) {
      const reason = `La sesión de conserjería "${action.sessionId}" ya no está activa (status="${session.status}")`;
      await this.expireAction(action, tool, reason);
      throw new BadRequestException(
        `La acción pendiente "${action.id}" expiró: ${reason}`,
      );
    }

    // Fase 4 · P4.B (cyber B1): una sesión de más de 15 min ya venció aunque
    // nadie la haya marcado TIMEOUT todavía (el timeout de la sesión es
    // perezoso: lo aplica quien la consulta).
    const sessionAgeMs = Date.now() - new Date(session.startTime).getTime();
    if (!(sessionAgeMs <= PENDING_ACTION_MAX_AGE_MS)) {
      const reason = `La sesión de conserjería "${action.sessionId}" tiene más de ${PENDING_ACTION_MAX_AGE_MS / 60_000} minutos`;
      await this.expireAction(action, tool, reason);
      throw new BadRequestException(
        `La acción pendiente "${action.id}" expiró: ${reason}`,
      );
    }
  }

  /**
   * Transiciona a `expired` (terminal, no reclamable por `approve`) y
   * notifica — usado exclusivamente por `validateExecutionContext` cuando el
   * contexto ya no es válido justo antes de ejecutar. Claim acotado a
   * `approved` porque solo se llama en ese punto del flujo (recién
   * reclamada en `approve()`).
   */
  private async expireAction(
    action: PendingAction,
    tool: VigiliaTool<unknown, unknown> | null,
    reason: string,
  ): Promise<void> {
    // Fase 4 · P7.L: terminal → input redactado; el motivo sin datos
    // personales (log y lastError).
    const safeReason = scrubPiiInText(reason);
    await this.repo.update(
      { id: action.id, status: PendingActionStatus.APPROVED },
      {
        status: PendingActionStatus.EXPIRED,
        lastError: safeReason,
        input: redactedJson(action.input),
      },
    );
    this.logger.warn(
      `Acción pendiente "${action.id}" expiró antes de ejecutar: ${safeReason}`,
    );
    await this.notifyResolution(action, tool, 'expired');
  }

  /** Rechaza — estado terminal, nunca se ejecuta la tool. */
  async reject(
    id: string,
    tenantScope: TenantScope,
    resolvedByUserId: string,
  ): Promise<PendingAction> {
    const action = await this.findForTenant(id, tenantScope);

    if (action.status === PendingActionStatus.EXECUTED) {
      throw new BadRequestException(
        `La acción pendiente "${id}" ya fue ejecutada, no se puede rechazar`,
      );
    }

    if (action.status === PendingActionStatus.EXPIRED) {
      throw new BadRequestException(
        `La acción pendiente "${id}" ya expiró, no se puede rechazar`,
      );
    }

    if (action.status === PendingActionStatus.REJECTED) {
      return action;
    }

    // `In([PENDING, APPROVED, FAILED])` en vez de `Not(EXECUTED)`: mismo
    // criterio explícito que adoptó `approve()` (FIX 1) — ahora que el enum
    // tiene más valores, listar los estados reclamables es más seguro que
    // excluir uno solo. `executed`/`expired` ya se descartaron arriba.
    await this.repo.update(
      {
        id,
        status: In([
          PendingActionStatus.PENDING,
          PendingActionStatus.APPROVED,
          PendingActionStatus.FAILED,
        ]),
      },
      {
        status: PendingActionStatus.REJECTED,
        resolvedBy: resolvedByUserId,
        resolvedAt: new Date(),
        // Fase 4 · P7.L: terminal → input redactado.
        input: redactedJson(action.input),
      },
    );

    const rejected = await this.repo.findOneOrFail({ where: { id } });
    await this.notifyResolution(rejected, null, 'rejected');
    await this.notifyVisitorLive(rejected, 'rejected', false);
    return rejected;
  }

  /**
   * Escala notificando — SOLO a los conserjes del `organizationId` de esta
   * `PendingAction` (FIX 4, revisión pre-F2.2: antes usaba
   * `notifyByRole('Conserje', ...)` sin scoping, MISMO patrón heredado que
   * `DetectionsService.createPendingDetectionForConcierge`, que sigue con el
   * gap — fuera del alcance de este bloque). Investigado con CodeGraph: ni
   * `User` ni `Role` tienen columna `organizationId` propia (`Role.name` es
   * único GLOBAL, no por tenant, y `User.family` es nulo para staff sin
   * residencia) — la única fuente de verdad de "a qué condominio pertenece
   * este usuario" es la tabla `member` de better-auth, vía
   * `resolveOrganizationIdForUser` (mismo mecanismo que ya usa
   * `TenantContextService`/`NotificationsService.create`). Por eso el fix
   * vive en `NotificationsService.notifyByRoleForOrganization` (nuevo
   * método) en vez de intentar acotar `UsersService.findByRole` con un JOIN
   * que no existe en el esquema actual.
   *
   * `requiresAction: true` reusa el flujo de notificaciones que ya soporta
   * "requiere acción" (ver notification.entity.ts).
   */
  private async notifyEscalation(
    action: PendingAction,
    tool: VigiliaTool<unknown, unknown>,
  ): Promise<void> {
    try {
      await this.notificationsService.notifyByRoleForOrganization(
        'Conserje',
        action.tenantId,
        NotificationType.SYSTEM_ALERT,
        'Acción del agente pendiente de aprobación',
        `El agente-cerebro solicita ejecutar "${tool.name}" y requiere tu aprobación.`,
        {
          priority: NotificationPriority.HIGH,
          requiresAction: true,
          data: {
            pendingActionId: action.id,
            toolName: tool.name,
            tenantId: action.tenantId,
            sessionId: action.sessionId,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `No se pudo notificar la escalada de "${tool.name}" (acción pendiente "${action.id}"): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Notifica la resolución de una acción — mismo fix de tenant-scoping (FIX
   * 4) que `notifyEscalation`, aplicado acá también por consistencia: sin
   * esto, un conserje de OTRO condominio se enteraría igual de que una
   * acción se ejecutó/falló/rechazó/expiró en un condominio ajeno.
   */
  private async notifyResolution(
    action: PendingAction,
    tool: VigiliaTool<unknown, unknown> | null,
    outcome: 'executed' | 'rejected' | 'failed' | 'expired',
  ): Promise<void> {
    const toolName = tool?.name ?? action.toolName;
    const copy: Record<typeof outcome, { title: string; message: string }> = {
      executed: {
        title: 'Acción del agente ejecutada',
        message: `Se aprobó y ejecutó "${toolName}".`,
      },
      rejected: {
        title: 'Acción del agente rechazada',
        message: `Se rechazó la solicitud de "${toolName}".`,
      },
      failed: {
        title: 'Acción del agente falló al ejecutar',
        message: `Se aprobó "${toolName}" pero falló al ejecutarse. Puede reintentarse aprobando de nuevo.`,
      },
      expired: {
        title: 'Acción del agente expiró sin ejecutarse',
        message: `"${toolName}" no se ejecutó: el contexto que la originó (la llamada de conserjería) ya no está vigente.`,
      },
    };
    const { title, message } = copy[outcome];

    try {
      await this.notificationsService.notifyByRoleForOrganization(
        'Conserje',
        action.tenantId,
        NotificationType.SYSTEM_ALERT,
        title,
        message,
        {
          priority: NotificationPriority.NORMAL,
          data: { pendingActionId: action.id, toolName },
        },
      );
    } catch (error) {
      this.logger.error(
        `No se pudo notificar la resolución de la acción pendiente "${action.id}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Avisa EN VIVO al visitante que sigue en la llamada de citófono que su
   * solicitud escalada fue resuelta — gap de UX cerrado en esta tarea: antes,
   * `notifyResolution` solo avisaba a los conserjes (notificación in-app),
   * nunca al agente de voz que sigue conversando con el visitante.
   *
   * Reusa EXACTAMENTE el mismo canal/patrón que
   * `DigitalConciergeService.respondToVisitor` (`visitor:response:<sessionId>`,
   * ver su docstring): `HubGateway.sendVisitorResponse` lo entrega SOLO al
   * dispositivo dueño de la sesión, sin caer al condominio (Fase 4 · P4, D7).
   * NO se agrega un canal nuevo: es el
   * MISMO evento que ya escucha el cliente de voz
   * (`vigilia-hub/src/services/websocket-client.service.ts`), así que Sofía
   * puede reaccionar a la respuesta sin cambios en el hub.
   *
   * Best-effort por diseño (mismo criterio que `notifyResolution`/
   * `notifyEscalation`): si la acción no tiene `sessionId` (canal de texto,
   * sin llamada en curso), si la `ConciergeSession` ya no existe/no pertenece
   * al tenant de la acción, o si ya no está `ACTIVE` (la llamada ya terminó),
   * NO emite nada y NUNCA lanza — este aviso es una mejora de UX, jamás debe
   * poder tumbar la aprobación/rechazo, que es la operación crítica.
   */
  private async notifyVisitorLive(
    action: PendingAction,
    outcome: 'approved' | 'rejected',
    accessOpened: boolean,
  ): Promise<void> {
    if (!action.sessionId) {
      return;
    }

    try {
      const session = await this.conciergeService.findSessionForTenant(
        action.sessionId,
        { tenantId: action.tenantId, isSuperAdmin: false },
      );

      if (session.status !== SessionStatus.ACTIVE) {
        return;
      }

      // Fase 4 · P4: mismo contrato que `respondToVisitor`. `approved` y
      // `entryRegistered` siempre van; `entryRegistered` es `true` solo si el
      // acceso realmente se abrió (la tool confirmó que un hub físico recibió
      // la orden), así el hub/kiosko nunca dice "pase" sin apertura.
      const approved = outcome === 'approved';
      const entryRegistered = approved && accessOpened;
      this.hubGateway.sendVisitorResponse(session, {
        approved,
        entryRegistered,
        pendingActionId: action.id,
        toolName: action.toolName,
        outcome,
        message: approved
          ? 'El residente autorizó la solicitud, procesando...'
          : 'El residente rechazó la solicitud.',
        timestamp: new Date(),
      });
    } catch (error) {
      // No terminal: la sesión pudo cerrarse entre la escalada y la
      // aprobación (`findSessionForTenant` lanza `NotFoundException`/
      // `ForbiddenException` en ese caso) — se registra y se continúa, la
      // aprobación/rechazo ya se resolvió antes de llegar acá.
      this.logger.warn(
        `No se pudo avisar en vivo al visitante de la sesión "${action.sessionId}" (acción pendiente "${action.id}"): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
