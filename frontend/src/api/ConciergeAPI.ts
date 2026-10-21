import { isAxiosError, type AxiosRequestConfig } from 'axios';
import api from '@/lib/axios';
import { kioskCredentialStore, type KioskCredential } from '@/services/kioskCredentialStore';

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

export type ResidentResponseStatus = 'pending' | 'approved' | 'denied';

/**
 * `POST /concierge/session/:id/status`. La llaman el residente (cookie) y el
 * kiosko (headers de hub, solo para su propia sesión). `active`/`reason` son
 * los campos previos a la P4; `visitId`, `residentResponse` y
 * `entryRegistered` los agrega la P4 (respaldo por polling del kiosko).
 * No trae datos del visitante: esos vienen en la notificación.
 *
 * Con `residentResponse: 'approved'`, `entryRegistered` es un valor persistido:
 * `null` = aún procesando, `true` = acceso efectivo (ingreso registrado y
 * apertura ordenada), `false` = definitivo (aprobada sin apertura).
 */
export interface SessionStatusResponse {
  active: boolean;
  reason?: string;
  visitId: string | null;
  residentResponse: ResidentResponseStatus | null;
  entryRegistered: boolean | null;
}

/** `POST /concierge/session/:id/respond` (solo sesión humana, P4). */
export interface RespondToVisitorResponse {
  success: boolean;
  message: string;
  entryRegistered: boolean;
}

export type KioskDeviceType = 'physical-hub' | 'web-kiosk';

/** `GET /concierge/device` (solo `HubAuthGuard`). */
export interface KioskDeviceIdentity {
  hubId: string;
  type: KioskDeviceType;
  organizationId: string | null;
}

/** El kiosko intentó llamar al backend sin credencial emparejada. */
export class KioskNotPairedError extends Error {
  constructor() {
    super('El kiosko no está emparejado: ingresa la credencial del dispositivo.');
    this.name = 'KioskNotPairedError';
  }
}

/** `GET /concierge/device` respondió 2xx con un cuerpo que no cumple el contrato. */
export class UnexpectedDeviceResponseError extends Error {
  constructor() {
    super('Respuesta inesperada del servidor al validar el dispositivo.');
    this.name = 'UnexpectedDeviceResponseError';
  }
}

function isKioskDeviceIdentity(value: unknown): value is KioskDeviceIdentity {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { hubId, type, organizationId } = value as Record<string, unknown>;
  return (
    typeof hubId === 'string' &&
    hubId !== '' &&
    (type === 'physical-hub' || type === 'web-kiosk') &&
    (organizationId === null || typeof organizationId === 'string')
  );
}

/**
 * Mismos headers que usa `vigilia-hub` (`X-Hub-Secret` + `X-Hub-Id`): el
 * backend enruta a `HubAuthGuard` cuando los recibe.
 */
function hubHeaders(credential: KioskCredential): Record<string, string> {
  return {
    'X-Hub-Id': credential.hubId,
    'X-Hub-Secret': credential.hubSecret,
  };
}

/**
 * Request del kiosko con la credencial emparejada (`kioskCredentialStore`).
 *
 * - `withCredentials: false`: el kiosko es un dispositivo; aunque haya una
 *   cookie de sesión humana en el navegador, no viaja con sus llamadas.
 * - Un 401 HTTP significa que el backend ya no acepta esa credencial (secret
 *   rotado, hub desactivado): se borra y la vista vuelve al emparejamiento.
 *   Solo los 401 HTTP; los errores de socket no tocan la credencial.
 */
async function kioskRequest<T>(config: AxiosRequestConfig): Promise<T> {
  const credential = kioskCredentialStore.get();
  if (!credential) {
    throw new KioskNotPairedError();
  }

  try {
    const response = await api.request<T>({
      ...config,
      headers: hubHeaders(credential),
      withCredentials: false,
    });
    return response.data;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 401) {
      kioskCredentialStore.clearIfCurrent(credential, 'unauthorized');
    }
    throw error;
  }
}

function sessionPath(sessionId: string, action: string): string {
  return `/concierge/session/${encodeURIComponent(sessionId)}/${action}`;
}

/**
 * API del Conserje Digital.
 *
 * Dos clientes distintos:
 * - **Kiosko** (`DigitalConciergeView`, vista pública sin sesión humana):
 *   `startSession`, `getAgentConfig`, `executeTool`, `endSession`,
 *   `getKioskSessionStatus`. Se autentica como dispositivo `web-kiosk` con la
 *   credencial emparejada en runtime (`kioskRequest`).
 * - **Residente** (cookie de better-auth vía la instancia compartida `api`):
 *   `checkSessionStatus`, `respondToVisitor`. `/respond` es solo humano.
 */
export class ConciergeAPI {
  /**
   * Valida una credencial candidata contra `GET /concierge/device`. Usa la
   * credencial recibida (aún no guardada), no la del store, y no borra nada
   * ante un 401: el emparejamiento decide qué mostrar.
   */
  static async getDeviceIdentity(credential: KioskCredential): Promise<KioskDeviceIdentity> {
    const response = await api.get<unknown>('/concierge/device', {
      headers: hubHeaders(credential),
      withCredentials: false,
    });
    if (!isKioskDeviceIdentity(response.data)) {
      throw new UnexpectedDeviceResponseError();
    }
    return response.data;
  }

  /**
   * Inicia una nueva sesión del conserje digital.
   * `socketId` es el del socket del kiosko en el namespace `/hub`.
   */
  static async startSession(socketId?: string): Promise<ConciergeSessionResponse> {
    return kioskRequest<ConciergeSessionResponse>({
      method: 'POST',
      url: '/concierge/session/start',
      data: {
        metadata: navigator.userAgent,
        socketId,
      },
    });
  }

  /**
   * Configuración del agente (system prompt + definiciones de tools) para la
   * casa/departamento de destino. Única fuente de verdad: el backend.
   */
  static async getAgentConfig(houseNumber: string): Promise<AgentConfigResponse> {
    return kioskRequest<AgentConfigResponse>({
      method: 'POST',
      url: `/concierge/agent-config/${encodeURIComponent(houseNumber)}`,
    });
  }

  /** Reenvía la ejecución de una tool del agente de Realtime al backend. */
  static async executeTool(
    sessionId: string,
    toolName: string,
    parameters: Record<string, unknown>
  ): Promise<ToolExecutionResponse> {
    return kioskRequest<ToolExecutionResponse>({
      method: 'POST',
      url: sessionPath(sessionId, 'execute-tool'),
      data: { toolName, parameters },
    });
  }

  /** Finaliza la sesión del conserje digital. */
  static async endSession(
    sessionId: string,
    finalStatus?: 'completed' | 'cancelled' | 'timeout'
  ): Promise<EndSessionResponse> {
    return kioskRequest<EndSessionResponse>({
      method: 'POST',
      url: sessionPath(sessionId, 'end'),
      data: { finalStatus },
    });
  }

  /** Estado de la sesión pedido por el kiosko dueño (respaldo por polling). */
  static async getKioskSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
    return kioskRequest<SessionStatusResponse>({
      method: 'POST',
      url: sessionPath(sessionId, 'status'),
    });
  }

  /** Estado de la sesión pedido por un residente notificado (cookie). */
  static async checkSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
    const response = await api.post<SessionStatusResponse>(sessionPath(sessionId, 'status'));
    return response.data;
  }

  /**
   * Respuesta del residente. El body es exactamente `{ approved, visitId }`:
   * quien responde lo identifica el backend por la sesión (cookie), nunca
   * por un id enviado desde el cliente.
   */
  static async respondToVisitor(
    sessionId: string,
    approved: boolean,
    visitId: string
  ): Promise<RespondToVisitorResponse> {
    const response = await api.post<RespondToVisitorResponse>(sessionPath(sessionId, 'respond'), {
      approved,
      visitId,
    });
    return response.data;
  }
}
