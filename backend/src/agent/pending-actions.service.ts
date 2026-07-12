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

/** Forma mínima que necesita `findForTenant` — igual criterio que `TenantScope` en digital-concierge.service.ts. */
export interface TenantScope {
  tenantId: string | null;
  isSuperAdmin: boolean;
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
      input,
      requestId: ctx.requestId,
      status: PendingActionStatus.PENDING,
      contextSnapshot: ctx,
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

    if (!tenantScope.isSuperAdmin && action.tenantId !== tenantScope.tenantId) {
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
    await this.validateExecutionContext(action, tool);

    const replayCtx = action.contextSnapshot as AuthorizedContext;
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
          result: output as Record<string, unknown>,
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

      const errorMessage = describeToolError(error);
      this.logger.error(
        `Fallo al ejecutar la tool "${tool.name}" tras aprobación (acción pendiente "${id}"): ${errorMessage}`,
      );

      // FIX 2: NO dejar la fila varada en `approved` — transiciona a `failed`
      // (reclamable por un reintento vía `approve()`, ver docstring arriba).
      // Claim acotado a `approved` porque es el único estado desde el que
      // este catch puede correr (lo acabamos de reclamar más arriba).
      await this.repo.update(
        { id, status: PendingActionStatus.APPROVED },
        { status: PendingActionStatus.FAILED, lastError: errorMessage },
      );
      await this.notifyResolution(action, tool, 'failed');

      throw error;
    }
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
    await this.repo.update(
      { id: action.id, status: PendingActionStatus.APPROVED },
      { status: PendingActionStatus.EXPIRED, lastError: reason },
    );
    this.logger.warn(
      `Acción pendiente "${action.id}" expiró antes de ejecutar: ${reason}`,
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
      },
    );

    const rejected = await this.repo.findOneOrFail({ where: { id } });
    await this.notifyResolution(rejected, null, 'rejected');
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
}
