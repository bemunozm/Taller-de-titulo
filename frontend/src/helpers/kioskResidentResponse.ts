/**
 * Respuesta del residente vista desde el kiosko (fail-closed).
 *
 * El kiosko solo le dice al visitante que pase si la respuesta trae
 * `approved === true && entryRegistered === true` (acceso efectivo: ingreso
 * registrado y apertura ordenada). Una aprobación con `entryRegistered` que
 * no es `true` NO es un "pase": el acceso no se abrió automáticamente y el
 * backend alertó a conserjería.
 */

export type ResidentOutcome = 'admitted' | 'approved-not-opened' | 'denied'

/**
 * Cómo termina la espera del kiosko: con una respuesta del residente, porque
 * la sesión se cerró sin respuesta (`closed`) o porque venció la espera
 * máxima (`no-response`).
 */
export type KioskWaitOutcome = ResidentOutcome | 'closed' | 'no-response'

/** Estado que muestra el panel de datos del kiosko. */
export type ResidentPanelResponse = 'pending' | 'approved' | 'approved-not-opened' | 'denied' | 'unanswered'

export type KioskStatusReading =
  | { kind: 'resolved'; outcome: ResidentOutcome }
  /** Aprobada, pero el backend aún no persistió el resultado del ingreso (`entryRegistered: null`). */
  | { kind: 'processing' }
  /** Aún no hay respuesta. */
  | { kind: 'waiting' }
  /** La sesión terminó sin respuesta: no tiene sentido seguir consultando. */
  | { kind: 'closed' }

export interface ResidentOutcomeMessages {
  /** Mensaje de sistema que se inyecta al agente de voz. */
  agentInstruction: string
  /** Línea que ve el visitante en la transcripción del kiosko. */
  transcript: string
  panelResponse: ResidentPanelResponse
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function outcomeFromApproval(approved: boolean, entryRegistered: unknown): ResidentOutcome {
  if (!approved) {
    return 'denied'
  }
  return entryRegistered === true ? 'admitted' : 'approved-not-opened'
}

/**
 * Interpreta el payload de `visitor:response:<sessionId>` (definitivo: se
 * emite después de ordenar la apertura).
 *
 * Devuelve `null` si el payload no es una decisión (no trae `approved`
 * booleano, o es de otra sesión): se ignora y se sigue esperando, el polling
 * tiene la respuesta autoritativa. Una aprobación con `entryRegistered`
 * ausente o no booleano se trata como "acceso no abierto".
 */
export function interpretResidentResponsePayload(
  payload: unknown,
  sessionId: string,
): ResidentOutcome | null {
  if (!isRecord(payload) || typeof payload.approved !== 'boolean') {
    return null
  }
  if (typeof payload.sessionId === 'string' && payload.sessionId !== sessionId) {
    return null
  }
  return outcomeFromApproval(payload.approved, payload.entryRegistered)
}

/**
 * Interpreta la respuesta de `POST /concierge/session/:id/status` (polling).
 *
 * Con `residentResponse: 'approved'` (`entryRegistered` es un valor persistido):
 * - `true` → acceso efectivo (ingreso registrado y apertura ordenada).
 * - `null` (o ausente) → `processing`: el backend aún no persiste el
 *   resultado. El watcher lo acota en el tiempo (no se espera para siempre).
 * - `false` (o cualquier otro valor inesperado) → definitivo: aprobada, el
 *   acceso no se abrió automáticamente, conserjería alertada.
 */
export function interpretKioskSessionStatus(status: unknown): KioskStatusReading {
  if (!isRecord(status)) {
    return { kind: 'waiting' }
  }
  if (status.residentResponse === 'approved') {
    if (status.entryRegistered === null || status.entryRegistered === undefined) {
      return { kind: 'processing' }
    }
    return { kind: 'resolved', outcome: outcomeFromApproval(true, status.entryRegistered) }
  }
  if (status.residentResponse === 'denied') {
    return { kind: 'resolved', outcome: 'denied' }
  }
  if (status.active === false) {
    return { kind: 'closed' }
  }
  return { kind: 'waiting' }
}

const SYSTEM_PREFIX = 'NOTIFICACIÓN DEL SISTEMA:'
const DO_NOT_ADMIT = 'NO le digas al visitante que pase ni que el acceso está abierto.'

/** Mensajes para el agente y el visitante. Solo `admitted` habla de ingresar. */
export function buildResidentOutcomeMessages(outcome: KioskWaitOutcome): ResidentOutcomeMessages {
  switch (outcome) {
    case 'admitted':
      return {
        agentInstruction:
          `${SYSTEM_PREFIX} El residente APROBÓ la visita y el acceso quedó habilitado. ` +
          'Da la bienvenida al visitante, indícale que puede ingresar, despídete y llama a finalizar_llamada().',
        transcript: 'El residente aprobó la visita. El acceso quedó habilitado.',
        panelResponse: 'approved',
      }
    case 'approved-not-opened':
      return {
        agentInstruction:
          `${SYSTEM_PREFIX} El residente aprobó la solicitud, pero el acceso NO se abrió automáticamente. ` +
          `${DO_NOT_ADMIT} ` +
          'Explícale que su solicitud fue aprobada pero el acceso no se abrió automáticamente, ' +
          'y que espere un momento porque ya se avisó a conserjería. Luego despídete y llama a finalizar_llamada().',
        transcript:
          'Solicitud aprobada, pero el acceso no se abrió automáticamente. Espera un momento: se avisó a conserjería.',
        panelResponse: 'approved-not-opened',
      }
    case 'denied':
      return {
        agentInstruction:
          `${SYSTEM_PREFIX} El residente RECHAZÓ la visita. ` +
          'Informa amablemente al visitante que no puede ingresar, despídete y llama a finalizar_llamada().',
        transcript: 'El residente rechazó la visita.',
        panelResponse: 'denied',
      }
    case 'closed':
      return {
        agentInstruction:
          `${SYSTEM_PREFIX} La solicitud no pudo completarse o expiró. ${DO_NOT_ADMIT} ` +
          'Explícale que su solicitud no pudo completarse, que puede intentarlo de nuevo o contactar a conserjería, ' +
          'despídete y llama a finalizar_llamada().',
        transcript: 'La solicitud no pudo completarse o expiró. Puedes intentarlo de nuevo o contactar a conserjería.',
        panelResponse: 'unanswered',
      }
    case 'no-response':
      return {
        agentInstruction:
          `${SYSTEM_PREFIX} El residente no respondió a tiempo. ${DO_NOT_ADMIT} ` +
          'Infórmale que el residente no respondió, que puede intentarlo más tarde o contactar a conserjería, ' +
          'despídete y llama a finalizar_llamada().',
        transcript: 'El residente no respondió. Puedes intentarlo más tarde o contactar a conserjería.',
        panelResponse: 'unanswered',
      }
  }
}
