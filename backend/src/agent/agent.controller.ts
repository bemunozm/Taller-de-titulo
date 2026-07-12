import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { ModelMessage } from 'ai';
import { ConciergeAuthGuard } from '../digital-concierge/guards/concierge-auth.guard';
import { AgentRunnerService } from './agent-runner.service';
import {
  AuthorizedContextFactory,
  type AuthorizedContextRequest,
} from './authorized-context.factory';
import { AgentChatRequestDto } from './dto/agent-chat.dto';

/** `Request` de Express + los campos que los guards de transporte le agregan. */
type ConciergeRequest = Request & AuthorizedContextRequest;

/**
 * Endpoint de conversación por TEXTO del agente-cerebro (Fase 1, Bloque A2a
 * — docs/modulos/agente-cerebro.md §4/§8/§10.2 paso 1: "canal verificable por
 * texto, sin depender de la voz Realtime todavía"). Mismo guard de
 * transporte que el resto de `/concierge/*` (`ConciergeAuthGuard`: hub físico
 * O sesión humana) — el `AuthorizedContext` se arma DESPUÉS del guard, a
 * partir de `request.tenantContext`/`request.hub`/`request.user`, nunca del
 * body.
 *
 * Streaming: se usa `pipeTextStreamToResponse` (helper nativo del AI SDK)
 * para no tener que manejar manualmente backpressure/chunks sobre el
 * `Response` de Express — ver node_modules/ai/dist/index.d.ts
 * (`StreamTextResult.pipeTextStreamToResponse`).
 */
@Controller('concierge/agent')
@UseGuards(ConciergeAuthGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly runner: AgentRunnerService,
    private readonly contextFactory: AuthorizedContextFactory,
  ) {}

  /**
   * POST /api/v1/concierge/agent/chat
   * Body: { houseNumber, messages: [{role, content}, ...] }
   * Streaming de texto plano (una línea de conversación por request; el
   * cliente reenvía el historial completo en `messages`).
   *
   * Revisión de calidad (FIX 3): throttler dedicado 'concierge-agent-chat'
   * (registrado en auth.module.ts junto a 'login' — `ThrottlerModule` es
   * `@Global()`, no hace falta reimportarlo acá) — cada mensaje reenvía al
   * proveedor del modelo (costo por token) y antes no tenía ningún límite de
   * tasa. El tamaño del payload se acota en el DTO
   * (`@ArrayMaxSize`/`@MaxLength`, ver dto/agent-chat.dto.ts).
   */
  @Post('chat')
  @UseGuards(ThrottlerGuard)
  @Throttle({ 'concierge-agent-chat': { limit: 20, ttl: 60_000 } })
  async chat(
    @Body() dto: AgentChatRequestDto,
    @Req() req: ConciergeRequest,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = this.contextFactory.fromRequest(req);

    this.logger.debug(
      `agent chat [requestId=${ctx.requestId}] tenantId=${ctx.tenantId ?? 'null'} role=${ctx.role} houseNumber=${dto.houseNumber}`,
    );

    const messages: ModelMessage[] = dto.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const result = await this.runner.streamChat({
      houseNumber: dto.houseNumber,
      messages,
      ctx,
    });

    result.pipeTextStreamToResponse(res);
  }
}
