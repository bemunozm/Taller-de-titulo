import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface ConciergeSessionResponse {
  sessionId: string;
  ephemeralToken: string;
  expiresAt: string;
}

export interface ToolExecutionRequest {
  toolName: string;
  parameters: Record<string, any>;
}

export interface ToolExecutionResponse {
  success: boolean;
  data?: any;
  error?: string;
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
 * API para el sistema de Conserje Digital
 */
export class ConciergeAPI {
  /**
   * Inicia una nueva sesión del conserje digital
   * Retorna el sessionId y el token efímero para WebRTC
   */
  static async startSession(socketId?: string): Promise<ConciergeSessionResponse> {
    const response = await axios.post(`${API_URL}/concierge/session/start`, {
      metadata: navigator.userAgent, // Info del dispositivo
      socketId, // Socket ID para notificaciones en tiempo real
    });
    return response.data;
  }

  /**
   * Ejecuta una herramienta/función desde el frontend
   * (Este método lo llamará el agente de OpenAI cuando necesite ejecutar funciones)
   */
  static async executeTool(
    sessionId: string,
    toolName: string,
    parameters: Record<string, any>
  ): Promise<ToolExecutionResponse> {
    const response = await axios.post(
      `${API_URL}/concierge/session/${sessionId}/execute-tool`,
      { toolName, parameters }
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
    const response = await axios.post(
      `${API_URL}/concierge/session/${sessionId}/end`,
      { finalStatus }
    );
    return response.data;
  }

  /**
   * Verificar si una sesión está activa y puede recibir respuestas
   */
  static async checkSessionStatus(
    sessionId: string
  ): Promise<{ active: boolean; reason?: string }> {
    const response = await axios.post(
      `${API_URL}/concierge/session/${sessionId}/status`
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
    const response = await axios.post(
      `${API_URL}/concierge/session/${sessionId}/respond`,
      { approved, residentId }
    );
    return response.data;
  }
}

export default ConciergeAPI;