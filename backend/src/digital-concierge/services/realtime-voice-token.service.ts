import { Injectable, Logger } from '@nestjs/common';
import { LogsService } from '../../logs/logs.service';
import {
  LogLevel,
  LogType,
  ServiceName,
} from '../../logs/entities/system-log.entity';
import { v4 as uuidv4 } from 'uuid';
import { errorMessage } from '../../common/utils/error-message.util';
import { parseOpenAiApiBaseUrl } from '../../config/env.validation';

/** Ruta del endpoint de client secrets de Realtime (GA), bajo la base de la API. */
export const REALTIME_CLIENT_SECRETS_PATH = '/v1/realtime/client_secrets';

/**
 * Bloque A3 (docs/modulos/agente-cerebro.md): extraído de `OpenAITokenService`
 * para separar la responsabilidad de voz Realtime (WebRTC) de la de Vision
 * (análisis de anomalías, ver `VisionAnalysisService` en el módulo de
 * anomalías). Único caller: `DigitalConciergeService`.
 */
@Injectable()
export class RealtimeVoiceTokenService {
  private readonly logger = new Logger(RealtimeVoiceTokenService.name);
  /**
   * URL del endpoint de client secrets (Fase 4 · P8): base configurable con
   * `OPENAI_API_BASE_URL` (default, la API oficial; los e2e usan un servidor
   * falso). Se resuelve al construir: un valor inválido detiene el arranque.
   */
  private readonly clientSecretsUrl: string;

  constructor(private readonly logsService: LogsService) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    this.clientSecretsUrl = `${parseOpenAiApiBaseUrl(process.env.OPENAI_API_BASE_URL)}${REALTIME_CLIENT_SECRETS_PATH}`;
  }

  /**
   * Genera un token efímero de 15 minutos para WebRTC
   * Este token permite que el frontend se conecte directamente a OpenAI Realtime API
   */
  async generateEphemeralToken(): Promise<{ token: string; expiresAt: Date }> {
    const correlationId = uuidv4();
    const startTime = Date.now();

    try {
      this.logger.debug(
        `Generating ephemeral token for OpenAI Realtime API... [${correlationId}]`,
      );

      // CRITICO: Usar endpoint específico para generar tokens de WebSocket (GA)
      // Reference: "If you want to use the Realtime GA API, please create a client secret using the /v1/realtime/client_secrets endpoint."
      // NOTA: Este endpoint es sensible con los parámetros. Volvemos a body vacío para asegurar token.
      const response = await fetch(this.clientSecretsUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}), // Restauramos body vacío para recuperar la conexión
      });

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const errorData = await response.text();
        this.logger.error(
          `OpenAI API Error Response: ${errorData} [${correlationId}]`,
        );

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

      // Fase 4 · P7.L: la respuesta trae el `client_secret` (una credencial
      // para abrir una sesión de voz). Nunca se loguea, ni completa ni un
      // prefijo: solo su vencimiento.
      const data: unknown = await response.json();
      const { token, expiresAtSeconds } = readEphemeralToken(data);

      if (!token) {
        throw new Error(
          `No client_secret received from OpenAI (campos: ${describeKeys(data)})`,
        );
      }

      // El token expira en 60 segundos (para conectar) pero la sesión dura más
      const expirySeconds = expiresAtSeconds ?? Date.now() / 1000 + 60;
      const expiresAt = new Date(expirySeconds * 1000);

      this.logger.debug(
        `Ephemeral token generated. Expires at: ${expiresAt.toISOString()} [${correlationId}]`,
      );

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
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const message = errorMessage(error);

      this.logger.error(
        `Error generating ephemeral token: ${message} [${correlationId}]`,
      );

      // Log de error general
      await this.logsService.log({
        level: LogLevel.ERROR,
        message: 'Exception while generating OpenAI ephemeral token',
        type: LogType.OPENAI_API,
        service: ServiceName.OPENAI,
        metadata: { responseTime, error: message },
        correlationId,
      });

      throw new Error('Failed to generate OpenAI ephemeral token');
    }
  }
}

/**
 * `client_secret` de la respuesta de OpenAI: estándar (`{ client_secret: {
 * value, expires_at } }`) o simplificada (`{ value, expires_at }`).
 */
function readEphemeralToken(data: unknown): {
  token?: string;
  expiresAtSeconds?: number;
} {
  const root = asRecord(data);
  const wrapper = asRecord(root?.client_secret);
  const token = stringOf(wrapper?.value) ?? stringOf(root?.value);
  const expiresAtSeconds =
    numberOf(wrapper?.expires_at) ?? numberOf(root?.expires_at);
  return { token, expiresAtSeconds };
}

/** Solo los nombres de los campos (nunca sus valores) para un error. */
function describeKeys(data: unknown): string {
  const record = asRecord(data);
  return record ? Object.keys(record).join(', ') || '(ninguno)' : typeof data;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}
