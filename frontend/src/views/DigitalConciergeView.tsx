import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { RealtimeAgent, RealtimeSession, tool } from '@openai/agents/realtime';
import { ConciergeAPI, type RealtimeToolDefinition, type ToolExecutionResponse } from '@/api/ConciergeAPI';
import { kioskSocket } from '@/services/KioskSocketService';
import type { KioskCredential } from '@/services/kioskCredentialStore';
import { useKioskCredential } from '@/hooks/useKioskCredential';
import { useResidentResponseWatcher } from '@/hooks/useResidentResponseWatcher';
import { buildResidentOutcomeMessages, type KioskWaitOutcome } from '@/helpers/kioskResidentResponse';
import { getUserFacingErrorMessage } from '@/helpers/httpErrors';
import { describeNotifiedResidents, maskHubId } from '@/helpers/kiosk';
import { useLongPress } from '@/hooks/useLongPress';
import { KioskPairingScreen } from '@/components/concierge/KioskPairingScreen';
import { KioskUnpairPanel } from '@/components/concierge/KioskUnpairPanel';
import { ConversationStatus, type ConversationState } from '@/components/concierge/ConversationStatus';
import { CollectedDataPanel, type CollectedData } from '@/components/concierge/CollectedDataPanel';
import { AudioVisualizer } from '@/components/concierge/AudioVisualizer';
import { TranscriptDisplay, type TranscriptMessage } from '@/components/concierge/TranscriptDisplay';
import { DialPad } from '@/components/concierge/DialPad';
import { KioskPrivacyNotice } from '@/components/concierge/KioskPrivacyNotice';
import { PrivacyPolicyDialog } from '@/components/privacy/PrivacyPolicyDialog';
import { PhoneXMarkIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { Subheading } from '@/components/ui/Heading';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';

/** Margen para que el audio de despedida termine antes de cortar (el agente tarda ~3-5 s). */
const FINALIZE_CALL_DELAY_MS = 8_000;
/** Si el agente no llama a `finalizar_llamada()` tras la respuesta, se corta igual. */
const SAFETY_HANGUP_DELAY_MS = 25_000;
/**
 * Sin respuesta (sesión cerrada o espera vencida) la sesión ya terminó en el
 * backend y las tools fallan: alcanza para el mensaje de despedida.
 */
const UNANSWERED_HANGUP_DELAY_MS = 15_000;
/** Gesto de operador sobre el identificador del dispositivo para desemparejar. */
const UNPAIR_LONG_PRESS_MS = 3_000;

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

function clearTimer(timerRef: RefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

/** Texto visible de un item `message` del historial de Realtime. */
function messageText(content: unknown): string {
  if (!Array.isArray(content) || content.length === 0) {
    return '';
  }
  const first: unknown = content[0];
  if (!isRecord(first)) {
    return '';
  }

  const transcript = typeof first.transcript === 'string' ? first.transcript : '';
  switch (first.type) {
    // Las transcripciones están incluidas en el precio base de Realtime API.
    case 'input_audio':
      return transcript || '🎤 [Audio sin transcribir]';
    case 'output_audio':
      return transcript || '[Respuesta en progreso...]';
    case 'text':
      return typeof first.text === 'string' ? first.text : '';
    default:
      return '';
  }
}

/**
 * Historial de Realtime → transcript del kiosko. Los mensajes de sistema que
 * se inyectan al agente (`input_text`) no tienen texto visible y quedan fuera.
 */
function historyToTranscript(history: readonly unknown[]): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];

  for (const item of history) {
    if (!isRecord(item) || item.type !== 'message') {
      continue;
    }
    const role = item.role;
    if (role !== 'user' && role !== 'assistant') {
      continue;
    }
    const content = messageText(item.content);
    if (content.trim() === '') {
      continue;
    }
    messages.push({
      id: `msg-${String(item.itemId)}`,
      role,
      content,
      timestamp: new Date(),
    });
  }

  return messages;
}

function describeTransportError(event: unknown): string {
  if (isRecord(event) && isRecord(event.error) && typeof event.error.message === 'string') {
    return event.error.message;
  }
  return 'Error desconocido';
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
      let result: ToolExecutionResponse;
      try {
        result = await ConciergeAPI.executeTool(sessionId, definition.name, parameters);
      } catch {
        // P. ej. la sesión ya terminó en el backend (espera vencida): el agente
        // recibe un error y la llamada se corta por el timer de seguridad.
        return JSON.stringify({ error: 'La herramienta no está disponible en este momento.' });
      }
      onResult(definition.name, result);

      return JSON.stringify(result.success ? (result.data ?? {}) : { error: result.error });
    },
  });
}

/**
 * Kiosko del Conserje Digital (`/digital-concierge`, vista pública).
 *
 * El kiosko es un DEVICE `web-kiosk` del condominio, no un usuario humano.
 * Sin credencial emparejada muestra la pantalla de emparejamiento; un 401 del
 * backend la borra y vuelve a esa pantalla (ver `ConciergeAPI`).
 */
export function DigitalConciergeView() {
  const credential = useKioskCredential();

  if (!credential) {
    return <KioskPairingScreen />;
  }

  return <KioskConcierge key={credential.hubId} credential={credential} />;
}

interface KioskConciergeProps {
  credential: KioskCredential;
}

function KioskConcierge({ credential }: KioskConciergeProps) {
  // Estado de la sesión
  const [conversationState, setConversationState] = useState<ConversationState>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetHouse, setTargetHouse] = useState<string | null>(null); // Casa marcada desde el DialPad
  // Casa marcada que espera el "Continuar" del aviso de privacidad (antes del micrófono).
  const [consentHouse, setConsentHouse] = useState<string | null>(null);
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [awaitingResident, setAwaitingResident] = useState(false);
  const [isUnpairOpen, setIsUnpairOpen] = useState(false);
  const unpairGesture = useLongPress(() => setIsUnpairOpen(true), UNPAIR_LONG_PRESS_MS);

  // Datos recolectados y transcripción
  const [collectedData, setCollectedData] = useState<CollectedData>({});
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  // Avisos del sistema: aparte del historial, que `history_updated` reemplaza entero.
  const [systemNotices, setSystemNotices] = useState<TranscriptMessage[]>([]);

  // Referencias (valores que leen los closures del SDK y los timers)
  const mountedRef = useRef(true);
  const sessionRef = useRef<RealtimeSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isSpeakingRef = useRef(false); // Si el agente está reproduciendo audio
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyHangupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cada intento de conexión tiene un número; "Cambiar Casa" o desmontar lo invalidan.
  const connectAttemptRef = useRef(0);

  /** Cierra la sesión en el backend, una sola vez (expira la solicitud pendiente). */
  const endBackendSession = useCallback(async (finalStatus: 'completed' | 'cancelled' | 'timeout') => {
    const currentSessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (currentSessionId) {
      await ConciergeAPI.endSession(currentSessionId, finalStatus);
    }
  }, []);

  /** Desconecta la sesión de voz y cierra la sesión en el backend. */
  const disconnectSession = useCallback(async () => {
    clearTimer(finalizeTimerRef);
    clearTimer(safetyHangupTimerRef);

    const realtimeSession = sessionRef.current;
    sessionRef.current = null;

    setIsConnected(false);
    setConversationState('idle');
    setSessionId(null);
    setAwaitingResident(false);
    setCollectedData({});
    setTranscript([]);
    setSystemNotices([]);
    isSpeakingRef.current = false;

    try {
      realtimeSession?.close();
    } catch {
      // La sesión de voz ya estaba cerrada.
    }

    try {
      await endBackendSession('completed');
    } catch (err) {
      if (mountedRef.current) {
        setError(getUserFacingErrorMessage(err, 'No se pudo cerrar la sesión del conserje'));
      }
    }
  }, [endBackendSession]);

  /**
   * Sincroniza los paneles de UI (datos recolectados / espera de respuesta /
   * fin de llamada) con el resultado de una tool ejecutada en el backend. Es
   * lógica de presentación: el backend solo devuelve `{ success, data, error }`.
   */
  const applyToolResultToUi = (toolName: string, result: ToolExecutionResponse) => {
    if (!result.success || !isRecord(result.data)) {
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
        // El kiosko recibe ids y conteo, nunca nombres: solo se toma el código
        // exacto de la casa ("303" -> "A-303") para el panel.
        if (data.encontrado === true && typeof data.casa === 'string' && data.casa.trim() !== '') {
          const house = data.casa.trim();
          setCollectedData((prev) => ({ ...prev, destinationHouse: house }));
        }
        break;
      }
      case 'notificar_residente': {
        // Solo con la notificación efectivamente enviada hay una respuesta que esperar.
        if (data.notificado !== true) break;
        const notifiedCount =
          typeof data.cantidad_notificados === 'number' ? data.cantidad_notificados : undefined;
        setCollectedData((prev) => ({
          ...prev,
          residentName: describeNotifiedResidents(prev.destinationHouse, notifiedCount),
          residentResponse: 'pending',
        }));
        // Desde acá se espera la respuesta: socket + polling, con espera máxima.
        setAwaitingResident(true);
        break;
      }
      case 'reenviar_notificacion': {
        // Un reenvío exitoso le da al residente una ventana completa para
        // responder; uno fallido no cambia la espera.
        if (data.reenviado === true) {
          restartResidentWait();
        }
        break;
      }
      case 'finalizar_llamada': {
        if (data.finalizada === true) {
          clearTimer(finalizeTimerRef);
          finalizeTimerRef.current = setTimeout(() => {
            finalizeTimerRef.current = null;
            void disconnectSession();
          }, FINALIZE_CALL_DELAY_MS);
        }
        break;
      }
      default:
        break;
    }
  };

  /**
   * Fin de la espera (llega una sola vez): respuesta del residente por socket
   * o polling, sesión cerrada sin respuesta, o espera máxima vencida.
   * Fail-closed: solo `admitted` (acceso efectivo) instruye la bienvenida; ver
   * `buildResidentOutcomeMessages`. En todos los casos la llamada se corta.
   */
  const handleResidentOutcome = (outcome: KioskWaitOutcome) => {
    const messages = buildResidentOutcomeMessages(outcome);
    const unanswered = outcome === 'closed' || outcome === 'no-response';

    if (outcome === 'no-response') {
      // Se cierra ya en el backend: la solicitud expira y una aprobación
      // tardía responde 409, sin abrir para nadie.
      void endBackendSession('timeout').catch(() => undefined);
    } else if (outcome === 'closed') {
      // El backend ya dio la sesión por terminada: no queda nada que cerrar.
      sessionIdRef.current = null;
    }

    setAwaitingResident(false);
    setCollectedData((prev) => ({ ...prev, residentResponse: messages.panelResponse }));
    setSystemNotices((prev) => [
      ...prev,
      {
        id: `system-${Date.now()}`,
        role: 'assistant',
        content: messages.transcript,
        timestamp: new Date(),
      },
    ]);

    try {
      sessionRef.current?.sendMessage({
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: messages.agentInstruction }],
      });
    } catch {
      // Sin canal de voz abierto: el visitante igual ve el aviso en pantalla.
    }

    // Corte garantizado aunque el agente no llame a `finalizar_llamada()`.
    clearTimer(safetyHangupTimerRef);
    safetyHangupTimerRef.current = setTimeout(
      () => {
        safetyHangupTimerRef.current = null;
        void disconnectSession();
      },
      unanswered ? UNANSWERED_HANGUP_DELAY_MS : SAFETY_HANGUP_DELAY_MS,
    );
  };

  const { restartMaxWait: restartResidentWait } = useResidentResponseWatcher({
    sessionId,
    awaitingResponse: awaitingResident,
    onOutcome: handleResidentOutcome,
  });

  /**
   * Inicializa y conecta la sesión del conserje digital
   * @param houseNumber Número de casa marcado desde el DialPad
   */
  const connectSession = async (houseNumber: string) => {
    const attempt = connectAttemptRef.current + 1;
    connectAttemptRef.current = attempt;
    // Sigue vigente si la vista está montada y nadie lo canceló ("Cambiar Casa").
    const isCurrentAttempt = () => mountedRef.current && connectAttemptRef.current === attempt;
    let startedSessionId: string | null = null;
    let realtimeSession: RealtimeSession | null = null;

    /**
     * Cierra la sesión del backend de ESTE intento si todavía es la vigente
     * (si ya la cerró "Cambiar Casa" o el desmontaje, `sessionIdRef` no la tiene).
     */
    const releaseStartedSession = () => {
      if (startedSessionId !== null && sessionIdRef.current === startedSessionId) {
        void endBackendSession('cancelled').catch(() => undefined);
      }
    };

    // El panel de desemparejar no debe reaparecer al volver al teclado.
    setIsUnpairOpen(false);

    try {
      setError(null);
      setConversationState('processing');

      // 0. Permisos de micrófono ANTES de cualquier cosa (y solo tras el "Continuar" del aviso)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Se detiene de inmediato: el SDK abre su propio stream
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        if (!isCurrentAttempt()) {
          return;
        }
        setConsentHouse(null);
        setError('No se pudo acceder al micrófono. Por favor, permite el acceso al micrófono.');
        setConversationState('error');
        return;
      }
      // "Cancelar" mientras el navegador pedía el permiso: no se abre nada.
      if (!isCurrentAttempt()) {
        return;
      }

      // 1. Casa marcada
      setConsentHouse(null);
      setTargetHouse(houseNumber);

      // 2. Token efímero; el socketId es el del socket del kiosko en `/hub`
      const { sessionId: newSessionId, ephemeralToken } = await ConciergeAPI.startSession(
        kioskSocket.getSocketId(),
      );
      if (!isCurrentAttempt()) {
        // Cancelado mientras se creaba: la sesión nueva no debe quedar ACTIVE.
        void ConciergeAPI.endSession(newSessionId, 'cancelled').catch(() => undefined);
        return;
      }
      startedSessionId = newSessionId;
      sessionIdRef.current = newSessionId;
      setSessionId(newSessionId);
      setAwaitingResident(false);
      setSystemNotices([]);

      // 3. Casa de destino pre-cargada
      setCollectedData({ destinationHouse: houseNumber });

      // 4. Configuración del agente (prompt + tools): única fuente de verdad, el backend
      const { instructions, tools: toolDefinitions } = await ConciergeAPI.getAgentConfig(houseNumber);
      if (!isCurrentAttempt()) {
        releaseStartedSession();
        return;
      }

      // 5. Tools "delgadas": reenvían a execute-tool y aplican el resultado a la UI
      const realtimeTools = toolDefinitions.map((definition) =>
        buildRealtimeTool(definition, newSessionId, applyToolResultToUi),
      );

      const agent = new RealtimeAgent({
        name: 'Conserje Digital',
        instructions,
        voice: 'sage',
        tools: realtimeTools,
      });

      // 6. Sesión de Realtime con WebRTC (gpt-realtime-mini, GA)
      const session = new RealtimeSession(agent, {
        model: 'gpt-realtime-mini',
        config: {
          modalities: ['audio'],
          inputAudioFormat: 'pcm16',
          outputAudioFormat: 'pcm16',
          inputAudioTranscription: {
            model: 'whisper-1',
            language: 'es',
          },
          turnDetection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      });
      realtimeSession = session;

      // 7. Eventos de la sesión
      session.on('history_updated', (history) => {
        setTranscript(historyToTranscript(history));
      });

      session.on('audio_interrupted', () => {
        setConversationState('listening');
      });

      // Eventos de transporte de bajo nivel (estados de audio)
      session.on('transport_event', (event) => {
        switch (event.type) {
          case 'input_audio_buffer.speech_started':
            isSpeakingRef.current = false;
            setConversationState('listening');
            break;
          case 'input_audio_buffer.speech_stopped':
          case 'input_audio_buffer.committed':
            setConversationState('processing');
            break;
          case 'output_audio_buffer.started':
            isSpeakingRef.current = true;
            setConversationState('speaking');
            break;
          case 'output_audio_buffer.stopped':
          case 'output_audio_buffer.cleared':
            isSpeakingRef.current = false;
            setConversationState('idle');
            break;
          case 'response.done':
            // Solo vuelve a idle si NO está reproduciendo audio
            if (!isSpeakingRef.current) {
              setConversationState('idle');
            }
            break;
          case 'conversation.item.truncated':
            // Audio interrumpido por el visitante
            isSpeakingRef.current = false;
            setConversationState('listening');
            break;
          case 'error':
            isSpeakingRef.current = false;
            setError(`Error: ${describeTransportError(event)}`);
            setConversationState('error');
            break;
          default:
            break;
        }
      });

      // 8. Conectar con el token efímero
      await session.connect({
        apiKey: ephemeralToken,
      });

      // Cancelado o desmontado durante la conexión (p. ej. un 401 desemparejó el kiosko).
      if (!isCurrentAttempt()) {
        session.close();
        releaseStartedSession();
        return;
      }

      sessionRef.current = session;
      setIsConnected(true);
      setConversationState('speaking'); // El agente habla primero
    } catch (err) {
      // Falló después de crear la sesión (p. ej. 429 en agent-config o error al
      // conectar la voz): se cierra todo para que la sesión no quede ACTIVE.
      try {
        realtimeSession?.close();
      } catch {
        // La sesión de voz no llegó a abrirse.
      }
      releaseStartedSession();

      if (!isCurrentAttempt()) {
        return;
      }
      setSessionId(null);
      setError(getUserFacingErrorMessage(err, 'Error al conectar con el conserje digital'));
      setConversationState('error');
    }
  };

  /**
   * "Cambiar Casa": vuelve al teclado. Invalida un intento de conexión en
   * curso y cierra la sesión del backend si quedó una abierta.
   */
  const handleChangeHouse = () => {
    connectAttemptRef.current += 1;
    void endBackendSession('cancelled').catch(() => undefined);
    setSessionId(null);
    setAwaitingResident(false);
    setSystemNotices([]);
    setTranscript([]);
    setTargetHouse(null);
    setConsentHouse(null);
    setCollectedData({});
    setError(null);
    setConversationState('idle');
  };

  /**
   * El visitante marcó una casa: primero el aviso de privacidad (§5.2). El
   * micrófono y la sesión se piden recién con "Continuar".
   */
  const handleDial = (houseNumber: string) => {
    setIsUnpairOpen(false);
    setIsPolicyOpen(false);
    setError(null);
    setConsentHouse(houseNumber);
  };

  const handleConsentContinue = () => {
    if (consentHouse !== null) {
      void connectSession(consentHouse);
    }
  };

  /** "Cancelar" el aviso: vuelve al teclado sin sesión (invalida un permiso en curso). */
  const handleConsentCancel = useCallback(() => {
    connectAttemptRef.current += 1;
    setConsentHouse(null);
    setConversationState('idle');
  }, []);

  // Socket del kiosko en `/hub` mientras la vista esté montada con esta credencial.
  useEffect(() => {
    kioskSocket.connect(credential);
    return () => {
      kioskSocket.disconnect();
    };
  }, [credential]);

  // Limpieza al desmontar: timers, sesión de voz y sesión del backend abierta.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimer(finalizeTimerRef);
      clearTimer(safetyHangupTimerRef);
      const realtimeSession = sessionRef.current;
      sessionRef.current = null;
      try {
        realtimeSession?.close();
      } catch {
        // La sesión de voz ya estaba cerrada.
      }
      // Best-effort: tras un 401 ya no hay credencial y esto falla en silencio.
      void endBackendSession('cancelled').catch(() => undefined);
    };
  }, [endBackendSession]);

  const displayedTranscript = systemNotices.length > 0 ? [...transcript, ...systemNotices] : transcript;
  const isIdleAtDialPad = !isConnected && !targetHouse;

  return (
    <div className="h-screen overflow-auto bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-950 p-4">
      <div className="max-w-7xl mx-auto">

        {/* Error Alert */}
        {error && (
          <div className="mb-6 max-w-2xl mx-auto">
            <div role="alert" className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl p-5 flex items-start gap-4 shadow-lg">
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

        {/* Vista: Aviso de privacidad (casa marcada, antes del micrófono) */}
        {isIdleAtDialPad && consentHouse !== null && (
          <KioskPrivacyNotice
            houseNumber={consentHouse}
            isStarting={conversationState === 'processing'}
            onContinue={handleConsentContinue}
            onCancel={handleConsentCancel}
          />
        )}

        {/* Vista: Teclado Numérico (cuando NO está conectado) */}
        {isIdleAtDialPad && consentHouse === null && (
          <div className="flex flex-col items-center">
            <DialPad
              onCall={handleDial}
              disabled={conversationState === 'processing'}
            />

            <button
              type="button"
              onClick={() => setIsPolicyOpen(true)}
              className="mt-8 rounded-md px-2 py-1 text-sm font-medium text-zinc-500 underline decoration-zinc-400/50 underline-offset-4 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Aviso de privacidad
            </button>
            <PrivacyPolicyDialog open={isPolicyOpen} onClose={() => setIsPolicyOpen(false)} />

            {/*
              Desemparejar: gesto de operador sin pista visible (mantener
              presionado el identificador ~3 s) y luego el secret actual.
              El hubId va enmascarado: el visitante no lee el identificador.
            */}
            <p
              {...unpairGesture}
              tabIndex={0}
              // touch-none: un leve movimiento del dedo no dispara `pointercancel` (scroll/pan del navegador).
              className="mt-6 touch-none font-mono text-[0.7rem] text-zinc-400 select-none [-webkit-touch-callout:none] dark:text-zinc-500"
            >
              Dispositivo {maskHubId(credential.hubId)}
            </p>

            {isUnpairOpen && (
              <KioskUnpairPanel credential={credential} onCancel={() => setIsUnpairOpen(false)} />
            )}
          </div>
        )}

        {/* Vista: Conversación (cuando está conectado O ya marcó) */}
        {!isIdleAtDialPad && (
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
                  <Button color="zinc" onClick={handleChangeHouse}>
                    Cambiar Casa
                  </Button>
                ) : (
                  <Button
                    color="red"
                    onClick={() => {
                      void disconnectSession();
                    }}
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
            <TranscriptDisplay messages={displayedTranscript} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
