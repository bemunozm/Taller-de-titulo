import { Controller, Post, Body, Param, Logger } from '@nestjs/common';
import { DigitalConciergeService } from './services/digital-concierge.service';
import { StartSessionDto, StartSessionResponseDto } from './dto/start-session.dto';
import { ExecuteToolDto, ToolResultDto } from './dto/execute-tool.dto';
import { EndSessionDto, EndSessionResponseDto } from './dto/end-session.dto';

@Controller('concierge')
export class DigitalConciergeController {
  private readonly logger = new Logger(DigitalConciergeController.name);

  constructor(private readonly conciergeService: DigitalConciergeService) {}

  /**
   * POST /concierge/session/start
   * Inicia una nueva sesión del conserje digital
   * Retorna el sessionId y token efímero para WebRTC
   */
  @Post('session/start')
  async startSession(
    @Body() dto: StartSessionDto,
  ): Promise<StartSessionResponseDto> {
    this.logger.log('Starting new concierge session...');
    if (dto.socketId) {
      this.logger.log(`Socket ID recibido: ${dto.socketId}`);
    }
    return await this.conciergeService.startSession(dto.socketId);
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
   * POST /concierge/session/:id/execute-tool
   * Ejecuta una función/herramienta solicitada por OpenAI
   * OpenAI envía la llamada a función, este endpoint la ejecuta y retorna el resultado
   */
  @Post('session/:sessionId/execute-tool')
  async executeTool(
    @Param('sessionId') sessionId: string,
    @Body() dto: ExecuteToolDto,
  ): Promise<ToolResultDto> {
    this.logger.debug(`Executing tool: ${dto.toolName} for session: ${sessionId}`);
    
    return await this.conciergeService.executeTool(
      sessionId,
      dto.toolName,
      dto.parameters,
    );
  }

  /**
   * POST /concierge/session/:id/end
   * Finaliza la sesión del conserje digital
   */
  @Post('session/:sessionId/end')
  async endSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: EndSessionDto,
  ): Promise<EndSessionResponseDto> {
    this.logger.log(`Ending session: ${sessionId}`);
    
    return await this.conciergeService.endSession(
      sessionId,
      dto.finalStatus,
    );
  }

  /**
   * GET /concierge/session/:id/status
   * Verificar si una sesión está activa y puede recibir respuestas
   */
  @Post('session/:sessionId/status')
  async getSessionStatus(
    @Param('sessionId') sessionId: string,
  ): Promise<{ active: boolean; reason?: string }> {
    return await this.conciergeService.isSessionActive(sessionId);
  }

  /**
   * POST /concierge/session/:id/respond
   * Responde a una solicitud de visita (aprobación o rechazo del residente)
   */
  @Post('session/:sessionId/respond')
  async respondToVisitor(
    @Param('sessionId') sessionId: string,
    @Body() body: { approved: boolean; residentId?: string },
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Responding to visitor for session: ${sessionId}, approved: ${body.approved}, residentId: ${body.residentId}`);
    
    return await this.conciergeService.respondToVisitor(
      sessionId,
      body.approved,
      body.residentId,
    );
  }
}
