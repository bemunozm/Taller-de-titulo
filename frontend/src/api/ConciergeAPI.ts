import api from '@/lib/axios';

export interface ConciergeSessionResponse {
  sessionId: string;
  ephemeralToken: string;
  expiresAt: string;
}

export interface ToolExecutionRequest {
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Definición de una tool tal como la expone `POST /concierge/agent-config/:houseNumber`
 * (backend/src/agent/tool-definitions.util.ts::RealtimeToolDefinition). El
 * `parameters` es el JSON Schema derivado del `inputSchema` (zod) de cada
 * `VigiliaTool` — el backend es la única fuente de verdad, el cliente solo
 * lo reenvía tal cual al SDK de Realtime.
 */
export interface RealtimeToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Respuesta de `POST /concierge/agent-config/:houseNumber` (Fase 1, Bloque
 * A2b/"clientes delgados"): system prompt + definiciones de tools, ambos
 * derivados del backend — el cliente deja de hardcodear cualquiera de los dos.
 */
export interface AgentConfigResponse {
  instructions: string;
  tools: RealtimeToolDefinition[];
}

export interface EndSessionRequest {
  finalStatus?: 'completed' | 'cancelled' | 'timeout';
}

export interface EndSessionResponse {
  sessionId: string;
  status: string;
  duration: number;
  visitCreated: boolean;
}

/**
 * Credenciales de hub del kiosko-web (`web-kiosk`, aprovisionado vía
 * `POST /hubs` en el backend — ver `frontend/.env.example`). El totem se
 * autentica ante `ConciergeAuthGuard`/`HubAuthGuard` con los MISMOS headers
 * que ya usa `vigilia-hub` (`X-Hub-Secret` + `X-Hub-Id`, ver
 * `vigilia-hub/src/services/concierge-client.service.ts#hubHeaders`) — no un
 * mecanismo nuevo. Se leen de env (`import.meta.env`, nunca hardcodeadas) y
 * se validan acá para fallar temprano y explícito si el totem no fue
 * provisionado, en vez de dejar que cada llamada reviente en un 401 opaco.
 *
 * NOTA DE SEGURIDAD: un secret embebido en el bundle web es extraíble por
 * cualquiera con acceso al totem (DevTools, bundle servido, etc.). Es
 * aceptable SOLO porque este kiosko es un dispositivo dedicado con acceso
 * físico controlado (conserjería/entrada del condominio) — NUNCA usar este
 * patrón para una vista pública accesible desde internet sin control físico.
 */
function getKioskHubHeaders(): Record<string, string> {
  const hubId = import.meta.env.VITE_KIOSK_HUB_ID as string | undefined;
  const hubSecret = import.meta.env.VITE_KIOSK_HUB_SECRET as string | undefined;

  if (!hubId || !hubSecret) {
    throw new Error(
      'Faltan las credenciales de hub del kiosko (VITE_KIOSK_HUB_ID / VITE_KIOSK_HUB_SECRET). ' +
        'El totem del conserje digital necesita estas variables de entorno para autenticarse ' +
        'contra el backend — ver frontend/.env.example.'
    );
  }

  return {
    'X-Hub-Secret': hubSecret,
    'X-Hub-Id': hubId,
  };
}

/**
 * API para el sistema de Conserje Digital
 *
 * Fase 1, Bloque A1 (docs/modulos/agente-cerebro.md §7): antes usaba una
 * instancia `axios` "pelada" (sin `withCredentials`), así que la cookie de
 * sesión httpOnly de better-auth NUNCA se enviaba — daba igual porque el
 * backend no exigía sesión. Ahora que `ConciergeAuthGuard` la exige para el
 * transporte "web" (sin header X-Hub-Secret), `respondToVisitor`/
 * `checkSessionStatus` (llamados desde componentes de residentes YA
 * autenticados: NotificationDetailModal, VisitorApprovalDialog) necesitan la
 * instancia compartida `api` (withCredentials: true, mismo patrón que
 * FamilyAPI/UnitAPI/etc.) o quedarían en 401 pese a que el residente sí tiene
 * sesión.
 *
 * RESUELTO (decisión de Benjamin, cierre fases 1-2): `startSession`/
 * `getAgentConfig`/`executeTool`/`endSession` los llama el kiosko
 * `DigitalConciergeView.tsx` — una vista pública SIN sesión de better-auth.
 * En vez de agregarle login humano, el kiosko se trata como un DEVICE del
 * condominio (tipo `web-kiosk`) con secret propio, y manda
 * `X-Hub-Secret`/`X-Hub-Id` (vía `getKioskHubHeaders()`) para que
 * `ConciergeAuthGuard` lo enrute a `HubAuthGuard` — el mismo camino que ya
 * usa `vigilia-hub`. `respondToVisitor`/`checkSessionStatus` NO llevan estos
 * headers: los sigue llamando un residente ya autenticado por cookie, no el
 * kiosko.
 */
export class ConciergeAPI {
  /**
   * Inicia una nueva sesión del conserje digital
   * Retorna el sessionId y el token efímero para WebRTC
   */
  static async startSession(socketId?: string): Promise<ConciergeSessionResponse> {
    const response = await api.post(
      '/concierge/session/start',
      {
        metadata: navigator.userAgent, // Info del dispositivo
        socketId, // Socket ID para notificaciones en tiempo real
      },
      { headers: getKioskHubHeaders() }
    );
    return response.data;
  }

  /**
   * Obtiene la configuración del agente (system prompt + definiciones de
   * tools) para una casa/departamento de destino. Única fuente de verdad:
   * el cliente ya NO hardcodea ni el prompt ni las tools (Fase 1, Bloque
   * "clientes delgados").
   */
  static async getAgentConfig(houseNumber: string): Promise<AgentConfigResponse> {
    const response = await api.post(
      `/concierge/agent-config/${houseNumber}`,
      undefined,
      { headers: getKioskHubHeaders() }
    );
    return response.data;
  }

  /**
   * Ejecuta una herramienta/función desde el frontend
   * (Este método lo llamará el agente de OpenAI cuando necesite ejecutar funciones)
   */
  static async executeTool(
    sessionId: string,
    toolName: string,
    parameters: Record<string, unknown>
  ): Promise<ToolExecutionResponse> {
    const response = await api.post(
      `/concierge/session/${sessionId}/execute-tool`,
      { toolName, parameters },
      { headers: getKioskHubHeaders() }
    );
    return response.data;
  }

  /**
   * Finaliza la sesión del conserje digital
   */
  static async endSession(
    sessionId: string,
    finalStatus?: 'completed' | 'cancelled' | 'timeout'
  ): Promise<EndSessionResponse> {
    const response = await api.post(
      `/concierge/session/${sessionId}/end`,
      { finalStatus },
      { headers: getKioskHubHeaders() }
    );
    return response.data;
  }

  /**
   * Verificar si una sesión está activa y puede recibir respuestas
   */
  static async checkSessionStatus(
    sessionId: string
  ): Promise<{ active: boolean; reason?: string }> {
    const response = await api.post(
      `/concierge/session/${sessionId}/status`
    );
    return response.data;
  }

  /**
   * Responde a una solicitud de visita (aprobar o rechazar)
   */
  static async respondToVisitor(
    sessionId: string,
    approved: boolean,
    residentId?: string
  ): Promise<{ success: boolean; message: string }> {
    const response = await api.post(
      `/concierge/session/${sessionId}/respond`,
      { approved, residentId }
    );
    return response.data;
  }
}

export default ConciergeAPI;
