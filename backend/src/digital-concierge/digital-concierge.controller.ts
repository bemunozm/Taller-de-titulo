import { Controller, Post, Body, Param, Logger, UseGuards, Req } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  AuthorizedContextFactory,
  type AuthorizedContextRequest,
} from '../agent/authorized-context.factory';
import { buildSofiaInstructions } from '../agent/prompts/sofia.prompt';
import { buildRealtimeToolDefinitions } from '../agent/tool-definitions.util';
import { ToolDispatcherService } from '../agent/tool-dispatcher.service';
import { ToolRegistryService } from '../agent/tool-registry.service';
import type { AuthorizedContext } from '../agent/types/authorized-context.type';
import { DigitalConciergeService } from './services/digital-concierge.service';
import { StartSessionDto, StartSessionResponseDto } from './dto/start-session.dto';
import { ExecuteToolDto, ToolResultDto } from './dto/execute-tool.dto';
import { EndSessionDto, EndSessionResponseDto } from './dto/end-session.dto';
import { AgentConfigResponseDto } from './dto/agent-config.dto';
import { ConciergeAuthGuard } from './guards/concierge-auth.guard';
import { AuthenticatedHub } from '../hub/guards/hub-auth.guard';

/** `Request` de Express + los campos que los guards de transporte le agregan (mismo patrón que agent.controller.ts). */
type ConciergeRequest = Request & AuthorizedContextRequest;

/**
 * Fase 1, Bloque A1 (docs/modulos/agente-cerebro.md §7): TODAS las rutas de
 * este controller quedaban sin ningún guard — cualquiera podía abrir
 * sesiones, ejecutar tools o responder visitas. `ConciergeAuthGuard` exige
 * UNO de los dos transportes válidos (hub físico O sesión humana) — ver su
 * docstring para el detalle y el supuesto pendiente de confirmar sobre el
 * kiosko web sin login.
 *
 * Bloque A2b (docs/modulos/agente-cerebro.md §10.2 paso 4): `executeTool`
 * dejó de llamar al `switch` legacy de `DigitalConciergeService` (eliminado)
 * — ahora resuelve la tool por el catálogo (`ToolRegistryService` vía
 * `ToolDispatcherService`) y arma el `AuthorizedContext` desde
 * `request.tenantContext`/`request.hub`/`request.user` (MISMA factory que
 * usa `AgentController`, `AuthorizedContextFactory.fromRequest`), nunca
 * desde el body — regla dura #1 del §5. Se le agrega `sessionId` (del path
 * param, tampoco del body) porque las tools de este bloque operan sobre UNA
 * `ConciergeSession` — ver docstring de `AuthorizedContext.sessionId`.
 */
@Controller('concierge')
@UseGuards(ConciergeAuthGuard)
export class DigitalConciergeController {
  private readonly logger = new Logger(DigitalConciergeController.name);

  constructor(
    private readonly conciergeService: DigitalConciergeService,
    private readonly toolDispatcher: ToolDispatcherService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly authorizedContextFactory: AuthorizedContextFactory,
  ) {}

  /**
   * POST /concierge/session/start
   * Inicia una nueva sesión del conserje digital
   * Retorna el sessionId y token efímero para WebRTC
   */
  @Post('session/start')
  async startSession(
    @Body() dto: StartSessionDto,
    @Req() req: ConciergeRequest,
  ): Promise<StartSessionResponseDto> {
    this.logger.log('Starting new concierge session...');
    if (dto.socketId) {
      this.logger.log(`Socket ID recibido: ${dto.socketId}`);
    }

    // El hub (si el transporte fue HubAuthGuard) queda en request.hub; el
    // organizationId SIEMPRE viene de request.tenantContext, poblado por
    // ConciergeAuthGuard (hub) o por TenantInterceptor (sesión humana) —
    // mismo shape en ambos casos, sin lógica especial acá.
    const hub: AuthenticatedHub | undefined = req.hub;
    const organizationId: string | null = req.tenantContext?.organizationId ?? null;

    return await this.conciergeService.startSession(dto.socketId, {
      hubId: hub?.hubId ?? null,
      source: hub ? 'hub' : 'web',
      organizationId,
    });
  }

  /**
   * GET /concierge/context/:houseNumber
   * Obtiene el contexto de historial de visitas para una casa
   */
  @Post('context/:houseNumber')
  async getHouseContext(
    @Param('houseNumber') houseNumber: string,
  ): Promise<{ context: string }> {
    const contextStr = await this.conciergeService.getHouseContext(houseNumber);
    return { context: contextStr };
  }

  /**
   * POST /concierge/agent-config/:houseNumber
   * Fase 1, Bloque A2b (docs/modulos/agente-cerebro.md §10.2 paso 4): única
   * fuente de verdad del system prompt "Sofía" + las definiciones de tools
   * que un cliente-transporte Realtime necesita para configurar su sesión —
   * ver docstring de `AgentConfigResponseDto` sobre por qué va parametrizado
   * por `houseNumber` en vez de devolverse desde `session/start`. Este
   * bloque SOLO deja el backend listo para servirlo — los clientes
   * (frontend/vigilia-hub) siguen con sus copias hardcodeadas hasta el
   * bloque siguiente (§10.2 paso 6, fuera de alcance acá).
   */
  @Post('agent-config/:houseNumber')
  async getAgentConfig(
    @Param('houseNumber') houseNumber: string,
  ): Promise<AgentConfigResponseDto> {
    return {
      instructions: buildSofiaInstructions(houseNumber),
      tools: buildRealtimeToolDefinitions(this.toolRegistry.getAll()),
    };
  }

  /**
   * POST /concierge/session/:id/execute-tool
   * Ejecuta una tool del catálogo `VigiliaTool` solicitada por el agente.
   *
   * Bloque A2b: reemplaza el antiguo `switch` de
   * `DigitalConciergeService.executeTool` (eliminado) por un dispatch
   * tenant-aware y auditado a través del catálogo — ver docstring de la
   * clase. Se preserva el contrato de respuesta `{ success, data, error }`
   * que el cliente Realtime ya conoce (`ToolResultDto`): un fallo de scope,
   * de validación Zod, o de negocio se traduce a `{ success: false, error }`
   * en vez de propagar un 4xx/5xx crudo — mismo comportamiento observable
   * que tenía el `switch` legacy.
   *
   * Limpieza post-auditoría (MENOR 2): este es el canal de producción real
   * (Realtime voice vía frontend/vigilia-hub) y no tenía ningún límite de
   * tasa, a diferencia de `/concierge/agent/chat` — throttler dedicado
   * 'concierge-execute-tool' (registrado en auth.module.ts junto a
   * 'concierge-agent-chat'/'login'; `ThrottlerModule` es `@Global()`).
   */
  @Post('session/:sessionId/execute-tool')
  @UseGuards(ThrottlerGuard)
  @Throttle({ 'concierge-execute-tool': { limit: 60, ttl: 60_000 } })
  async executeTool(
    @Param('sessionId') sessionId: string,
    @Body() dto: ExecuteToolDto,
    @Req() req: ConciergeRequest,
  ): Promise<ToolResultDto> {
    this.logger.debug(`Executing tool: ${dto.toolName} for session: ${sessionId}`);

    const ctx: AuthorizedContext = {
      ...this.authorizedContextFactory.fromRequest(req),
      sessionId,
    };

    try {
      const tool = this.toolDispatcher.resolve(dto.toolName);
      const data = await this.toolDispatcher.execute(tool, ctx, dto.parameters);
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tool execution failed: ${message}`, error instanceof Error ? error.stack : undefined);
      return { success: false, error: message };
    }
  }

  /**
   * POST /concierge/session/:id/end
   * Finaliza la sesión del conserje digital
   *
   * Fix consistencia de aislamiento tenant (revisión de calidad post
   * Bloque A2b): a diferencia de `executeTool`, este endpoint resolvía la
   * sesión solo por `sessionId` — un hub/usuario autenticado del condominio A
   * podía finalizar la sesión de otro condominio con solo conocer/adivinar su
   * id. Se valida acá, con `findSessionForTenant` (misma fuente de verdad que
   * usan las tools vía `AuthorizedContextFactory`), ANTES de invocar el
   * servicio — si no matchea lanza `ForbiddenException` y no llega a mutar
   * nada.
   */
  @Post('session/:sessionId/end')
  async endSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: EndSessionDto,
    @Req() req: ConciergeRequest,
  ): Promise<EndSessionResponseDto> {
    this.logger.log(`Ending session: ${sessionId}`);

    const ctx = this.authorizedContextFactory.fromRequest(req);
    await this.conciergeService.findSessionForTenant(sessionId, ctx);

    return await this.conciergeService.endSession(
      sessionId,
      dto.finalStatus,
    );
  }

  /**
   * GET /concierge/session/:id/status
   * Verificar si una sesión está activa y puede recibir respuestas
   *
   * Fix consistencia de aislamiento tenant (ver docstring de `endSession`):
   * misma validación de tenant antes de exponer el estado de una sesión que
   * podría pertenecer a otro condominio.
   */
  @Post('session/:sessionId/status')
  async getSessionStatus(
    @Param('sessionId') sessionId: string,
    @Req() req: ConciergeRequest,
  ): Promise<{ active: boolean; reason?: string }> {
    const ctx = this.authorizedContextFactory.fromRequest(req);
    await this.conciergeService.findSessionForTenant(sessionId, ctx);

    return await this.conciergeService.isSessionActive(sessionId);
  }

  /**
   * POST /concierge/session/:id/respond
   * Responde a una solicitud de visita (aprobación o rechazo del residente)
   *
   * Fix consistencia de aislamiento tenant (ver docstring de `endSession`):
   * la validación de tenant se hace ANTES de cualquier efecto — este endpoint
   * dispara la apertura física del portón cuando `approved === true`
   * (`DigitalConciergeService.respondToVisitor` -> `notifyHub('hub:door_open', ...)`),
   * así que se rechaza el cross-tenant antes de tocar la sesión o el hub.
   */
  @Post('session/:sessionId/respond')
  async respondToVisitor(
    @Param('sessionId') sessionId: string,
    @Body() body: { approved: boolean; residentId?: string },
    @Req() req: ConciergeRequest,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Responding to visitor for session: ${sessionId}, approved: ${body.approved}, residentId: ${body.residentId}`);

    const ctx = this.authorizedContextFactory.fromRequest(req);
    await this.conciergeService.findSessionForTenant(sessionId, ctx);

    return await this.conciergeService.respondToVisitor(
      sessionId,
      body.approved,
      body.residentId,
    );
  }
}
