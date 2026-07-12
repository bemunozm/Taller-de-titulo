import WebSocket from 'ws';
import axios from 'axios';
import { Logger } from '../utils/logger';
import { WebSocketClientService, type ToolExecutionResult } from './websocket-client.service';

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
  private backendUrl: string;
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

  constructor(
    private readonly websocketClient: WebSocketClientService
  ) {
    const backendUrl = process.env.BACKEND_API_URL;

    if (!backendUrl) {
      throw new Error('BACKEND_API_URL no configurado en .env');
    }

    this.backendUrl = backendUrl;
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
    const { hubId, hubSecret } = this.websocketClient.getHubCredentials();
    return { 'X-Hub-Secret': hubSecret, 'X-Hub-Id': hubId };
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

      // 🔍 DEBUG: Permitir uso directo de API Key para descartar problemas de tokens efímeros
      if (process.env.DEBUG_OPENAI_KEY) {
        this.logger.warn('⚠️ MODO DEBUG ACTIVADO: Usando API Key directa (Bypassing Backend) ⚠️');
        ephemeralToken = process.env.DEBUG_OPENAI_KEY;
        sessionId = `debug_${Date.now()}`;
        this.currentSessionId = sessionId;
      } else {
        this.logger.log('🎫 Solicitando token efímero al backend...');
        
        // Obtener token efímero y sessionId del backend
        const response = await axios.post(
          `${this.backendUrl}/api/v1/concierge/session/start`,
          { socketId: this.websocketClient.getSocketId() },
          { headers: this.hubHeaders() },
        );

        ephemeralToken = response.data.ephemeralToken;
        sessionId = response.data.sessionId;
        this.currentSessionId = sessionId;
        this.logger.log(`✅ Token efímero obtenido. SessionId: ${sessionId}`);
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
        this.logger.error(`Detalles del error HTTP: ${error.response?.status} - ${JSON.stringify(error.response?.data)}`);
      }
      throw error;
    }
  }

  /**
   * Suscribe a los eventos del backend para la sesión actual
   */
  private subscribeToBackendEvents(sessionId: string): void {
      const eventName = `visitor:response:${sessionId}`;
      
      this.websocketClient.onEvent(eventName, (data: any) => {
          this.logger.log(`🔔 Evento de residente recibido! Decisión: ${data.approved ? 'APROBADA' : 'RECHAZADA'}`);
          
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
                          text: `ATENCIÓN: EL SISTEMA HA RECIBIDO LA RESPUESTA DEL RESIDENTE. La visita ha sido ${data.approved ? 'APROBADA (Debe ingresar)' : 'RECHAZADA (No debe ingresar)'}. Procede INMEDIATAMENTE al paso 5 del flujo y dáselo a conocer al visitante basado en esta respuesta oficial.`
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

    this.logger.log('📤 Enviando configuración de sesión:', JSON.stringify(sessionConfig, null, 2));
    this.sendEvent(sessionConfig);

    this.logger.log('📋 Sesión de OpenAI configurada exitosamente');
  }

  /**
   * Método auxiliar para enviar eventos al WebSocket
   */
  private sendEvent(event: any): void {
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
        const event = JSON.parse(data.toString());
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
  private handleRealtimeEvent(event: any): void {
    const { type } = event;

    // Filtrar eventos ruidosos (deltas)
    if (!type.includes('delta') && !type.includes('input_audio_buffer')) {
      this.logger.log(`📥 Evento: ${type}`, JSON.stringify(event, null, 2));
    }

    switch (type) {
      // Sesión
      case 'session.created':
        this.logger.log(`✅ Sesión creada: ${event.session?.id}`);
        break;

      case 'session.updated':
        this.logger.log('✅ Sesión actualizada correctamente');
        break;

      // Respuestas
      case 'response.created':
        this.logger.log(`🎬 Respuesta iniciada: ${event.response?.id}`);
        this.isInterrupted = false; // Nueva respuesta, resetear flag
        this.isResponseActive = true; // <-- NUEVO
        break;

      case 'response.done':
        this.logger.log(`✅ Respuesta completa: ${event.response?.id}`);
        this.logger.log('Detalles:', JSON.stringify(event.response, null, 2));
        this.isResponseActive = false; // <-- NUEVO
        break;

      case 'response.content_part.added':
        this.logger.log(`📝 Content part agregado: ${event.part?.type}`);
        break;

      case 'response.output_item.added':
        this.logger.log(`📝 Output item agregado: ${event.item?.type}`);
        break;

      case 'response.output_item.done':
        this.logger.log(`✅ Output item completado: ${event.item?.type}`);
        break;

      // Audio
      case 'response.audio.delta':
      case 'response.output_audio.delta':
        if (this.isInterrupted) {
          // Ignorar audio si el usuario interrumpió
          return;
        }
        this.logger.debug('🔊 Audio delta recibido');
        if (event.delta) {
          const audioBuffer = Buffer.from(event.delta, 'base64');
          this.audioHandlers.forEach(handler => handler(audioBuffer));
        }
        break;

      case 'response.audio.done':
      case 'response.output_audio.done':
        this.logger.log('✅ Audio completo recibido');
        this.audioDoneHandlers.forEach(handler => handler());
        break;

      // Transcripción
      case 'conversation.item.input_audio_transcription.completed':
        this.logger.log(`👤 Usuario: ${event.transcript}`);
        break;

      case 'conversation.item.input_audio_transcription.failed':
        // FIX: Concatenar error al mensaje para que el logger personalizado lo muestre
        this.logger.warn(`⚠️ Transcripción fallida: ${JSON.stringify(event.error, null, 2)}`);
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

      case 'response.function_call_arguments.done':
        this.handleToolCall(event);
        break;

      // Errores
      case 'error':
        // Log detallado de CUALQUIER error
        this.logger.error('❌ Error de OpenAI (Detalle Completo):', JSON.stringify(event, null, 2));
        if (event.error?.code) {
             this.logger.error(`Error Code: ${event.error.code} - Message: ${event.error.message}`);
        }
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
      args = JSON.parse(argsString);
    } catch (error) {
      this.logger.error('Error parseando argumentos de tool call:', error);
      return;
    }

    this.logger.log(`🔧 Tool call: ${name}(${JSON.stringify(args)})`);

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
   * Inicia una conversación con el número de casa marcado.
   *
   * El prompt "Sofía" (con houseNumber ya interpolado) se cargó en
   * `configureSession()` a partir de `agentConfig.instructions` — acá solo
   * se inyecta el HISTORIAL de visitas, que es dato dinámico obtenido en
   * caliente y no forma parte del prompt fijo que devuelve el backend.
   */
  async startConversation(houseNumber: string): Promise<void> {
    if (this.conversationActive) {
      this.logger.warn('Ya hay una conversación activa');
      return;
    }

    this.logger.log(`🎙️ Iniciando conversación para casa ${houseNumber}`);
    
    this.conversationActive = true;
    this.targetHouse = houseNumber;
    
    let contextStr = 'Sin contexto histórico previo o fallo en obtenerlo.';
    try {
      this.logger.log('🔍 Consultando historial de visitantes a la casa...');
      const response = await axios.post(
        `${this.backendUrl}/api/v1/concierge/context/${houseNumber}`,
        {},
        { headers: this.hubHeaders() },
      );
      contextStr = response.data.context;
      this.logger.log(`✅ Historial inyectado en prompt: ${contextStr}`);
    } catch (e) {
      this.logger.warn('⚠️ No se pudo obtener el historial de visitas para el contexto.');
    }

    // Inyectar el historial de visitas como mensaje de sistema adicional
    // (dato dinámico; el prompt base ya viene fijado desde configureSession())
    this.logger.log('📤 Agregando historial de visitas al contexto...');
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `HISTORIAL DE VISITAS OBTENIDO DE LA BASE DE DATOS PARA LA CASA ${houseNumber}: ${contextStr}`
          }
        ]
      }
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
      this.websocketClient.offEvent(`visitor:response:${this.currentSessionId}`);

      try {
        await axios.post(
          `${this.backendUrl}/api/v1/concierge/session/${this.currentSessionId}/end`,
          { finalStatus: 'completed' },
          { headers: this.hubHeaders() },
        );
        this.logger.log(`✅ Sesión ${this.currentSessionId} finalizada en el backend`);
      } catch (error: any) {
        this.logger.error(`Error finalizando sesión en backend: ${error.message}`);
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
