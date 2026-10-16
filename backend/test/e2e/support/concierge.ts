import type { E2eHttpClient } from './http-client';
import {
  arrayAt,
  asObject,
  describeResponse,
  ensureStatus,
  isJsonObject,
  stringAt,
  type JsonObject,
} from './json';
import { API, type E2eActor, type E2eHub } from './scenario';

/**
 * Flujo del conserje digital por endpoints, como lo hace el citófono
 * (vigilia-hub) con su credencial de dispositivo (Fase 4 · P8):
 * `session/start` → `guardar_datos_visitante` → `buscar_residente` →
 * `notificar_residente`. El `visitId` de la solicitud lo obtiene el residente
 * desde su notificación (`notification.data.visitId`), igual que el frontend.
 */
export interface ConciergeVisitRequest {
  sessionId: string;
  visitId: string;
  ephemeralToken: string;
  notifiedResidentIds: string[];
}

export interface RequestVisitOptions {
  hub: E2eHub;
  /** Código exacto de la casa (`unit.identifier`). */
  house: string;
  visitorName: string;
  /** Patente del visitante (opcional: sin ella la visita es peatonal). */
  plate?: string;
  /** Residente notificado que lee su notificación para obtener el `visitId`. */
  notifiedResident: E2eActor;
}

export function conciergePath(sessionId: string, action: string): string {
  return `${API}/concierge/session/${sessionId}/${action}`;
}

/** Ejecuta una tool como el dispositivo; exige `{ success: true }` y devuelve `data`. */
export async function executeTool(
  device: E2eHttpClient,
  sessionId: string,
  toolName: string,
  parameters: JsonObject,
): Promise<JsonObject> {
  const response = ensureStatus(
    await device.post(conciergePath(sessionId, 'execute-tool'), {
      toolName,
      parameters,
    }),
    [200, 201],
    `ejecutar ${toolName}`,
  );
  const body = asObject(response.json, toolName);
  if (body.success !== true) {
    throw new Error(`${toolName} falló: ${describeResponse(response)}`);
  }
  return asObject(body.data, `${toolName}.data`);
}

/** Inicia la sesión del citófono con la credencial del hub. */
export async function startConciergeSession(
  hub: E2eHub,
): Promise<{ sessionId: string; ephemeralToken: string }> {
  const response = ensureStatus(
    await hub.http.post(`${API}/concierge/session/start`, {}),
    [200, 201],
    'iniciar la sesión del conserje',
  );
  return {
    sessionId: stringAt(response.json, 'sessionId', 'session/start'),
    ephemeralToken: stringAt(response.json, 'ephemeralToken', 'session/start'),
  };
}

/** `visitId` de la notificación de llegada de esa sesión (bandeja del residente). */
export async function visitIdFromNotification(
  resident: E2eActor,
  sessionId: string,
): Promise<string> {
  const response = ensureStatus(
    await resident.http.get(`${API}/notifications?limit=50`),
    [200],
    'leer las notificaciones del residente',
  );
  for (const entry of arrayAt(
    response.json,
    'notifications',
    'notificaciones',
  )) {
    if (!isJsonObject(entry) || !isJsonObject(entry.data)) {
      continue;
    }
    if (
      entry.data.sessionId === sessionId &&
      typeof entry.data.visitId === 'string'
    ) {
      return entry.data.visitId;
    }
  }
  throw new Error(
    `El residente ${resident.email} no tiene la notificación de la sesión ${sessionId}`,
  );
}

/** Solicitud de visita completa por el citófono: queda AWAITING_APPROVAL. */
export async function requestVisitThroughConcierge(
  options: RequestVisitOptions,
): Promise<ConciergeVisitRequest> {
  const device = options.hub.http;
  const { sessionId, ephemeralToken } = await startConciergeSession(
    options.hub,
  );

  const saved = await executeTool(
    device,
    sessionId,
    'guardar_datos_visitante',
    {
      nombre: options.visitorName,
      casa: options.house,
      ...(options.plate ? { patente: options.plate } : {}),
    },
  );
  if (saved.ok !== true) {
    throw new Error(
      `guardar_datos_visitante rechazó un dato: ${JSON.stringify(saved)}`,
    );
  }

  const found = await executeTool(device, sessionId, 'buscar_residente', {
    casa: options.house,
  });
  if (found.encontrado !== true) {
    throw new Error(`buscar_residente no encontró la casa ${options.house}`);
  }
  const residentIds = arrayAt(found, 'residentes', 'buscar_residente').map(
    (resident) => stringAt(resident, 'id', 'residente'),
  );

  const notified = await executeTool(device, sessionId, 'notificar_residente', {
    residentes_ids: residentIds,
  });
  if (notified.notificado !== true) {
    throw new Error(
      `notificar_residente no notificó: ${String(notified.mensaje)}`,
    );
  }

  const visitId = await visitIdFromNotification(
    options.notifiedResident,
    sessionId,
  );
  return {
    sessionId,
    visitId,
    ephemeralToken,
    notifiedResidentIds: residentIds,
  };
}

/** Estado de una visita leído por un actor con `visits.read` (p. ej. el admin). */
export async function visitStatus(
  reader: E2eActor,
  visitId: string,
): Promise<string> {
  const response = ensureStatus(
    await reader.http.get(`${API}/visits/${visitId}`),
    [200],
    `leer la visita ${visitId}`,
  );
  return stringAt(response.json, 'status', 'visita');
}

/** Respuesta de la ingesta del LPR (`POST /detections/plates`). */
export interface PlateIngestionResult {
  status: number;
  decision: string | null;
  requiresApproval: boolean;
  isExit: boolean | null;
  body: JsonObject | null;
}

/** El worker LPR reporta una patente leída por una cámara (con su API key). */
export async function reportPlate(
  lpr: E2eHttpClient,
  cameraId: string,
  plate: string,
): Promise<PlateIngestionResult> {
  const response = await lpr.post(`${API}/detections/plates`, {
    cameraId,
    plate,
    plate_raw: plate,
    det_confidence: 0.97,
    ocr_confidence: 0.95,
    detectionTimestamp: Date.now(),
  });
  const body = isJsonObject(response.json) ? response.json : null;
  const attempt = body && isJsonObject(body.attempt) ? body.attempt : null;
  return {
    status: response.status,
    decision: typeof attempt?.decision === 'string' ? attempt.decision : null,
    requiresApproval: body?.requiresApproval === true,
    isExit: typeof body?.isExit === 'boolean' ? body.isExit : null,
    body,
  };
}
