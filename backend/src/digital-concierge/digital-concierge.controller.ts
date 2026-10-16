import {
  Controller,
  ForbiddenException,
  Post,
  Body,
  Param,
  Logger,
  UseGuards,
  Req,
} from '@nestjs/common';
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
import { ABRIR_ACCESO_TOOL_NAME } from '../agent/tools/abrir-acceso.tool';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator';
import { HouseNumberParamDto } from '../common/validation/house-number';
import { DigitalConciergeService } from './services/digital-concierge.service';
import type { HouseContext } from './house-context';
import {
  StartSessionDto,
  StartSessionResponseDto,
} from './dto/start-session.dto';
import { ExecuteToolDto, ToolResultDto } from './dto/execute-tool.dto';
import { EndSessionDto, EndSessionResponseDto } from './dto/end-session.dto';
import type { AgentConfigResponseDto } from './dto/agent-config.dto';
import { SessionStatusResponseDto } from './dto/session-status.dto';
import { ConciergeAuthGuard } from './guards/concierge-auth.guard';
import { ExecuteToolPermissionGuard } from './guards/execute-tool-permission.guard';
import { scrubPiiInText } from '../common/privacy/pii-mask';
import { AuthenticatedHub } from '../hub/guards/hub-auth.guard';
import {
  canReadHouseContext,
  type ConciergeActor,
  toDeviceConciergeActor,
  toHumanConciergeActor,
} from './concierge-actor';

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
  @RateLimit('concierge-session-start')
  async startSession(
    @Body() dto: StartSessionDto,
    @Req() req: ConciergeRequest,
  ): Promise<StartSessionResponseDto> {
    this.logger.log('Starting new concierge session...');
    if (dto.socketId) {
      this.logger.log(`Socket ID recibido: ${dto.socketId}`);
    }

    // Corrección P5 (cyber B5): solo un DISPOSITIVO (hub físico o kiosko, que
    // se autentican con su credencial de hub) inicia sesiones del conserje.
    // Un humano con sesión -> 403: la UI humana no usa esta ruta (el kiosko
    // web manda su credencial de dispositivo, ver ConciergeAPI.startSession).
    const hub: AuthenticatedHub | undefined = req.hub;
    if (!hub) {
      throw new ForbiddenException(
        'Solo un dispositivo del condominio (hub o kiosko) puede iniciar una sesión del conserje digital',
      );
    }
    // El organizationId SIEMPRE viene de request.tenantContext, que el guard
    // del hub pobló con el condominio del dispositivo.
    const organizationId: string | null =
      req.tenantContext?.organizationId ?? null;

    return await this.conciergeService.startSession(dto.socketId, {
      hubId: hub.hubId,
      source: 'hub',
      organizationId,
    });
  }

  /**
   * POST /concierge/context/:houseNumber
   * Contexto de la casa para el conserje de voz: `{ expectedVisitorsCount }`.
   *
   * Fase 4 · P4.B (cyber M4): solo el hub físico (vigilia-hub) y los humanos
   * con `digital-concierge.manage`; el kiosko web, un residente u otro
   * humano sin `manage` reciben 403. `houseNumber` validado (cyber B8, ver
   * common/validation/house-number.ts).
   *
   * Fase 4 · P6.M: la respuesta dejó de ser un string libre
   * (`{ context: string }`) y pasó a datos estructurados. Corrección P7
   * (cyber B8, decisión de Nova): sin nombres. `expectedVisitorsCount` es la
   * cantidad de visitas pre-aprobadas vigentes (ver house-context.ts). El
   * único consumidor es vigilia-hub, que lo inyecta como un mensaje `user`
   * delimitado y marcado como datos (nunca como instrucción de sistema).
   * Contrato nuevo: el hub y el backend se despliegan juntos.
   *
   * Fase 4 · P6.R: la casa se resuelve por código exacto o, si no hay, por
   * número de unidad único en el condominio (`FamiliesService.resolveHouse`,
   * nunca búsqueda difusa). Una casa ambigua o inexistente devuelve
   * `expectedVisitorsCount: 0`.
   */
  @Post('context/:houseNumber')
  @RateLimit('concierge-session')
  async getHouseContext(
    @Param() { houseNumber }: HouseNumberParamDto,
    @Req() req: ConciergeRequest,
  ): Promise<HouseContext> {
    const ctx = this.authorizedContextFactory.fromRequest(req);
    if (!canReadHouseContext(ctx)) {
      throw new ForbiddenException(
        'No estás autorizado para consultar el historial de visitas de la casa',
      );
    }
    return this.conciergeService.getHouseContext(houseNumber);
  }

  /**
   * POST /concierge/agent-config/:houseNumber
   * Fase 1, Bloque A2b (docs/modulos/agente-cerebro.md §10.2 paso 4): única
   * fuente de verdad del system prompt "Sofía" + las definiciones de tools
   * que un cliente-transporte Realtime necesita para configurar su sesión —
   * ver docstring de `AgentConfigResponseDto` sobre por qué va parametrizado
   * por `houseNumber` en vez de devolverse desde `session/start`. Los
   * clientes (kiosko web y vigilia-hub) ya no tienen copias propias: piden
   * esta configuración al iniciar cada llamada.
   *
   * Fase 4 · P4.B (D8): las tools (y el prompt) se filtran por el canal y
   * los scopes de la request (`ToolRegistryService.getAvailableFor`): el
   * kiosko web no ve `abrir_acceso` ni las `consultar_*`. El dispatcher
   * sigue negando la ejecución aunque un cliente las pida igual.
   * `houseNumber` validado (cyber B8): el prompt lo interpola.
   */
  @Post('agent-config/:houseNumber')
  @RateLimit('concierge-session')
  getAgentConfig(
    @Param() { houseNumber }: HouseNumberParamDto,
    @Req() req: ConciergeRequest,
  ): AgentConfigResponseDto {
    const ctx = this.authorizedContextFactory.fromRequest(req);
    const tools = this.toolRegistry.getAvailableFor(ctx);

    return {
      instructions: buildSofiaInstructions(houseNumber, {
        accessOpening: tools.some(
          (tool) => tool.name === ABRIR_ACCESO_TOOL_NAME,
        ),
      }),
      tools: buildRealtimeToolDefinitions(tools),
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
   * Rate limit (Fase 4 · P4.B, D9): política `concierge-execute-tool`
   * (60/min por hub o usuario). Una llamada de citófono dispara varias tools.
   *
   * Corrección P7 (cyber A1): una sesión humana necesita
   * `digital-concierge.access` (403 antes de validar el body;
   * `ExecuteToolPermissionGuard`, que corre antes del throttler, como el
   * resto de los guards de método) y `parameters` no puede pasar de 8 KB ni
   * de 4 niveles (400 del `ValidationPipe`, ver `ExecuteToolDto`). Los
   * dispositivos siguen entrando con su credencial.
   */
  @Post('session/:sessionId/execute-tool')
  @RateLimit('concierge-execute-tool')
  @UseGuards(ExecuteToolPermissionGuard)
  async executeTool(
    @Param('sessionId') sessionId: string,
    @Body() dto: ExecuteToolDto,
    @Req() req: ConciergeRequest,
  ): Promise<ToolResultDto> {
    this.logger.debug(
      `Executing tool: ${dto.toolName} for session: ${sessionId}`,
    );

    // Fase 4 · P4: un dispositivo solo opera SU sesión (403 si es de otro hub
    // o kiosko, aunque sea del mismo condominio). Fuera del try: es un error
    // de autorización, no un resultado de la tool.
    if (req.hub) {
      await this.conciergeService.findSessionForDevice(
        sessionId,
        toDeviceConciergeActor(req.hub),
      );
    }

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
      // Corrección P7: el log solo lleva el mensaje recortado y enmascarado
      // (un error de Zod repite las claves del input recibido).
      this.logger.error(
        `Tool execution failed (${dto.toolName}): ${scrubPiiInText(message)}`,
      );
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
   *
   * Fase 4 · P4: un dispositivo solo finaliza SU sesión
   * (`findSessionForDevice`); el camino humano no cambia.
   */
  @Post('session/:sessionId/end')
  @RateLimit('concierge-session')
  async endSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: EndSessionDto,
    @Req() req: ConciergeRequest,
  ): Promise<EndSessionResponseDto> {
    this.logger.log(`Ending session: ${sessionId}`);

    if (req.hub) {
      await this.conciergeService.findSessionForDevice(
        sessionId,
        toDeviceConciergeActor(req.hub),
      );
    } else {
      const ctx = this.authorizedContextFactory.fromRequest(req);
      await this.conciergeService.findSessionForTenant(sessionId, ctx);
    }

    return await this.conciergeService.endSession(sessionId, dto.finalStatus);
  }

  /**
   * POST /concierge/session/:id/status
   * Estado de la sesión: si sigue activa y, con su solicitud, la respuesta
   * del residente y si el ingreso quedó registrado (respaldo por polling del
   * kiosko — Fase 4 · P4).
   *
   * Autoriza solo al dispositivo dueño de la sesión (`req.hub.hubId ===
   * session.hubId` y el hub sigue en el condominio de la sesión), a los
   * residentes notificados y a quien tiene
   * `digital-concierge.manage` en el condominio (ver
   * `DigitalConciergeService.getSessionStatus`); si no → 403. Antes bastaba
   * con ser del mismo condominio: cualquier hub o kiosko del condominio leía
   * la respuesta de una sesión ajena.
   *
   * `POST /concierge/session/:id/respond` ya no vive acá: es solo humano
   * (`ConciergeResponseController`, con `AuthGuard`).
   */
  @Post('session/:sessionId/status')
  @RateLimit('concierge-status')
  async getSessionStatus(
    @Param('sessionId') sessionId: string,
    @Req() req: ConciergeRequest,
  ): Promise<SessionStatusResponseDto> {
    const actor: ConciergeActor = req.hub
      ? toDeviceConciergeActor(req.hub)
      : toHumanConciergeActor(this.authorizedContextFactory.fromRequest(req));

    return await this.conciergeService.getSessionStatus(sessionId, actor);
  }
}
