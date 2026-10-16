import WebSocket from 'ws';
import axios from 'axios';
import type { HubConfig } from '../config';
import { Logger } from '../utils/logger';
import { hubAuthHeaders } from '../utils/hub-auth-headers';
import {
  buildHouseContextMessage,
  parseExpectedVisitorsCount,
} from '../utils/house-context';
import { WebSocketClientService, type ToolExecutionResult } from './websocket-client.service';

/** Evento del servidor Realtime: `type` y campos que dependen del tipo. */
interface RealtimeServerEvent {
  type: string;
  [key: string]: unknown;
}

/** Evento que el hub envía a la sesión Realtime. */
type RealtimeClientEvent = { type: string } & Record<string, unknown>;

/** `obj[key]` si `obj` es un objeto y el valor es un string. */
function stringField(obj: unknown, key: string): string | undefined {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Interpreta un mensaje del WebSocket de OpenAI; `null` si no es un evento. */
export function parseRealtimeEvent(raw: string): RealtimeServerEvent | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  return typeof (parsed as { type?: unknown }).type === 'string'
    ? (parsed as RealtimeServerEvent)
    : null;
}

/**
 * Definición de tool en formato Realtime (OpenAI function-calling).
 * Espejo local de `RealtimeToolDefinition` (backend/src/agent/tool-definitions.util.ts)
 * — no se importa entre paquetes porque el hub se despliega solo (Raspberry Pi),
 * así que ambos lados mantienen la MISMA forma pero como copias independientes.
 */
interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Respuesta de `POST /concierge/agent-config/:houseNumber` — el backend es
 * la ÚNICA fuente de verdad del prompt "Sofía" y del catálogo de tools
 * (ver backend/src/digital-concierge/dto/agent-config.dto.ts). El hub deja
 * de definir cualquiera de los dos localmente.
 */
interface AgentConfig {
  instructions: string;
  tools: RealtimeToolDefinition[];
}

/** Prefijo del evento con la respuesta del residente (`visitor:response:<sessionId>`). */
export const VISITOR_RESPONSE_EVENT_PREFIX = 'visitor:response:';

/**
 * Qué se le indica al visitante tras `visitor:response:<sessionId>`:
 *  - `enter`: aprobada y el acceso se abrió automáticamente: puede pasar.
 *  - `denied`: rechazada: no ingresa.
 *  - `wait`: cualquier otra cosa (aprobada pero el acceso NO se abrió
 *    automáticamente, o payload inesperado): que espere; conserjería fue
 *    avisada.
 */
export type VisitorResponseOutcome = 'enter' | 'denied' | 'wait';

/**
 * Fase 4 · P4 (fail-closed): solo "pase" si `approved === true &&
 * entryRegistered === true`. Un rechazo explícito (`approved === false`) no
 * ingresa. Todo lo demás (aprobada sin apertura automática, campos ausentes
 * o de otro tipo) se trata como acceso NO abierto: que espere.
 */
export function classifyVisitorResponse(data: unknown): VisitorResponseOutcome {
  if (typeof data !== 'object' || data === null) {
    return 'wait';
  }
  const { approved, entryRegistered } = data as {
    approved?: unknown;
    entryRegistered?: unknown;
  };
  if (approved === true && entryRegistered === true) {
    return 'enter';
  }
  if (approved === false) {
    return 'denied';
  }
  return 'wait';
}

/** Instrucción de sistema para el modelo según la respuesta del residente. */
export function visitorResponseInstruction(outcome: VisitorResponseOutcome): string {
  const header = 'ATENCIÓN: EL SISTEMA HA RECIBIDO LA RESPUESTA DEL RESIDENTE.';
  switch (outcome) {
    case 'enter':
      return `${header} La visita fue APROBADA y el acceso se abrió automáticamente: el visitante puede ingresar. Procede INMEDIATAMENTE al paso 5 del flujo e indícale que puede pasar.`;
    case 'denied':
      return `${header} La visita fue RECHAZADA: el visitante NO debe ingresar. Procede INMEDIATAMENTE al paso 5 del flujo y comunícaselo con amabilidad.`;
    case 'wait':
      return `${header} El acceso NO se abrió automáticamente: NO le digas que pase ni que la puerta se abrirá. Pídele amablemente que espere un momento, explícale que el acceso no se abrió automáticamente y que ya se avisó a conserjería para que lo atienda.`;
  }
}

/**
 * Cliente para OpenAI Realtime API usando WebSocket directo.
 *
 * Fase 1, Bloque C (docs/modulos/agente-cerebro.md §10.2 paso 6): este
 * servicio deja de ser un "agente" (ya no define prompt, tools, ni decide
 * qué hacer con cada tool call) y pasa a ser transporte delgado — el
 * cerebro (prompt "Sofía" + catálogo de tools + ejecución tenant-aware)
 * vive en el backend (`digital-concierge.controller.ts`). Este cliente solo:
 * (a) pide la configuración de sesión al backend (`agent-config/:houseNumber`),
 * (b) reenvía cada tool call a `execute-tool` y devuelve el resultado a la
 * sesión Realtime, y (c) cierra el canal cuando el backend señala
 * `finalizada: true`.
 *
 * Implementación: WebSocket nativo (ws library)
 * Referencia: https://platform.openai.com/docs/api-reference/realtime
 */
export class ConciergeClientService {
  private readonly logger = new Logger(ConciergeClientService.name);
  private ws: WebSocket | null = null;
  private currentSessionId: string | null = null;
  private conversationActive = false;
  private readonly backendUrl: string;
  /** Solo en desarrollo (`loadHubConfig` la prohíbe en producción). */
  private readonly debugOpenAiKey: string | null;
  private audioHandlers: ((audioBuffer: Buffer) => void)[] = [];
  private audioDoneHandlers: (() => void)[] = [];
  private speechStartedHandlers: (() => void)[] = [];
  private conversationEndedHandlers: (() => void)[] = []; // <-- NUEVO
  private targetHouse: string | null = null;
  private isInterrupted = false;
  private isResponseActive = false; // <-- NUEVO: Para saber si vale la pena cancelar
  private waitingTimeout: NodeJS.Timeout | null = null; // <-- NUEVO: Para tiempos muertos
  private agentConfig: AgentConfig | null = null; // Prompt + tools obtenidos del backend (agent-config/:houseNumber)
  
  // Configuración del modelo Realtime (versión GA estable)
  private readonly REALTIME_MODEL = 'gpt-realtime-mini-2025-12-15';
  private readonly REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime';

  /**
   * @param config configuración validada al arrancar (`loadHubConfig`):
   *   `backendUrl` (https en producción) y `debugOpenAiKey`.
   */
  constructor(
    private readonly websocketClient: WebSocketClientService,
    config: Pick<HubConfig, 'backendUrl' | 'debugOpenAiKey'>,
  ) {
    this.backendUrl = config.backendUrl;
    this.debugOpenAiKey = config.debugOpenAiKey;
    this.logger.log('✅ Concierge Client inicializado (WebSocket nativo)');
    this.logger.log(`📡 Backend URL: ${this.backendUrl}`);
    this.logger.log(`🤖 Modelo: ${this.REALTIME_MODEL}`);
  }

  /**
   * Headers de autenticación de hub (Fase 1, Bloque A1 —
   * backend/src/hub/guards/hub-auth.guard.ts) para las llamadas HTTP propias
   * de este servicio a `/api/v1/concierge/*` (session/start, context,
   * session/:id/end). `executeTool` va por `WebSocketClientService` y ya
   * manda los suyos.
   */
  private hubHeaders(): Record<string, string> {
    return hubAuthHeaders(this.websocketClient.getHubCredentials());
  }

  /**
   * Pide al backend el prompt "Sofía" y las definiciones de tools para la
   * casa marcada (`POST /concierge/agent-config/:houseNumber` — única
   * fuente de verdad, ver `digital-concierge.controller.ts#getAgentConfig`).
   */
  private async fetchAgentConfig(houseNumber: string): Promise<AgentConfig> {
    const response = await axios.post<AgentConfig>(
      `${this.backendUrl}/api/v1/concierge/agent-config/${houseNumber}`,
      {},
      { headers: this.hubHeaders() },
    );
    return response.data;
  }

  /**
   * Conecta a OpenAI Realtime API usando WebSocket directo.
   * @param houseNumber Casa marcada — necesaria ANTES de abrir el WebSocket
   *   para pedir la configuración del agente (prompt + tools) al backend,
   *   que `configureSession()` usará en el primer `session.update`.
   */
  async connect(houseNumber: string): Promise<void> {
    try {
      this.targetHouse = houseNumber;

      this.logger.log(`📋 Solicitando configuración del agente al backend (casa ${houseNumber})...`);
      this.agentConfig = await this.fetchAgentConfig(houseNumber);
      this.logger.log(`✅ Configuración del agente obtenida (${this.agentConfig.tools.length} tools)`);

      let ephemeralToken: string;
      let sessionId: string;

      // 🔍 DEBUG: Permitir uso directo de API Key para descartar problemas de
      // tokens efímeros. Solo en desarrollo: `loadHubConfig` la prohíbe en
      // producción.
      if (this.debugOpenAiKey) {
        this.logger.warn('⚠️ MODO DEBUG ACTIVADO: Usando API Key directa (Bypassing Backend) ⚠️');
        ephemeralToken = this.debugOpenAiKey;
        sessionId = `debug_${Date.now()}`;
        this.currentSessionId = sessionId;
      } else {
        this.logger.log('🎫 Solicitando token efímero al backend...');

        // Obtener token efímero y sessionId del backend
        const response = await axios.post<{ ephemeralToken: string; sessionId: string }>(
          `${this.backendUrl}/api/v1/concierge/session/start`,
          { socketId: this.websocketClient.getSocketId() },
          { headers: this.hubHeaders() },
        );

        ephemeralToken = response.data.ephemeralToken;
        sessionId = response.data.sessionId;
        this.currentSessionId = sessionId;
        // Fase 4 · P6.M: sin el sessionId (identifica la sesión ante el backend).
        this.logger.log('✅ Token efímero y sesión obtenidos del backend');
      }
      
      this.logger.log('🤖 Conectando a OpenAI Realtime API via WebSocket...');

      // Construir URL con modelo y headers según documentación OpenAI
      const wsUrl = `${this.REALTIME_WS_URL}?model=${this.REALTIME_MODEL}`;
      
      // Crear WebSocket con headers de autorización
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${ephemeralToken}`,
        }
      });

      // Configurar event handlers
      this.setupEventHandlers();

      // Esperar a que el WebSocket esté abierto
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout esperando conexión WebSocket'));
        }, 10000);

        this.ws!.on('open', () => {
          clearTimeout(timeout);
          this.logger.log('✅ WebSocket conectado a OpenAI Realtime API');
          this.configureSession();
          resolve();
        });

        this.ws!.on('error', (error: Error) => {
          clearTimeout(timeout);
          this.logger.error('❌ Error en WebSocket de OpenAI:', error);
          reject(error);
        });
      });

      // === NUEVO: Suscribirse a los eventos del WebSocket del Backend ===
      this.subscribeToBackendEvents(sessionId);

    } catch (error) {
      this.logger.error('❌ Error conectando a OpenAI:', error);
      if (axios.isAxiosError(error)) {
        // Fase 4 · P6.M: en error solo el status; el cuerpo, en debug (redactado).
        this.logger.error(`Detalles del error HTTP: status=${error.response?.status ?? 'n/a'}`);
        this.logger.debug('Cuerpo del error HTTP del backend', {
          responseBody: error.response?.data,
        });
      }
      throw error;
    }
  }

  /**
   * Suscribe a los eventos del backend para la sesión actual
   * (`visitor:response:<sessionId>`). Fase 4 · P4: el mensaje al visitante es
   * fail-closed (ver `classifyVisitorResponse`).
   */
  private subscribeToBackendEvents(sessionId: string): void {
      const eventName = `${VISITOR_RESPONSE_EVENT_PREFIX}${sessionId}`;

      this.websocketClient.onEvent(eventName, (data: unknown) => {
          const outcome = classifyVisitorResponse(data);
          this.logger.log(`🔔 Respuesta del residente recibida: ${outcome}`);

          this.clearWaitingTimeout(); // Detener temporizador si contesta

          if (!this.conversationActive) {
             this.logger.warn('Se recibió la decisión, pero la conversación ya había terminado.');
             return;
          }

          // Inyectar el mensaje del sistema notificando la decisión
          this.sendEvent({
              type: 'conversation.item.create',
              item: {
                  type: 'message',
                  role: 'system',
                  content: [
                      {
                          type: 'input_text',
                          text: visitorResponseInstruction(outcome)
                      }
                  ]
              }
          });

          // Forzar la generación de la respuesta
          this.sendEvent({ type: 'response.create' });
      });
  }

  /**
   * Configura la sesión de OpenAI con parámetros optimizados
   * Estructura según documentación oficial de OpenAI Realtime API
   */
  private configureSession(): void {
    if (!this.ws) {
      this.logger.error('❌ No hay WebSocket para configurar');
      return;
    }

    if (!this.agentConfig) {
      // No debería pasar: connect() espera fetchAgentConfig() ANTES de abrir
      // el WebSocket. Si igual ocurre, no hay prompt/tools con los que
      // configurar la sesión de forma segura.
      this.logger.error('❌ No hay agentConfig (prompt/tools) cargado; abortando configuración de sesión');
      return;
    }

    // Configuración de sesión según documentación oficial
    // ESTRATEGIA DEBUG: Agregar type='realtime' aunque no debiera ser necesario para update, por si acaso es el param faltante.
    const sessionConfig = {
      type: 'session.update',
      session: {
        // CORRECCION CRITICA: El API rechaza "modalities", usa "modalities" en Beta pero "output_modalities" en GA WebSocket object?
        // El log del backend muestra "output_modalities": ["audio"].
        // Intentaremos usar "modalities" -> "output_modalities" (como estaba al inicio) ya que "modalities" falló.
        // Ademas mantenemos type='realtime' que solucionó el error de parametro requerido.
        type: 'realtime', 
        
        // modalities: ['audio', 'text'], // ESTO FALLÓ ("Unknown parameter")
        // Probamos sin modalities explícito para ver si toma default, o usamos output_modalities si queremos cambiarlo.
        // Vamos a comentar modalities para que no falle el update. Las tools deberían funcionar igual.
        // Si no hay texto, tal vez no pueda emitir function calls? 
        // Pero "output_modalities": ["audio"] es el default y function calling funciona con audio inputs.
        // Vamos a probar SIN este campo para asegurar que session.update pase sin error.
        
        // NOTA: Eliminamos 'voice' temporalmente porque lanza "Unknown parameter".
        // Usaremos la voz por defecto ('alloy') por ahora para asegurar conexión.
        
        instructions: this.agentConfig.instructions,

        // Estructura anidada 'audio' siguiendo RealtimeAudioConfig
        audio: {
          input: {
            // El formato debe ser un objeto con type 'audio/pcm' y rate 24000
            format: { 
              type: 'audio/pcm',
              rate: 24000
            },
            transcription: {
              // Usamos el modelo de transcripción optimizado para la versión Mini (whisper-1 puede tener rate limits estrictos)
              model: 'gpt-4o-mini-transcribe-2025-12-15', 
              language: 'es'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.8, // (Antes 0.8). Más alto => Menos sensible al ruido de calle/bocinas
              prefix_padding_ms: 300,
              silence_duration_ms: 250, // Ultra-rápido: espera 250ms de silencio para responder
              create_response: true,
              interrupt_response: false // NUEVO: Deshabilitar interrupciones (no corta a la IA)
            }
          },
          output: {
            // El formato de salida también debe ser objeto
            format: { 
              type: 'audio/pcm',
              rate: 24000
            },
            voice: 'sage'
          }
        },
        
        tools: this.agentConfig.tools,
        tool_choice: 'auto',
      }
    };

    // Fase 4 · P6.M: en info solo metadatos; el `session.update` completo
    // (prompt y tools) va en debug y con `instructions` redactado.
    this.logger.log(
      `📤 Enviando configuración de sesión (instrucciones: ${this.agentConfig.instructions.length} caracteres, ${this.agentConfig.tools.length} tools)`,
    );
    this.logger.debug('📤 session.update', { sessionUpdate: sessionConfig });
    this.sendEvent(sessionConfig);

    this.logger.log('📋 Sesión de OpenAI configurada exitosamente');
  }

  /**
   * Método auxiliar para enviar eventos al WebSocket
   */
  private sendEvent(event: RealtimeClientEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('❌ WebSocket no está abierto, no se puede enviar evento');
      return;
    }

    const eventString = JSON.stringify(event);
    this.ws.send(eventString);
  }

  /**
   * Event handlers para WebSocket directo
   * Réplica exacta del frontend
   */
  private setupEventHandlers(): void {
    if (!this.ws) return;

    // Mensaje recibido del WebSocket
    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const event = parseRealtimeEvent(data.toString());
        if (!event) {
          this.logger.warn('Mensaje de WebSocket sin tipo de evento: se ignora');
          return;
        }
        this.handleRealtimeEvent(event);
      } catch (error) {
        this.logger.error('❌ Error parseando mensaje de WebSocket:', error);
      }
    });

    // WebSocket cerrado
    this.ws.on('close', (code: number, reason: Buffer) => {
      this.logger.warn(`❌ Conexión a OpenAI cerrada - Código: ${code}, Razón: ${reason.toString()}`);
      this.conversationActive = false;
    });

    // Error en WebSocket
    this.ws.on('error', (error: Error) => {
      this.logger.error('❌ Error en WebSocket:', error);
    });
  }

  /**
   * Maneja eventos de la Realtime API
   */
  /**
   * Maneja eventos de la Realtime API.
   *
   * Fase 4 · P6.M: en `info` solo metadatos (tipo de evento, largos, nombre
   * de la tool). El evento completo va en `debug`, y el formato del logger
   * redacta transcripciones, textos, argumentos, instrucciones y tokens.
   */
  private handleRealtimeEvent(event: RealtimeServerEvent): void {
    const { type } = event;

    // Filtrar eventos ruidosos (deltas)
    if (!type.includes('delta') && !type.includes('input_audio_buffer')) {
      this.logger.debug(`📥 Evento: ${type}`, { event });
    }

    switch (type) {
      // Sesión
      case 'session.created':
        this.logger.log('✅ Sesión de OpenAI creada');
        break;

      case 'session.updated':
        this.logger.log('✅ Sesión actualizada correctamente');
        break;

      // Respuestas
      case 'response.created':
        this.logger.log('🎬 Respuesta iniciada');
        this.isInterrupted = false; // Nueva respuesta, resetear flag
        this.isResponseActive = true; // <-- NUEVO
        break;

      case 'response.done': {
        const output = (event.response as { output?: unknown } | undefined)?.output;
        this.logger.log(
          `✅ Respuesta completa (status: ${stringField(event.response, 'status') ?? 'n/a'}, items: ${
            Array.isArray(output) ? output.length : 0
          })`,
        );
        this.logger.debug('Detalles de la respuesta', { response: event.response });
        this.isResponseActive = false; // <-- NUEVO
        break;
      }

      case 'response.content_part.added':
        this.logger.log(`📝 Content part agregado: ${stringField(event.part, 'type') ?? 'n/a'}`);
        break;

      case 'response.output_item.added':
        this.logger.log(`📝 Output item agregado: ${stringField(event.item, 'type') ?? 'n/a'}`);
        break;

      case 'response.output_item.done':
        this.logger.log(`✅ Output item completado: ${stringField(event.item, 'type') ?? 'n/a'}`);
        break;

      // Audio
      case 'response.audio.delta':
      case 'response.output_audio.delta': {
        if (this.isInterrupted) {
          // Ignorar audio si el usuario interrumpió
          return;
        }
        this.logger.debug('🔊 Audio delta recibido');
        const delta = stringField(event, 'delta');
        if (delta) {
          const audioBuffer = Buffer.from(delta, 'base64');
          this.audioHandlers.forEach(handler => handler(audioBuffer));
        }
        break;
      }

      case 'response.audio.done':
      case 'response.output_audio.done':
        this.logger.log('✅ Audio completo recibido');
        this.audioDoneHandlers.forEach(handler => handler());
        break;

      // Transcripción: en info solo el largo, nunca el texto (es la voz del
      // visitante: nombre, RUT, teléfono).
      case 'conversation.item.input_audio_transcription.completed':
        this.logger.log(
          `👤 Transcripción del usuario recibida (${stringField(event, 'transcript')?.length ?? 0} caracteres)`,
        );
        break;

      case 'conversation.item.input_audio_transcription.failed':
        this.logger.warn('⚠️ Transcripción fallida', {
          code: stringField(event.error, 'code'),
          errorType: stringField(event.error, 'type'),
        });
        break;

      // VAD
      case 'input_audio_buffer.speech_started':
        this.logger.log('🎙️ Detectado inicio de habla del usuario');
        
        // INTERRUPCIONES DESACTIVADAS:
        // No marcamos isInterrupted = true, ni enviamos response.cancel.
        // La IA seguirá hablando y escuchará simultáneamente para el siguiente turno.
        
        this.speechStartedHandlers.forEach(handler => handler());
        break;

      case 'input_audio_buffer.speech_stopped':
        this.logger.log('🎙️ Detectado fin de habla del usuario');
        break;

      case 'input_audio_buffer.committed':
        this.logger.log('✅ Audio del usuario confirmado');
        break;

      // Tool calls
      case 'response.function_call_arguments.delta':
        // Acumular argumentos si es necesario
        break;

      case 'response.function_call_arguments.done': {
        const name = stringField(event, 'name');
        const callId = stringField(event, 'call_id');
        const args = stringField(event, 'arguments');
        if (name === undefined || callId === undefined || args === undefined) {
          this.logger.warn('Tool call sin name/call_id/arguments: se ignora');
          break;
        }
        void this.handleToolCall({ name, call_id: callId, arguments: args });
        break;
      }

      // Errores: código y mensaje de OpenAI (no traen datos del visitante);
      // el evento completo, en debug.
      case 'error':
        this.logger.error(
          `❌ Error de OpenAI: ${stringField(event.error, 'code') ?? 'sin código'} - ${
            stringField(event.error, 'message') ?? 'sin mensaje'
          }`,
        );
        this.logger.debug('Detalle del error de OpenAI', { event });
        break;

      default:
        // Log de eventos no manejados (para debugging)
        if (!type.includes('delta')) {
          this.logger.debug(`📨 Evento no manejado: ${type}`);
        }
    }
  }

  /**
   * Reenvía una tool call al backend y devuelve el resultado a la sesión
   * Realtime.
   *
   * Fase 1, Bloque C: el hub deja de decidir NADA sobre las tools —
   * `finalizar_llamada` incluida. TODAS se ejecutan en el backend
   * (tenant-aware, auditado, `POST /concierge/session/:id/execute-tool`).
   * La única señal que el hub interpreta localmente es `data.finalizada
   * === true` en la respuesta, para saber cuándo cortar el canal físico.
   */
  private async handleToolCall(event: { name: string; call_id: string; arguments: string }): Promise<void> {
    const { name, call_id, arguments: argsString } = event;

    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsString);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        this.logger.error(`Argumentos de la tool ${name} no son un objeto: se ignora`);
        return;
      }
      args = parsed as Record<string, unknown>;
    } catch (error) {
      this.logger.error('Error parseando argumentos de tool call:', error);
      return;
    }

    // Fase 4 · P6.M: en info el nombre de la tool, sin argumentos (datos del
    // visitante). En debug, solo qué campos trae.
    this.logger.log(`🔧 Tool call: ${name}`);
    this.logger.debug(`🔧 Campos de ${name}`, { argKeys: Object.keys(args) });

    try {
      const result: ToolExecutionResult = await this.websocketClient.executeTool(
        name,
        args,
        this.currentSessionId || 'unknown'
      );

      // Si acaba de notificar, iniciar timer de espera proactiva
      if (name === 'notificar_residente') {
        this.startWaitingTimeout();
      }

      // Enviar resultado de la herramienta
      this.sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id,
          output: JSON.stringify(result)
        }
      });

      if (this.isFinalizadaResult(result)) {
        // El backend marcó la sesión como finalizada (tool finalizar_llamada).
        // Damos un tiempo de gracia para que el audio de despedida termine
        // de reproducirse antes de cortar el canal físico del citófono —
        // mismo margen que existía cuando esta decisión era local.
        this.logger.log('📞 Tool finalizar_llamada completada. Esperando cierre del canal (24s)...');
        setTimeout(() => {
          this.logger.log('📞 Tiempo de gracia expirado. Cortando canal de audio.');
          this.endConversation();
        }, 24000);
      } else {
        // Solicitar que el modelo procese el resultado
        this.sendEvent({ type: 'response.create' });
      }

      this.logger.log(`✅ Tool ${name} completada`);
    } catch (error) {
      this.logger.error(`Error en tool ${name}:`, error);

      // Enviar error
      this.sendEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id,
          output: JSON.stringify({
            error: 'Error ejecutando herramienta',
            details: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      });

      // Solicitar que el modelo procese el error
      this.sendEvent({
        type: 'response.create'
      });
    }
  }

  /**
   * Detecta la señal de fin de llamada devuelta por `execute-tool`
   * (`ToolResultDto.data.finalizada === true`, ver `finalizar-llamada.tool.ts`
   * en el backend).
   */
  private isFinalizadaResult(result: ToolExecutionResult): boolean {
    if (!result.success || typeof result.data !== 'object' || result.data === null) {
      return false;
    }
    return (result.data as { finalizada?: unknown }).finalizada === true;
  }

  /**
   * Pide al backend la cantidad de visitas esperadas de la casa
   * (`{ expectedVisitorsCount }`, corrección P7: sin nombres). `null` si no
   * se pudo obtener o la respuesta no tiene esa forma.
   */
  private async fetchExpectedVisitorsCount(houseNumber: string): Promise<number | null> {
    try {
      this.logger.log('🔍 Consultando visitas esperadas de la casa...');
      const response = await axios.post<unknown>(
        `${this.backendUrl}/api/v1/concierge/context/${encodeURIComponent(houseNumber)}`,
        {},
        { headers: this.hubHeaders() },
      );
      const expectedVisitorsCount = parseExpectedVisitorsCount(response.data);
      this.logger.log(
        expectedVisitorsCount === null
          ? '⚠️ Contexto de la casa con un formato inesperado: se ignora'
          : `✅ Contexto de la casa obtenido (${expectedVisitorsCount} visitas esperadas)`,
      );
      return expectedVisitorsCount;
    } catch (error) {
      this.logger.warn('⚠️ No se pudo obtener el contexto de la casa', {
        status: axios.isAxiosError(error) ? error.response?.status : undefined,
      });
      return null;
    }
  }

  /**
   * Inicia una conversación con el número de casa marcado.
   *
   * El prompt "Sofía" (con houseNumber ya interpolado) se cargó en
   * `configureSession()` a partir de `agentConfig.instructions` — acá solo
   * se inyecta el contexto de la casa, que es dato dinámico obtenido en
   * caliente y no forma parte del prompt fijo que devuelve el backend.
   *
   * Fase 4 · P6.M: el contexto va como mensaje `user` delimitado y marcado
   * como datos (`buildHouseContextMessage`), nunca como `system`. Corrección
   * P7 (cyber B8): solo la cantidad de visitas registradas, sin nombres. El
   * prompt de Sofía dice que nunca otorga acceso.
   */
  async startConversation(houseNumber: string): Promise<void> {
    if (this.conversationActive) {
      this.logger.warn('Ya hay una conversación activa');
      return;
    }

    this.logger.log(`🎙️ Iniciando conversación para casa ${houseNumber}`);

    this.conversationActive = true;
    this.targetHouse = houseNumber;

    const expectedVisitorsCount = await this.fetchExpectedVisitorsCount(houseNumber);

    this.logger.log('📤 Agregando contexto de la casa (datos, no instrucciones)...');
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: buildHouseContextMessage(expectedVisitorsCount),
          },
        ],
      },
    });

    // Solicitar respuesta inicial. El saludo y el resto del flujo ya están
    // definidos en las instructions que devolvió el backend (agent-config)
    // — no se vuelve a hardcodear ningún guion acá.
    this.logger.log('📤 Solicitando respuesta inicial...');
    this.sendEvent({ type: 'response.create' });
  }

  /**
   * Envía audio capturado del micrófono
   */
  sendAudio(audioBuffer: Buffer): void {
    if (!this.conversationActive || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // Convertir Buffer a base64
    const base64Audio = audioBuffer.toString('base64');
    
    this.sendEvent({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    });
  }

  /**
   * Finaliza conversación
   */
  endConversation(): void {
    if (!this.conversationActive) {
      return;
    }

    this.logger.log('🛑 Finalizando conversación');
    
    this.conversationActive = false;
    this.targetHouse = null;
    
    this.clearWaitingTimeout(); // Detener temporizador si conversación termina por otra causa

    // Notificar a los suscriptores (ej. AudioRouter) para que apaguen sus flujos y relés
    this.conversationEndedHandlers.forEach(handler => handler());

    // Limpiar handlers para evitar ejecución duplicada en la siguiente llamada
    this.audioHandlers = [];
    this.audioDoneHandlers = [];
    this.speechStartedHandlers = [];
    this.conversationEndedHandlers = [];
    
    // NOTA: Eliminamos la creación forzada de respuesta ('response.create')
    // para evitar que el agente se despida múltiples veces o intente "rellenar" el silencio.
  }

  /**
   * Registra un handler para audio recibido de OpenAI
   */
  onAudioReceived(handler: (audioBuffer: Buffer) => void): void {
    this.audioHandlers.push(handler);
  }

  /**
   * Registra un handler para cuando finaliza la reproducción de audio
   */
  onAudioResponseDone(handler: () => void): void {
    this.audioDoneHandlers.push(handler);
  }

  /**
   * Registra un handler para cuando el usuario empieza a hablar (interrupción)
   */
  onSpeechStarted(handler: () => void): void {
    this.speechStartedHandlers.push(handler);
  }

  /**
   * Registra un handler para cuando la conversación finaliza (ej. por tool call)
   */
  onConversationEnded(handler: () => void): void {
    this.conversationEndedHandlers.push(handler);
  }

  /**
   * Verifica si hay conversación activa
   */
  isActive(): boolean {
    return this.conversationActive;
  }

  /**
   * Desconecta de OpenAI y notifica al backend
   */
  async disconnect(): Promise<void> {
    if (this.conversationActive) {
      this.endConversation();
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Notificar al backend que finalizó la sesión
    if (this.currentSessionId) {
      // Limpiar listener de Socket.IO
      this.websocketClient.offEvent(`${VISITOR_RESPONSE_EVENT_PREFIX}${this.currentSessionId}`);

      try {
        await axios.post(
          `${this.backendUrl}/api/v1/concierge/session/${this.currentSessionId}/end`,
          { finalStatus: 'completed' },
          { headers: this.hubHeaders() },
        );
        this.logger.log('✅ Sesión finalizada en el backend');
      } catch (error: unknown) {
        this.logger.error('Error finalizando sesión en backend', error);
      }
      this.currentSessionId = null;
    }
    
    this.logger.log('Desconectado de OpenAI');
  }

  /**
   * Limpieza
   */
  async cleanup(): Promise<void> {
    await this.disconnect();
  }

  // --- MÉTODOS DE PROACTIVIDAD ---
  private startWaitingTimeout() {
    this.clearWaitingTimeout();
    this.logger.log('⏳ Iniciando timeout para demora del residente (30s)...');
    
    this.waitingTimeout = setTimeout(() => {
       this.logger.warn('⏰ Residente demora en contestar. Pidiendo a IA que hable...');
       if (this.conversationActive) {
           this.sendEvent({
              type: 'conversation.item.create',
              item: {
                  type: 'message',
                  role: 'system',
                  content: [
                      {
                          type: 'input_text',
                          text: `ATENCIÓN: Han pasado 30 segundos y la APP del residente no ha contestado. Rompe el silencio de forma empática y natural: Dile al visitante que se están demorando un poquito, sugiérele amable y casualmente que los llame él por su teléfono (si tiene sus números), y confírmale que tú igual vas a reintentar notificar por el sistema. Llama INMEDIATAMENTE a la herramienta reenviar_notificacion() tras terminar de hablar para enviar un recordatorio al residente.`
                      }
                  ]
              }
           });
           this.sendEvent({ type: 'response.create' });
       }
    }, 30000); // 30s de silencio sin respuesta
  }

  private clearWaitingTimeout() {
     if (this.waitingTimeout) {
        clearTimeout(this.waitingTimeout);
        this.waitingTimeout = null;
        this.logger.log('🛑 Temporizador de espera de residente detenido.');
     }
  }
}
