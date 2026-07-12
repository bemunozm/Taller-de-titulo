import { createOpenAI } from '@ai-sdk/openai';
import type { ConfigService } from '@nestjs/config';
import type { LanguageModel } from 'ai';

/** Token de inyección del `LanguageModel` que usa el Agent Runner. */
export const AGENT_LANGUAGE_MODEL = Symbol('AGENT_LANGUAGE_MODEL');

/**
 * Fábrica del `LanguageModel` del agente-cerebro (Fase 1, Bloque A2a —
 * docs/modulos/agente-cerebro.md §3/§10.2 paso 1: "provider-agnóstico,
 * configurable por env"). Hoy solo implementa el provider `openai` (el único
 * con credenciales en `.env` — ver `OPENAI_API_KEY`), pero el switch deja el
 * punto de extensión explícito: agregar un `case 'anthropic'` requiere
 * instalar `@ai-sdk/anthropic` (no se instala en A2a para no traer una
 * dependencia sin uso, ver reporte de la tarea) y construir su modelo acá —
 * el resto del sistema (registry, dispatcher, runner) no sabe ni le importa
 * qué provider hay detrás de `LanguageModel`.
 *
 * IDs de modelo: NO se toman de memoria (ver skill ai-sdk) — se leyeron del
 * listado real de modelos disponibles al momento de esta tarea. Default:
 * `gpt-4.1` (estable, con tool-calling maduro, sin el prefijo de preview de
 * la familia gpt-5.x) — configurable por env sin tocar código.
 */
export function createAgentLanguageModel(config: ConfigService): LanguageModel {
  const provider = config.get<string>('AGENT_MODEL_PROVIDER', 'openai');
  const modelId = config.get<string>('AGENT_MODEL_ID', 'gpt-4.1');

  switch (provider) {
    case 'openai': {
      const apiKey = config.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error(
          'AGENT_MODEL_PROVIDER=openai requiere OPENAI_API_KEY configurado (backend/.env)',
        );
      }
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    default:
      throw new Error(
        `AGENT_MODEL_PROVIDER="${provider}" no está soportado todavía. Providers disponibles: "openai". ` +
          'Para agregar otro (p.ej. "anthropic"), instala su paquete @ai-sdk/* y extiende createAgentLanguageModel.',
      );
  }
}
