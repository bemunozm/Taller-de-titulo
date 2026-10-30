import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

/** Tiempo máximo de una llamada a Vision; pasado esto se aborta (aiStatus 'failed'). */
export const VISION_TIMEOUT_MS = 20_000;

export type SuspicionLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AnomalyAnalysis {
  suspicionLevel: SuspicionLevel;
  reasoning: string;
  /** Veredicto de la IA: `true` si cree que el evento es una falsa alarma. */
  isFalsePositive: boolean;
}

const SUSPICION_LEVELS: readonly string[] = ['HIGH', 'MEDIUM', 'LOW'];

/** JSON de la respuesta del modelo como objeto; cualquier otra cosa lanza. */
function parseVisionJson(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('La respuesta de Vision no es un objeto JSON');
  }
  return parsed as Record<string, unknown>;
}

/**
 * Bloque A3 (docs/modulos/agente-cerebro.md): extraído de `OpenAITokenService`
 * (antes en `digital-concierge/services/`) para separar la responsabilidad de
 * Vision (análisis de anomalías con GPT-4o) de la de voz Realtime (WebRTC,
 * ver `RealtimeVoiceTokenService`). Único caller: `AnomaliesService`.
 *
 * Guardián Fase 1: el cliente se crea de forma perezosa (la falta de
 * `OPENAI_API_KEY` ya no tumba el módulo; `isAvailable()` lo informa y la
 * anomalía queda con aiStatus 'skipped'), la llamada tiene timeout y los
 * errores se PROPAGAN para que el llamador marque aiStatus 'failed' (antes se
 * tragaban y devolvían un MEDIUM inventado).
 */
@Injectable()
export class VisionAnalysisService {
  private readonly logger = new Logger(VisionAnalysisService.name);
  private client: OpenAI | null = null;

  /** ¿Hay credencial para analizar? Barato: no crea el cliente. */
  isAvailable(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  private getClient(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY no está configurada');
    }
    this.client ??= new OpenAI({
      apiKey,
      timeout: VISION_TIMEOUT_MS,
      // Sin reintentos: un reintento duplicaría la espera máxima; el fallo se
      // refleja en aiStatus y el revisor evalúa a mano.
      maxRetries: 0,
    });
    return this.client;
  }

  /**
   * Analiza una anomalía visual usando GPT-4o (Vision)
   * Espera un base64 de la foto (idealmente pequeña)
   */
  async analyzeAnomaly(
    snapshotB64: string,
    anomalyType: string,
  ): Promise<AnomalyAnalysis> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    try {
      this.logger.debug(
        `Iniciando análisis Vision de anomalía tipo: ${anomalyType} [${correlationId}]`,
      );

      const response = await this.getClient().chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Eres el evaluador de seguridad de élite de un condominio inteligente. El sistema de Edge AI (YOLO) ha detectado un evento catalogado preliminarmente como: "${anomalyType}".

Tu misión es realizar una inspección forense visual y devolver un JSON con:
1. "suspicionLevel": (HIGH, MEDIUM, LOW).
2. "visualSummary": Una descripción técnica de lo que ves (ej: "Sujeto con sudadera roja y bolso negro saltando muro perimetral").
3. "reasoning": Tu veredicto de seguridad basado en la actitud, objetos en las manos y ubicación.
4. "isFalsePositive": boolean.

Criterios de Riesgo:
- HIGH: Escalando muros/cercas, portando herramientas/armas, rostro cubierto (máscaras/pasamontañas), forzando cerraduras, correr huyendo.
- MEDIUM: Merodeo persistente, observar hacia adentro de casas/autos, actitud de espera nerviosa, vestimenta no acorde al clima/lugar.
- LOW: Personal de mantenimiento con uniforme, residentes paseando mascotas, niños, animales, sombras/ramas moviéndose (falsos positivos).`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analiza la imagen adjunta y devuelve el JSON.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${snapshotB64}`,
                  detail: 'low', // detail low para ahorrar tokens y acelerar la respuesta
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.1, // Baja temperatura para mayor consistencia
      });

      const responseTime = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '{}';
      const parsed = parseVisionJson(content);

      const rawLevel =
        typeof parsed.suspicionLevel === 'string'
          ? parsed.suspicionLevel.toUpperCase()
          : '';
      const suspicionLevel: SuspicionLevel = SUSPICION_LEVELS.includes(rawLevel)
        ? (rawLevel as SuspicionLevel)
        : 'MEDIUM';

      // Combinamos el resumen visual con el razonamiento para una respuesta rica en información
      const visualSummary =
        typeof parsed.visualSummary === 'string' && parsed.visualSummary
          ? parsed.visualSummary
          : 'Análisis de imagen realizado.';
      const reasoning =
        typeof parsed.reasoning === 'string' && parsed.reasoning
          ? parsed.reasoning
          : 'Determinación basada en contexto visual.';
      const finalReasoning = `[IA ve: ${visualSummary}] - ${reasoning}`;
      const isFalsePositive = parsed.isFalsePositive === true;

      this.logger.log(
        `Análisis Vision completado [${correlationId}]: Nivel ${suspicionLevel}, falso positivo: ${isFalsePositive}, ${responseTime}ms`,
      );

      return { suspicionLevel, reasoning: finalReasoning, isFalsePositive };
    } catch (error) {
      this.logger.error(
        `Falló el análisis Vision de la anomalía [${correlationId}]: ${error instanceof Error ? error.message : String(error)}`,
      );
      // El llamador marca aiStatus 'failed'; no se inventa un veredicto.
      throw error;
    }
  }

  /**
   * Valida que la API key funcione
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.getClient().models.list();
      return true;
    } catch (error) {
      this.logger.error(
        `API key de OpenAI inválida: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
