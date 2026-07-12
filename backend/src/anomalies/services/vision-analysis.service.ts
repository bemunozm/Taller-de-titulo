import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

/**
 * Bloque A3 (docs/modulos/agente-cerebro.md): extraído de `OpenAITokenService`
 * (antes en `digital-concierge/services/`) para separar la responsabilidad de
 * Vision (análisis de anomalías con GPT-4o) de la de voz Realtime (WebRTC,
 * ver `RealtimeVoiceTokenService`). Único caller: `AnomaliesService.createAnomaly`.
 */
@Injectable()
export class VisionAnalysisService {
  private readonly logger = new Logger(VisionAnalysisService.name);
  private readonly openai: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    this.openai = new OpenAI({ apiKey });
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
