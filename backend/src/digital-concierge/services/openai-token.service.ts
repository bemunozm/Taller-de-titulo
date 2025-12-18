import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { LogsService } from '../../logs/logs.service';
import { LogLevel, LogType, ServiceName } from '../../logs/entities/system-log.entity';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OpenAITokenService {
  private readonly logger = new Logger(OpenAITokenService.name);
  private readonly openai: OpenAI;

  constructor(private readonly logsService: LogsService) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    this.openai = new OpenAI({ apiKey });
  }

  /**
   * Genera un token efímero de 15 minutos para WebRTC
   * Este token permite que el frontend se conecte directamente a OpenAI Realtime API
   */
  async generateEphemeralToken(): Promise<{ token: string; expiresAt: Date }> {
    const correlationId = uuidv4();
    const startTime = Date.now();
    
    try {
      this.logger.debug(`Generating ephemeral token for OpenAI Realtime API... [${correlationId}]`);

      // IMPORTANTE: Usar el endpoint GA /v1/realtime/client_secrets
      // NO usar openai.beta.realtime.sessions.create() que es para la API Beta
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: 'gpt-realtime-mini', // Modelo GA mini - más económico
            audio: {
              output: {
                voice: 'sage', // Voz femenina clara
              },
            },
            // No especificar modalities aquí - el frontend lo configura
          },
        }),
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(`OpenAI API Error Response: ${errorData} [${correlationId}]`);
        
        // Log de error
        await this.logsService.log({
          level: LogLevel.ERROR,
          message: 'Failed to generate OpenAI ephemeral token',
          type: LogType.OPENAI_API,
          service: ServiceName.OPENAI,
          metadata: { status: response.status, responseTime, error: errorData },
          correlationId,
        });
        
        throw new Error(`OpenAI API returned ${response.status}: ${errorData}`);
      }

      const data = await response.json();

      // El token expira en 15 minutos
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      this.logger.debug(`Ephemeral token generated. Expires at: ${expiresAt.toISOString()} [${correlationId}]`);
      this.logger.debug(`Token prefix: ${data.value.substring(0, 10)}...`);

      // Log de éxito
      await this.logsService.log({
        level: LogLevel.INFO,
        message: 'OpenAI ephemeral token generated successfully',
        type: LogType.OPENAI_API,
        service: ServiceName.OPENAI,
        metadata: { 
          model: 'gpt-realtime-mini',
          expiresAt: expiresAt.toISOString(),
          responseTime,
        },
        correlationId,
      });

      return {
        token: data.value, // El token viene en el campo "value"
        expiresAt,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      this.logger.error(`Error generating ephemeral token: ${error} [${correlationId}]`);
      if (error.response) {
        this.logger.error(`OpenAI API Error: ${JSON.stringify(error.response.data)}`);
      }
      
      // Log de error general
      await this.logsService.log({
        level: LogLevel.ERROR,
        message: 'Exception while generating OpenAI ephemeral token',
        type: LogType.OPENAI_API,
        service: ServiceName.OPENAI,
        metadata: { responseTime, error: error?.message || String(error) },
        correlationId,
      });
      
      throw new Error('Failed to generate OpenAI ephemeral token');
    }
  }

  /**
   * Valida que la API key funcione
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.openai.models.list();
      return true;
    } catch (error) {
      this.logger.error('Invalid OpenAI API key:', error);
      return false;
    }
  }
}
