import { useState, useEffect, useRef } from 'react';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { z } from 'zod';
import { ConciergeAPI } from '@/api/ConciergeAPI';
import { webSocketService } from '@/services/WebSocketService';
import { ConversationStatus, type ConversationState } from '@/components/concierge/ConversationStatus';
import { CollectedDataPanel, type CollectedData } from '@/components/concierge/CollectedDataPanel';
import { AudioVisualizer } from '@/components/concierge/AudioVisualizer';
import { TranscriptDisplay, type TranscriptMessage } from '@/components/concierge/TranscriptDisplay';
import { DialPad } from '@/components/concierge/DialPad';
import { PhoneXMarkIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { formatRUT, isValidRUT, looksLikeRUT } from '../helpers';
import { Subheading } from '@/components/ui/Heading';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

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

      // 4. Definir herramientas (function calling)
      const guardarDatosTool = tool({
        name: 'guardar_datos_visitante',
        description: 'Guarda y formatea automáticamente los datos del visitante. El RUT se formatea a XX.XXX.XXX-X, el teléfono se limpia de caracteres especiales, y la patente se normaliza a mayúsculas.',
        parameters: z.object({
          nombre: z.string().optional().describe('Nombre completo del visitante tal como lo dijo'),
          rut: z.string().optional().describe('RUT o pasaporte del visitante en cualquier formato (números, con/sin puntos o guión)'),
          telefono: z.string().optional().describe('Teléfono del visitante en cualquier formato'),
          patente: z.string().optional().describe('Patente del vehículo en cualquier formato'),
          motivo: z.string().optional().describe('Motivo de la visita'),
          casa: z.string().optional().describe('Número de casa/departamento de destino'),
        }),
        async execute(params) {
          console.log('[TOOL] guardar_datos_visitante (raw):', params);
          
          // Formatear y validar los datos
          const formattedData: any = {};
          let validationMessage = '';
          
          // Formatear nombre (capitalizar)
          if (params.nombre) {
            formattedData.nombre = params.nombre
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
          }
          
          // Formatear y validar RUT
          if (params.rut) {
            const cleanRut = params.rut.replace(/\s/g, '');
            
            // Verificar si parece un RUT chileno
            if (looksLikeRUT(cleanRut)) {
              // Validar RUT chileno
              if (isValidRUT(cleanRut)) {
                formattedData.rut = formatRUT(cleanRut);
                validationMessage += `RUT validado y formateado correctamente a ${formattedData.rut}. `;
              } else {
                // RUT inválido - pedir confirmación
                return JSON.stringify({
                  error: true,
                  mensaje: `El RUT "${params.rut}" no parece ser válido. Por favor, pídele al visitante que lo repita nuevamente. Asegúrate de escuchar bien cada dígito y el dígito verificador.`,
                  accion_requerida: 'pedir_rut_nuevamente',
                });
              }
            } else {
              // No parece RUT, asumir pasaporte/DNI extranjero
              formattedData.rut = cleanRut.toUpperCase();
              validationMessage += `Identificación registrada como pasaporte/DNI extranjero: ${formattedData.rut}. `;
            }
          }
          
          // Formatear teléfono (limpiar y validar)
          if (params.telefono) {
            // Limpiar todo excepto números y +
            let cleanPhone = params.telefono.replace(/[^\d+]/g, '');
            
            // Remover + inicial si existe para procesar
            const hasPlus = cleanPhone.startsWith('+');
            if (hasPlus) {
              cleanPhone = cleanPhone.substring(1);
            }
            
            // Casos de formato para teléfonos chilenos:
            // 1. +56964760511 (11 dígitos con código país)
            // 2. 56964760511 (11 dígitos sin +)
            // 3. 964760511 (9 dígitos - móvil con 9)
            // 4. 64760511 (8 dígitos - móvil sin 9)
            
            if (cleanPhone.startsWith('56')) {
              // Ya tiene código de país Chile (56)
              if (cleanPhone.length === 11) {
                // +56964760511 o 56964760511
                formattedData.telefono = `+${cleanPhone}`;
              } else if (cleanPhone.length === 10) {
                // 5664760511 (falta el 9)
                formattedData.telefono = `+569${cleanPhone.substring(2)}`;
              } else {
                // Formato inválido, guardar como está
                formattedData.telefono = `+${cleanPhone}`;
              }
            } else if (cleanPhone.startsWith('9') && cleanPhone.length === 9) {
              // 964760511 - móvil completo sin código país
              formattedData.telefono = `+56${cleanPhone}`;
            } else if (cleanPhone.length === 8) {
              // 64760511 - móvil sin el 9 inicial
              formattedData.telefono = `+569${cleanPhone}`;
            } else if (cleanPhone.length === 9 && !cleanPhone.startsWith('9')) {
              // Número de 9 dígitos que no empieza con 9 (formato antiguo o error)
              formattedData.telefono = `+56${cleanPhone}`;
            } else {
              // Cualquier otro caso, agregar código país
              formattedData.telefono = `+56${cleanPhone}`;
            }
            
            validationMessage += `Teléfono formateado a ${formattedData.telefono}. `;
          }
          
          // Formatear patente (mayúsculas, sin espacios)
          if (params.patente) {
            formattedData.patente = params.patente
              .replace(/\s/g, '')
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, '');
            
            validationMessage += `Patente registrada: ${formattedData.patente}. `;
          }
          
          // Otros campos sin formateo especial
          if (params.motivo) formattedData.motivo = params.motivo;
          if (params.casa) formattedData.casa = params.casa;
          
          console.log('[TOOL] guardar_datos_visitante (formatted):', formattedData);
          
          // Actualizar datos locales
          setCollectedData((prev: CollectedData) => ({
            ...prev,
            visitorName: formattedData.nombre || prev.visitorName,
            visitorRut: formattedData.rut || prev.visitorRut,
            visitorPhone: formattedData.telefono || prev.visitorPhone,
            vehiclePlate: formattedData.patente || prev.vehiclePlate,
            visitReason: formattedData.motivo || prev.visitReason,
            destinationHouse: formattedData.casa || prev.destinationHouse,
          }));

          // Llamar al backend con datos formateados
          const result = await ConciergeAPI.executeTool(newSessionId, 'guardar_datos_visitante', formattedData);
          
          // Retornar confirmación con datos formateados
          return JSON.stringify({
            ...result.data,
            mensaje: validationMessage || 'Datos guardados correctamente',
            datos_formateados: formattedData,
          });
        },
      });

      const buscarResidenteTool = tool({
        name: 'buscar_residente',
        description: 'Busca un residente por número o código de casa/departamento. Acepta múltiples formatos: números solos ("15"), con prefijos ("Casa 15"), o códigos alfanuméricos ("A-1234", "B-201"). Devuelve TODOS los residentes de la familia.',
        parameters: z.object({
          casa: z.string().describe('Número, código o nombre de casa/departamento tal como lo dijo el visitante'),
        }),
        async execute(params) {
          console.log('[TOOL] buscar_residente:', params);
          const result = await ConciergeAPI.executeTool(newSessionId, 'buscar_residente', params);
          
          if (result.data?.encontrado && result.data?.residentes) {
            // Guardar nombres de todos los residentes encontrados
            const residentNames = result.data.residentes.map((r: any) => r.nombre).join(', ');
            setCollectedData((prev: CollectedData) => ({
              ...prev,
              residentName: residentNames,
            }));
          }
          
          return JSON.stringify(result.data);
        },
      });

      const notificarResidenteTool = tool({
        name: 'notificar_residente',
        description: 'Envía una notificación push a TODOS los residentes de la familia para que aprueben o rechacen la visita',
        parameters: z.object({
          residentes_ids: z.array(z.string()).describe('Array con los IDs de TODOS los residentes a notificar (todos los miembros de la familia)'),
        }),
        async execute(params) {
          console.log('[TOOL] notificar_residente:', params);
          
          setCollectedData((prev: CollectedData) => ({
            ...prev,
            residentResponse: 'pending',
          }));

          const result = await ConciergeAPI.executeTool(newSessionId, 'notificar_residente', params);
          return JSON.stringify(result.data);
        },
      });





      const finalizarLlamadaTool = tool({
        name: 'finalizar_llamada',
        description: 'Finaliza la llamada con el visitante. Usa esta herramienta SOLO después de despedirte completamente. NO menciones que estás finalizando la llamada, solo despídete naturalmente.',
        parameters: z.object({}),
        async execute() {
          console.log('[TOOL] finalizar_llamada - Esperando a que termine el audio...');
          
          // Dar tiempo suficiente para que el audio de despedida se reproduzca completamente
          // El agente tarda ~3-5 segundos en decir una despedida completa
          setTimeout(() => {
            console.log('[SESSION] ✅ Finalizando llamada por solicitud del agente...');
            disconnectSession();
          }, 8000); // 8 segundos para que termine de hablar
          
          return JSON.stringify({
            finalizada: true,
            mensaje: 'OK. La llamada se cerrará automáticamente.',
          });
        },
      });

      // 5. Configurar el agente con instrucciones y herramientas
      const agent = new RealtimeAgent({
        name: 'Conserje Digital',
        instructions: `Eres Sofía, la conserje del Condominio San Lorenzo. Eres amable, cálida y conversacional. Tu trabajo es ayudar a los visitantes a ingresar al condominio de manera eficiente pero siempre con una sonrisa en la voz.

INFORMACIÓN INICIAL:
- El visitante ya marcó la casa de destino: ${houseNumber}
- YA conoces a dónde va, NO preguntes por la casa/departamento nuevamente

PERSONALIDAD:
- Habla de manera natural y amigable, como si conversaras con un vecino
- Usa expresiones chilenas cotidianas: "¿Cómo estás?", "Perfecto", "Genial", "Súper"
- Sé paciente y empática, especialmente si el visitante parece confundido
- Haz que la conversación fluya naturalmente, no como un formulario robótico

FLUJO DE CONVERSACIÓN (SIGUE ESTE ORDEN ESTRICTAMENTE):

1. SALUDO INICIAL (di esto EXACTAMENTE una sola vez):
   "¡Hola! Bienvenido al Condominio San Lorenzo. Mi nombre es Sofía y soy la conserje. Veo que deseas visitar la casa ${houseNumber}. ¿Cómo te llamas?"

2. RECOPILACIÓN DE DATOS (UNO POR UNO, en este orden):
   
   a) Nombre:
      - Espera la respuesta
      - Guarda con guardar_datos_visitante(nombre: "...")
      - Di: "Encantada [nombre]. ¿Me podrías dar tu RUT o pasaporte por favor?"
   
   b) RUT/Pasaporte:
      - Espera la respuesta
      - Guarda con guardar_datos_visitante(rut: "...")
      - Si el sistema responde con error (RUT inválido):
        * Di amablemente: "Disculpa, el RUT que escuché no parece ser válido. ¿Me lo podrías repetir por favor? Dilo dígito por dígito si es necesario."
        * Vuelve a intentar guardar el RUT
      - Si se guarda correctamente, di: "Perfecto. ¿Y un número de teléfono de contacto?"
   
   c) Teléfono:
      - Espera la respuesta
      - Guarda con guardar_datos_visitante(telefono: "...")
      - Di: "Genial. ¿Vienes en vehículo?"
   
   d) Vehículo (PREGUNTA PRIMERO):
      - Si dice SÍ: "¿Me podrías decir la patente del vehículo?"
        * Espera la respuesta
        * Guarda con guardar_datos_visitante(patente: "...")
      - Si dice NO: "Vale, sin problema."
        * NO preguntes por patente
        * NO llames a guardar_datos_visitante con el campo patente
        * Simplemente omite este dato y continúa
      - Luego di: "¿Cuál es el motivo de tu visita?"
   
   e) Motivo:
      - Espera la respuesta
      - Guarda con guardar_datos_visitante(motivo: "...")
      - Di: "Excelente, déjame buscar al residente."

3. BÚSQUEDA Y NOTIFICACIÓN:
   - Llama buscar_residente(casa: "${houseNumber}")
   - Si encuentra residentes:
     * El sistema devuelve un array "residentes" con TODOS los miembros de la familia
     * Extrae los IDs de TODOS los residentes del array
     * Llama notificar_residente(residentes_ids: ["id1", "id2", ...]) con TODOS los IDs
     * IMPORTANTE: Al llamar notificar_residente, la visita se crea AUTOMÁTICAMENTE en estado pendiente
     * Si hay múltiples residentes, di: "Perfecto, le he enviado una notificación a todos los residentes de la casa. Estoy esperando su respuesta."
     * Si hay un solo residente, di: "Perfecto, le he enviado una notificación a [nombre del residente]. Estoy esperando su respuesta."
   - Si NO encuentra:
     * Di: "Lo siento, no encuentro registrado a ningún residente en la casa ${houseNumber}. ¿Estás seguro del número?"

4. ESPERA DE RESPUESTA:
   - Después de decir que estás esperando, NO digas NADA más
   - NO menciones palabras como "silencio", "espera en silencio", etc.
   - Simplemente DETENTE y espera
   - El SISTEMA te enviará automáticamente un mensaje cuando el residente responda

5. RESPUESTA DEL RESIDENTE (cuando recibas la notificación del sistema):
   - Si APROBÓ:
     * La visita YA FUE CREADA y ahora está ACTIVA automáticamente
     * NO necesitas llamar ninguna herramienta adicional
     * Di con entusiasmo: "¡Buenas noticias [nombre]! El residente ha aprobado tu visita. Puedes ingresar al condominio. ¡Que tengas un excelente día!"
     * INMEDIATAMENTE después de este mensaje, llama finalizar_llamada()
   - Si RECHAZÓ:
     * La visita fue automáticamente marcada como RECHAZADA
     * NO necesitas llamar ninguna herramienta adicional
     * Di con empatía: "Lo lamento [nombre], pero el residente no puede recibirte en este momento. Te sugiero contactarlo directamente. Que tengas buen día."
     * INMEDIATAMENTE después de este mensaje, llama finalizar_llamada()

IMPORTANTE: Después de dar el mensaje de aprobación o rechazo, DEBES llamar a finalizar_llamada() sin decir nada más. No esperes respuesta del visitante.

REGLAS IMPORTANTES:
- NO te saltes pasos del flujo
- NO repitas preguntas que ya hiciste
- Espera la respuesta del visitante antes de continuar
- Guarda cada dato INMEDIATAMENTE después de recibirlo
- SIEMPRE incluye casa: "${houseNumber}" al guardar datos
- NO inventes respuestas del residente
- Después de notificar, espera EN SILENCIO (no digas que estás en silencio)
- Acepta datos en cualquier formato (el sistema los formatea automáticamente)`,
        voice: 'sage',
        tools: [guardarDatosTool, buscarResidenteTool, notificarResidenteTool, finalizarLlamadaTool],
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
