import { isAxiosError } from 'axios'
import { ConciergeAPI } from '@/api/ConciergeAPI'
import { RATE_LIMIT_MESSAGE } from '@/helpers/httpErrors'

/** Datos de una notificación `VISITOR_ARRIVAL` (`notification.payload.data`). */
export interface VisitorArrivalData {
  sessionId: string
  /** Puede faltar en notificaciones anteriores a la P4: se obtiene de `/status`. */
  visitId: string | null
  expiresAt: Date | null
  visitor: {
    name: string
    rut?: string
    phone?: string
    plate?: string
    reason?: string
  }
}

export type VisitorResponseErrorReason =
  | 'missing-visit'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'invalid'
  | 'rate-limited'
  | 'failed'

export type VisitorResponseResult =
  /** Aprobada con acceso efectivo (`entryRegistered: true`: ingreso registrado y apertura ordenada). */
  | { status: 'approved'; message: string }
  /** Aprobada, pero el acceso NO se abrió automáticamente; conserjería fue alertada. */
  | { status: 'approved-not-opened'; message: string }
  | { status: 'denied'; message: string }
  /**
   * `terminal`: reintentar no sirve (la solicitud ya se resolvió o no
   * corresponde a este usuario); la UI debe dejar de ofrecer las acciones.
   */
  | { status: 'error'; reason: VisitorResponseErrorReason; message: string; terminal: boolean }

export const VISITOR_RESPONSE_MESSAGES = {
  approved: 'Visita aprobada. El acceso quedó habilitado.',
  approvedNotOpened:
    'Aprobaste la visita, pero el acceso no se abrió automáticamente. Conserjería fue alertada para atender al visitante.',
  denied: 'Visita rechazada.',
  missingVisit: 'No se pudo identificar la solicitud de visita. No se envió tu respuesta.',
  unauthenticated: 'Tu sesión expiró. Vuelve a iniciar sesión para responder.',
  forbidden: 'No tienes autorización para responder esta solicitud.',
  notFound: 'La solicitud de visita ya no existe.',
  conflict: 'La solicitud ya fue respondida o expiró.',
  invalid: 'La solicitud no es válida.',
  failed: 'No se pudo enviar tu respuesta. Intenta nuevamente.',
  network: 'No se pudo conectar con el servidor. Intenta nuevamente.',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** `visitId` usable o `null` (ausente, vacío o de otro tipo). */
export function readVisitId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Valida `notification.payload.data` de un `VISITOR_ARRIVAL`; `null` si no sirve. */
export function parseVisitorArrivalData(data: unknown): VisitorArrivalData | null {
  if (!isRecord(data)) {
    return null
  }
  const sessionId = optionalString(data.sessionId)
  if (!sessionId) {
    return null
  }

  const visitor = isRecord(data.visitor) ? data.visitor : {}
  const expiresAt = typeof data.expiresAt === 'string' ? new Date(data.expiresAt) : null

  return {
    sessionId,
    visitId: readVisitId(data.visitId),
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    visitor: {
      name: optionalString(visitor.name) ?? 'Visitante',
      rut: optionalString(visitor.rut),
      phone: optionalString(visitor.phone),
      plate: optionalString(visitor.plate),
      reason: optionalString(visitor.reason),
    },
  }
}

function backendMessage(error: unknown): string | null {
  const data: unknown = isAxiosError(error) ? error.response?.data : undefined
  if (!isRecord(data)) {
    return null
  }
  return typeof data.message === 'string' && data.message.trim() !== '' ? data.message : null
}

function classifyError(error: unknown): VisitorResponseResult {
  if (!isAxiosError(error)) {
    return { status: 'error', reason: 'failed', message: VISITOR_RESPONSE_MESSAGES.failed, terminal: false }
  }

  switch (error.response?.status) {
    case 401:
      return {
        status: 'error',
        reason: 'unauthenticated',
        message: VISITOR_RESPONSE_MESSAGES.unauthenticated,
        terminal: false,
      }
    case 403:
      return { status: 'error', reason: 'forbidden', message: VISITOR_RESPONSE_MESSAGES.forbidden, terminal: true }
    case 404:
      return { status: 'error', reason: 'not-found', message: VISITOR_RESPONSE_MESSAGES.notFound, terminal: true }
    case 409:
      return { status: 'error', reason: 'conflict', message: VISITOR_RESPONSE_MESSAGES.conflict, terminal: true }
    case 429:
      return { status: 'error', reason: 'rate-limited', message: RATE_LIMIT_MESSAGE, terminal: false }
    case 400:
      return {
        status: 'error',
        reason: 'invalid',
        message: backendMessage(error) ?? VISITOR_RESPONSE_MESSAGES.invalid,
        terminal: false,
      }
    case undefined:
      return { status: 'error', reason: 'failed', message: VISITOR_RESPONSE_MESSAGES.network, terminal: false }
    default:
      return {
        status: 'error',
        reason: 'failed',
        message: backendMessage(error) ?? VISITOR_RESPONSE_MESSAGES.failed,
        terminal: false,
      }
  }
}

async function resolveVisitId(sessionId: string, visitId: string | null): Promise<string | null> {
  if (visitId) {
    return visitId
  }
  try {
    const status = await ConciergeAPI.checkSessionStatus(sessionId)
    return readVisitId(status.visitId)
  } catch {
    return null
  }
}

interface SubmitVisitorResponseInput {
  sessionId: string
  /** De la notificación; si falta se pide a `/status`. */
  visitId: string | null
  approved: boolean
}

/**
 * Envía la respuesta del residente (`{ approved, visitId }`) y la traduce a
 * un resultado para la UI. Sin `visitId` no se llama a `/respond`.
 * Fail-closed: solo `entryRegistered === true` cuenta como acceso efectivo.
 */
export async function submitVisitorResponse({
  sessionId,
  visitId,
  approved,
}: SubmitVisitorResponseInput): Promise<VisitorResponseResult> {
  const resolvedVisitId = await resolveVisitId(sessionId, visitId)
  if (!resolvedVisitId) {
    return {
      status: 'error',
      reason: 'missing-visit',
      message: VISITOR_RESPONSE_MESSAGES.missingVisit,
      terminal: false,
    }
  }

  let response: unknown
  try {
    response = await ConciergeAPI.respondToVisitor(sessionId, approved, resolvedVisitId)
  } catch (error) {
    return classifyError(error)
  }

  if (!approved) {
    return { status: 'denied', message: VISITOR_RESPONSE_MESSAGES.denied }
  }
  if (isRecord(response) && response.entryRegistered === true) {
    return { status: 'approved', message: VISITOR_RESPONSE_MESSAGES.approved }
  }
  return { status: 'approved-not-opened', message: VISITOR_RESPONSE_MESSAGES.approvedNotOpened }
}
