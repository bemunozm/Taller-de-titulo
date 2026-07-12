import { useState, useEffect, useRef } from 'react';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { ConciergeAPI, type RealtimeToolDefinition, type ToolExecutionResponse } from '@/api/ConciergeAPI';
import { webSocketService } from '@/services/WebSocketService';
import { ConversationStatus, type ConversationState } from '@/components/concierge/ConversationStatus';
import { CollectedDataPanel, type CollectedData } from '@/components/concierge/CollectedDataPanel';
import { AudioVisualizer } from '@/components/concierge/AudioVisualizer';
import { TranscriptDisplay, type TranscriptMessage } from '@/components/concierge/TranscriptDisplay';
import { DialPad } from '@/components/concierge/DialPad';
import { PhoneXMarkIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { Subheading } from '@/components/ui/Heading';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

/**
 * Forma mínima de JSON Schema "object" que satisface `ToolInputParameters`
 * del SDK de Realtime (`JsonObjectSchemaNonStrict` no se exporta públicamente
 * desde `@openai/agents-core`/`@openai/agents-realtime`, así que no se puede
 * importar por nombre). Es solo una anotación de compilación: el valor real
 * en tiempo de ejecución sigue siendo `definition.parameters`, el JSON Schema
 * que el backend deriva de cada `VigiliaTool.inputSchema` (única fuente de
 * verdad — ver `buildRealtimeToolDefinitions` en el backend).
 */
interface RealtimeToolParametersSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Construye una tool "delgada" para el SDK de Realtime a partir de la
 * definición que sirve el backend: NO ejecuta lógica de negocio localmente,
 * solo reenvía la llamada a `POST /concierge/session/:id/execute-tool` y
 * devuelve el resultado tal cual al modelo.
 */
function buildRealtimeTool(
  definition: RealtimeToolDefinition,
  sessionId: string,
  onResult: (toolName: string, result: ToolExecutionResponse) => void,
) {
  return tool({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters as unknown as RealtimeToolParametersSchema,
    strict: false,
    async execute(input) {
      const parameters = isRecord(input) ? input : {};
      console.log(`[TOOL] ${definition.name}:`, parameters);

      const result = await ConciergeAPI.executeTool(sessionId, definition.name, parameters);
      onResult(definition.name, result);

      return JSON.stringify(result.success ? (result.data ?? {}) : { error: result.error });
    },
  });
}

export function DigitalConciergeView() {
  // Estado de la sesión
  const [conversationState, setConversationState] = useState<ConversationState>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetHouse, setTargetHouse] = useState<string | null>(null); // Casa marcada desde el DialPad

  // Datos recolectados
  const [collectedData, setCollectedData] = useState<CollectedData>({});

  // Ref para mantener el estado actualizado en closures (evita stale state)
  const collectedDataRef = useRef<CollectedData>({});

  // Transcripción
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);

  // Referencias
  const sessionRef = useRef<RealtimeSession | null>(null);
  const isSpeakingRef = useRef<boolean>(false); // Track si el agente está reproduciendo audio

  // Sincronizar ref con estado
  useEffect(() => {
    collectedDataRef.current = collectedData;
  }, [collectedData]);

  /**
   * Sincroniza los paneles de UI (datos recolectados / transcript / fin de
   * llamada) con el resultado de una tool ejecutada en el backend. Es lógica
   * de presentación, no de agente — el backend no sabe (ni le importa) que
   * estos paneles existen; solo devuelve `{ success, data, error }` por cada
   * tool y el cliente decide qué mostrar.
   */
  const applyToolResultToUi = (toolName: string, result: ToolExecutionResponse) => {
    if (!result.success || !isRecord(result.data)) {
      if (!result.success) {
        console.warn(`[TOOL] ${toolName} falló:`, result.error);
      }
      return;
    }

    const data = result.data;

    switch (toolName) {
      case 'guardar_datos_visitante': {
        if (!isRecord(data.saved)) break;
        const saved = data.saved;
        setCollectedData((prev) => ({
          ...prev,
          visitorName: typeof saved.nombre === 'string' ? saved.nombre : prev.visitorName,
          visitorRut: typeof saved.rut === 'string' ? saved.rut : prev.visitorRut,
          visitorPhone: typeof saved.telefono === 'string' ? saved.telefono : prev.visitorPhone,
          vehiclePlate: typeof saved.patente === 'string' ? saved.patente : prev.vehiclePlate,
          visitReason: typeof saved.motivo === 'string' ? saved.motivo : prev.visitReason,
          destinationHouse: typeof saved.casa === 'string' ? saved.casa : prev.destinationHouse,
        }));
        break;
      }
      case 'buscar_residente': {
        if (data.encontrado === true && Array.isArray(data.residentes)) {
          const residentNames = data.residentes
            .filter(isRecord)
            .map((resident) => (typeof resident.nombre === 'string' ? resident.nombre : ''))
            .filter((nombre) => nombre.length > 0)
            .join(', ');

          if (residentNames) {
            setCollectedData((prev) => ({ ...prev, residentName: residentNames }));
          }
        }
        break;
      }
      case 'notificar_residente': {
        setCollectedData((prev) => ({ ...prev, residentResponse: 'pending' }));
        break;
      }
      case 'finalizar_llamada': {
        if (data.finalizada === true) {
          console.log('[TOOL] finalizar_llamada - Esperando a que termine el audio...');
          // Dar tiempo suficiente para que el audio de despedida se reproduzca
          // completamente antes de cortar la sesión (el agente tarda ~3-5s).
          setTimeout(() => {
            console.log('[SESSION] ✅ Finalizando llamada por solicitud del agente...');
            disconnectSession();
          }, 8000);
        }
        break;
      }
      default:
        break;
    }
  };

  /**
   * Inicializa y conecta la sesión del conserje digital
   * @param houseNumber Número de casa marcado desde el DialPad
   */
  const connectSession = async (houseNumber: string) => {
    try {
      setError(null);
      setConversationState('processing');

      // 0. Solicitar permisos de micrófono ANTES de cualquier cosa
      console.log('[SESSION] Solicitando permisos de micrófono...');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Detener el stream inmediatamente ya que el SDK lo manejará
        stream.getTracks().forEach(track => track.stop());
        console.log('[SESSION] Permisos de micrófono concedidos');
      } catch (micError) {
        console.error('[SESSION] Error al acceder al micrófono:', micError);
        setError('No se pudo acceder al micrófono. Por favor, permite el acceso al micrófono.');
        setConversationState('error');
        return;
      }

      // 1. Guardar número de casa marcado
      setTargetHouse(houseNumber);
      console.log('[SESSION] 🏠 Casa de destino:', houseNumber);

      // 2. Obtener token efímero del backend y pasar el socketId para notificaciones
      const currentSocketId = webSocketService.getSocketId();
      console.log('[SESSION] 🔌 Socket ID actual:', currentSocketId);

      const { sessionId: newSessionId, ephemeralToken } = await ConciergeAPI.startSession(currentSocketId);
      setSessionId(newSessionId);
      console.log('[SESSION] 🆔 SessionId establecido:', newSessionId);
      console.log('[SESSION] Este sessionId se usará para el listener visitor:response:' + newSessionId);

      // 3. Pre-cargar el número de casa en collectedData
      setCollectedData({ destinationHouse: houseNumber });
      console.log('[SESSION] 📋 Casa de destino pre-cargada en collectedData');

      // 4. Obtener configuración del agente desde el backend (prompt + tools)
      //    Única fuente de verdad — el cliente ya no hardcodea ninguno de los dos.
      const { instructions, tools: toolDefinitions } = await ConciergeAPI.getAgentConfig(houseNumber);
      console.log('[SESSION] 🧠 Config de agente obtenida del backend:', toolDefinitions.map((t) => t.name));

      // 5. Construir tools "delgadas": cada una reenvía la llamada a
      //    execute-tool y aplica el resultado a la UI (paneles/transcript).
      //    La ejecución real (formateo, validaciones, side-effects) vive en
      //    el backend (VigiliaTool + ToolDispatcherService) — el cliente ya
      //    no ejecuta ninguna lógica de negocio localmente.
      const realtimeTools = toolDefinitions.map((definition) =>
        buildRealtimeTool(definition, newSessionId, applyToolResultToUi),
      );

      const agent = new RealtimeAgent({
        name: 'Conserje Digital',
        instructions,
        voice: 'sage',
        tools: realtimeTools,
      });

      // 6. Crear sesión de Realtime con WebRTC (por defecto)
      // Usando gpt-realtime-mini (GA) - más económico que gpt-realtime
      const session = new RealtimeSession(agent, {
        model: 'gpt-realtime-mini',
        config: {
          modalities: ['audio'],
          inputAudioFormat: 'pcm16',
          outputAudioFormat: 'pcm16',
          // Configurar transcripción de audio en español para mejor precisión
          inputAudioTranscription: {
            model: 'whisper-1',
            language: 'es', // Especificar español explícitamente
          },
          turnDetection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      });

      // 7. Escuchar eventos de la sesión

      // Evento para actualizaciones del historial de conversación
      session.on('history_updated', (history: any[]) => {
        console.log('[SESSION] Historial actualizado:', history.length, 'items');

        // DEBUG: Ver estructura de los items
        if (history.length > 0) {
          console.log('[DEBUG] Primer item del historial:', JSON.stringify(history[0], null, 2));
          console.log('[DEBUG] Último item del historial:', JSON.stringify(history[history.length - 1], null, 2));
        }

        // Actualizar transcript con los mensajes del historial
        const messages: TranscriptMessage[] = history
          .filter((item: any) => item.type === 'message' && item.role)
          .map((item: any) => {
            let messageText = '';

            // La estructura real es: item.content[0].transcript
            if (Array.isArray(item.content) && item.content.length > 0) {
              const contentItem = item.content[0];

              // Para mensajes del usuario (input_audio)
              // Las transcripciones están incluidas en el precio base de Realtime API
              if (contentItem.type === 'input_audio') {
                messageText = contentItem.transcript || '🎤 [Audio sin transcribir]';
              }
              // Para mensajes del asistente (output_audio)
              else if (contentItem.type === 'output_audio') {
                messageText = contentItem.transcript || '[Respuesta en progreso...]';
              }
              // Para mensajes de texto
              else if (contentItem.type === 'text') {
                messageText = contentItem.text || '';
              }
            }

            // Incluir mensajes del asistente y placeholder para usuario
            if (!messageText) {
              return null;
            }

            return {
              id: `msg-${item.itemId}`,
              role: item.role,
              content: messageText,
              timestamp: new Date(),
            };
          })
          .filter((msg: TranscriptMessage | null): msg is TranscriptMessage =>
            msg !== null && msg.content.trim() !== ''
          );

        setTranscript(messages);
      });

      // Evento para interrupciones de audio
      session.on('audio_interrupted', () => {
        console.log('[SESSION] Audio interrumpido');
        setConversationState('listening');
      });

      // Eventos de transporte de bajo nivel (para estados de audio)
      session.on('transport_event', (event: any) => {
        console.log('[TRANSPORT EVENT]', event.type, event);

        // Eventos de input de audio (usuario hablando)
        if (event.type === 'input_audio_buffer.speech_started') {
          console.log('[STATE] Usuario empezó a hablar');
          setConversationState('listening');
          isSpeakingRef.current = false;
        } else if (event.type === 'input_audio_buffer.speech_stopped') {
          console.log('[STATE] Usuario dejó de hablar');
          setConversationState('processing');
        } else if (event.type === 'input_audio_buffer.committed') {
          console.log('[STATE] Audio del usuario confirmado');
          setConversationState('processing');
        }
        // Eventos de output de audio (agente hablando)
        else if (event.type === 'output_audio_buffer.started') {
          // El buffer de audio comenzó a reproducirse
          console.log('[STATE] ✅ Buffer de audio iniciado - agente hablando');
          isSpeakingRef.current = true;
          setConversationState('speaking');
        }
        else if (event.type === 'output_audio_buffer.stopped') {
          // El buffer de audio se detuvo (terminó de reproducirse)
          console.log('[STATE] ✅ Buffer de audio detenido - agente terminó de hablar');
          isSpeakingRef.current = false;
          setConversationState('idle');
        }
        else if (event.type === 'output_audio_buffer.cleared') {
          // El buffer de audio fue limpiado
          console.log('[STATE] Buffer de audio limpiado');
          isSpeakingRef.current = false;
          setConversationState('idle');
        }
        else if (event.type === 'response.audio.delta' || event.type === 'response.output_audio.delta') {
          // Recibiendo chunks de audio del agente (durante generación, no reproducción)
          console.log('[STATE] Recibiendo delta de audio');
          // No cambiar estado aquí, esperar a output_audio_buffer.started
        }
        else if (event.type === 'response.audio_transcript.delta' || event.type === 'response.output_audio_transcript.delta') {
          // Transcripción de audio en progreso
          console.log('[STATE] Transcripción en progreso');
          // No cambiar estado aquí
        }
        else if (event.type === 'response.audio.done' || event.type === 'response.output_audio.done') {
          // Audio del agente completado (generación, no reproducción)
          console.log('[STATE] Audio generado completamente (pero puede estar reproduciéndose)');
          // No resetear isSpeakingRef aquí, esperar a output_audio_buffer.stopped
        }
        else if (event.type === 'response.content_part.added') {
          // Nueva parte de contenido agregada
          const part = event.part;
          console.log('[STATE] Nueva parte de contenido:', part?.type);
          // No cambiar estado aquí
        }
        else if (event.type === 'response.done') {
          // Respuesta completada - solo cambiar a idle si NO está reproduciendo audio
          console.log('[STATE] Respuesta completada, isSpeaking:', isSpeakingRef.current);
          if (!isSpeakingRef.current) {
            setConversationState('idle');
          }
        }
        // Eventos de conversación
        else if (event.type === 'conversation.item.truncated') {
          // Audio interrumpido por el usuario
          console.log('[STATE] Audio interrumpido');
          isSpeakingRef.current = false;
          setConversationState('listening');
        }
        // Eventos de errores
        else if (event.type === 'error') {
          console.error('[TRANSPORT] Error:', event);
          setError(`Error: ${event.error?.message || 'Error desconocido'}`);
          setConversationState('error');
          isSpeakingRef.current = false;
        }
      });

      // 8. Conectar sesión con el token efímero
      await session.connect({
        apiKey: ephemeralToken,
      });

      sessionRef.current = session;
      setIsConnected(true);
      setConversationState('speaking'); // Iniciar en estado "hablando" porque el agente empezará

      console.log('[SESSION] Conectado exitosamente');
    } catch (err: any) {
      console.error('[SESSION] Error al conectar:', err);
      setError(err.message || 'Error al conectar con el conserje digital');
      setConversationState('error');
    }
  };

  /**
   * Desconecta la sesión
   */
  const disconnectSession = async () => {
    try {
      if (sessionRef.current) {
        await sessionRef.current.close();
        sessionRef.current = null;
      }

      if (sessionId) {
        await ConciergeAPI.endSession(sessionId, 'completed');
      }

      setIsConnected(false);
      setConversationState('idle');
      setSessionId(null);
      setCollectedData({});
      setTranscript([]);
      isSpeakingRef.current = false;

      console.log('[SESSION] Desconectado');
    } catch (err: any) {
      console.error('[SESSION] Error al desconectar:', err);
      setError(err.message);
    }
  };

  // Conectar WebSocket anónimamente al montar el componente (vista pública)
  useEffect(() => {
    console.log('[WEBSOCKET] Conectando WebSocket para conserje digital (modo anónimo)...');
    webSocketService.connectAnonymous();

    return () => {
      // Cleanup al desmontar
      if (sessionRef.current) {
        try {
          sessionRef.current.close();
        } catch (error) {
          console.error('[SESSION] Error en cleanup:', error);
        }
      }

      // Desconectar WebSocket al salir de la vista
      console.log('[WEBSOCKET] Desconectando WebSocket del conserje digital...');
      webSocketService.disconnect();
    };
  }, []);

  // Escuchar respuesta del residente en tiempo real vía Socket.IO
  useEffect(() => {
    console.log('[SESSION] 👂 useEffect del listener ejecutándose, sessionId:', sessionId);

    if (!sessionId) {
      console.warn('[SESSION] ⚠️ sessionId es null, listener NO se configurará');
      return;
    }

    console.log(`[SESSION] 🔔 Configurando listener para visitor:response:${sessionId}`);

    // Suscribirse al evento específico de esta sesión
    const handleResidentResponse = (data: any) => {
      console.log('[SESSION] ✅ Respuesta del residente recibida:', data);
      console.log('[SESSION] Aprobado:', data.approved);

      // Actualizar el estado de collectedData para que el agente sepa la respuesta
      setCollectedData((prev: CollectedData) => {
        const updated = {
          ...prev,
          residentResponse: data.approved ? ('approved' as const) : ('denied' as const),
        };
        console.log('[SESSION] CollectedData actualizado:', updated);
        return updated;
      });

      // NUEVO: Inyectar mensaje del sistema al agente para que reaccione inmediatamente
      if (sessionRef.current) {
        const systemMessage = data.approved
          ? '🔔 NOTIFICACIÓN DEL SISTEMA: El residente ha APROBADO la visita. Procede inmediatamente a dar la bienvenida al visitante y llamar a finalizar_llamada().'
          : '🔔 NOTIFICACIÓN DEL SISTEMA: El residente ha RECHAZADO la visita. Informa amablemente al visitante que no puede ingresar, despídete y llama a finalizar_llamada().';

        console.log('[SESSION] 📨 Inyectando mensaje del sistema al agente:', systemMessage);

        // Enviar mensaje del sistema para que el agente reaccione
        sessionRef.current.sendMessage({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: systemMessage }],
        });
      }

      // Agregar mensaje al transcript para que el usuario vea la actualización
      const responseMessage: TranscriptMessage = {
        id: `system-${Date.now()}`,
        role: 'assistant' as const,
        content: data.approved
          ? '✅ El residente ha APROBADO la visita'
          : '❌ El residente ha RECHAZADO la visita',
        timestamp: new Date(),
      };

      setTranscript((prev) => [...prev, responseMessage]);

      console.log('[SESSION] Transcript actualizado con respuesta del residente');

      // TIMEOUT DE SEGURIDAD: Finalizar llamada automáticamente después de 25 segundos
      // si el agente no llamó a finalizar_llamada() por alguna razón
      setTimeout(() => {
        console.log('[SESSION] ⏱️ Timeout alcanzado - finalizando llamada automáticamente');
        if (sessionRef.current) {
          disconnectSession();
        }
      }, 25000); // 25 segundos: tiempo suficiente para mensaje final + despedida
    };

    const eventName = `visitor:response:${sessionId}`;

    // Función para registrar el listener
    const registerListener = () => {
      const socket = webSocketService.getSocket();

      if (socket && socket.connected) {
        socket.on(eventName, handleResidentResponse);
        console.log(`[SESSION] ✅ Listener registrado para ${eventName}`);
        console.log(`[SESSION] Socket ID: ${socket.id}`);
        return true;
      } else {
        console.warn('[SESSION] ⚠️ Socket no disponible o no conectado al intentar registrar listener');
        console.warn('[SESSION] Socket:', socket ? 'existe' : 'null', 'Connected:', socket?.connected);
        return false;
      }
    };

    // Intentar registrar inmediatamente
    let registered = registerListener();

    // Si no se pudo registrar, intentar cada segundo hasta que el socket esté listo
    let retryInterval: NodeJS.Timeout | null = null;
    if (!registered) {
      console.log('[SESSION] ⏳ Esperando a que el socket esté conectado...');
      retryInterval = setInterval(() => {
        registered = registerListener();
        if (registered && retryInterval) {
          clearInterval(retryInterval);
          retryInterval = null;
        }
      }, 1000);
    }

    // Cleanup: remover listener cuando cambie sessionId o se desmonte
    return () => {
      if (retryInterval) {
        clearInterval(retryInterval);
      }

      const socket = webSocketService.getSocket();
      if (socket) {
        socket.off(eventName, handleResidentResponse);
        console.log(`[SESSION] 🧹 Listener removido para ${eventName}`);
      }
    };
  }, [sessionId]);

  return (
    <div className="h-screen overflow-auto bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-4">
      <div className="max-w-7xl mx-auto">

        {/* Error Alert */}
        {error && (
          <div className="mb-6 max-w-2xl mx-auto">
            <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl p-5 flex items-start gap-4 shadow-lg">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 dark:bg-red-900/50 rounded-lg flex items-center justify-center">
                <ExclamationCircleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <Subheading className="text-red-900 dark:text-red-100 mb-1">Error</Subheading>
                <Text className="text-red-700 dark:text-red-300">{error}</Text>
              </div>
            </div>
          </div>
        )}

        {/* Vista: Teclado Numérico (cuando NO está conectado) */}
        {!isConnected && !targetHouse && (
          <div className="flex justify-center items-center">
            <DialPad
              onCall={connectSession}
              disabled={conversationState === 'processing'}
            />
          </div>
        )}

        {/* Vista: Conversación (cuando está conectado O ya marcó) */}
        {(isConnected || targetHouse) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Panel Izquierdo: Estado y Controles */}
          <div className="space-y-6">
            {/* Estado de Conversación */}
            <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-8">
              <ConversationStatus
                state={conversationState}
                isConnected={isConnected}
              />

              {/* Visualizador de Audio */}
              <div className="mt-8">
                <AudioVisualizer
                  isActive={conversationState === 'listening' || conversationState === 'speaking'}
                  state={conversationState === 'listening' ? 'listening' : conversationState === 'speaking' ? 'speaking' : 'idle'}
                />
              </div>

              {/* Botones de Control */}
              <div className="mt-8 flex justify-center gap-4">
                {!isConnected ? (
                  <Button
                    color="zinc"
                    onClick={() => {
                      setTargetHouse(null);
                      setCollectedData({});
                      setError(null);
                    }}
                  >
                    Cambiar Casa
                  </Button>
                ) : (
                  <Button
                    color="red"
                    onClick={disconnectSession}
                  >
                    <PhoneXMarkIcon className="w-5 h-5" />
                    Finalizar Sesión
                  </Button>
                )}
              </div>
            </div>

            {/* Datos Recolectados */}
            <CollectedDataPanel data={collectedData} />
          </div>

          {/* Panel Derecho: Transcripción */}
          <div>
            <TranscriptDisplay messages={transcript} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
