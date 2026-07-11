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
   * Analiza una anomalía visual usando GPT-4o (Vision)
   * Espera un base64 de la foto (idealmente pequeña)
   */
  async analyzeAnomaly(snapshotB64: string, anomalyType: string): Promise<{ suspicionLevel: 'HIGH' | 'MEDIUM' | 'LOW'; reasoning: string }> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    try {
      this.logger.debug(`Iniciando análisis Vision de anomalía tipo: ${anomalyType} [${correlationId}]`);
      
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Eres el evaluador de seguridad de élite de un condominio inteligente. El sistema de Edge AI (YOLO) ha detectado un evento catalogado preliminarmente como: "${anomalyType}". 

Tu misión es realizar una inspección forense visual y devolver un JSON con:
1. "suspicionLevel": (HIGH, MEDIUM, LOW).
2. "visualSummary": Una descripción técnica de lo que ves (ej: "Sujeto con sudadera roja y bolso negro saltando muro perimetral").
3. "reasoning": Tu veredicto de seguridad basado en la actitud, objetos en las manos y ubicación.
4. "isFalsePositive": boolean.

Criterios de Riesgo:
- HIGH: Escalando muros/cercas, portando herramientas/armas, rostro cubierto (máscaras/pasamontañas), forzando cerraduras, correr huyendo.
- MEDIUM: Merodeo persistente, observar hacia adentro de casas/autos, actitud de espera nerviosa, vestimenta no acorde al clima/lugar.
- LOW: Personal de mantenimiento con uniforme, residentes paseando mascotas, niños, animales, sombras/ramas moviéndose (falsos positivos).`
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analiza la imagen adjunta y devuelve el JSON."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${snapshotB64}`,
                  detail: "low" // detail low para ahorrar tokens y acelerar la respuesta
                }
              }
            ]
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 150,
        temperature: 0.1, // Baja temperatura para mayor consistencia
      });

      const responseTime = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      
      const suspicionLevel = parsed.suspicionLevel && ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.suspicionLevel.toUpperCase()) ? parsed.suspicionLevel.toUpperCase() : 'MEDIUM';
      
      // Combinamos el resumen visual con el razonamiento para una respuesta rica en información
      const visualSummary = parsed.visualSummary || 'Análisis de imagen realizado.';
      const reasoning = parsed.reasoning || 'Determinación basada en contexto visual.';
      const finalReasoning = `[IA ve: ${visualSummary}] - ${reasoning}`;

      this.logger.log(`Análisis Vision completado [${correlationId}]: Nivel ${suspicionLevel} en ${responseTime}ms`);
      
      return { suspicionLevel: suspicionLevel as 'HIGH' | 'MEDIUM' | 'LOW', reasoning: finalReasoning };
      
    } catch (error) {
      this.logger.error(`Falló el análisis Vision de la anomalía [${correlationId}]: ${error.message}`);
      // Fallback a MEDIUM en caso de falla de la API
      return { suspicionLevel: 'MEDIUM', reasoning: 'Error al contactar a la IA. Evaluar manualmente.' };
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
