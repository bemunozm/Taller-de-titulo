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

      // CRITICO: Usar endpoint específico para generar tokens de WebSocket (GA)
      // Reference: "If you want to use the Realtime GA API, please create a client secret using the /v1/realtime/client_secrets endpoint."
      // NOTA: Este endpoint es sensible con los parámetros. Volvemos a body vacío para asegurar token.
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}), // Restauramos body vacío para recuperar la conexión
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
      this.logger.debug(`Core data received from OpenAI: ${JSON.stringify(data, null, 2)}`);

      // Extraer token de la respuesta estándar (client_secret wrapper) o simplificada
      const token = data.client_secret?.value || data.value;

      if (!token) {
        throw new Error(`No client_secret received from OpenAI. Got: ${JSON.stringify(data)}`);
      }

      // El token expira en 60 segundos (para conectar) pero la sesión dura más
      const expirySeconds = data.client_secret?.expires_at || data.expires_at || (Date.now() / 1000 + 60);
      const expiresAt = new Date(expirySeconds * 1000);

      this.logger.debug(`Ephemeral token generated. Expires at: ${expiresAt.toISOString()} [${correlationId}]`);
      this.logger.debug(`Token prefix: ${token.substring(0, 10)}...`);

      // Log de éxito
      await this.logsService.log({
        level: LogLevel.INFO,
        message: 'OpenAI ephemeral token generated successfully',
        type: LogType.OPENAI_API,
        service: ServiceName.OPENAI,
        metadata: { 
          model: 'gpt-realtime-mini-2025-12-15',
          expiresAt: expiresAt.toISOString(),
          responseTime,
        },
        correlationId,
      });

      return {
        token,
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
