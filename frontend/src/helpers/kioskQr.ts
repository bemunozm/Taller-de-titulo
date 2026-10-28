import type { KioskQrAccess, KioskQrDenialReason, KioskQrRedeemResult } from '@/api/ConciergeAPI'

/** Mismo formato que valida el backend: alfanumérico de 8 a 64 caracteres, sin espacios. */
export const KIOSK_QR_CODE_PATTERN = /^[A-Za-z0-9]{8,64}$/

/** Lo que el visitante ve tras acercar su código. */
export type KioskQrOutcome =
  | { kind: 'granted'; access: KioskQrAccess; doorOpened: boolean }
  | { kind: 'denied'; reason: KioskQrDenialReason }
  /** 429: demasiados canjes seguidos desde este dispositivo. */
  | { kind: 'rate-limited' }
  /** Sin red, timeout o respuesta inesperada: no se sabe si el código era válido. */
  | { kind: 'error' }
  | { kind: 'camera-error' }

export type KioskNoticeTone = 'success' | 'warning' | 'danger' | 'neutral'

export interface KioskQrMessage {
  tone: KioskNoticeTone
  title: string
  detail: string
}

export function outcomeFromRedeemResult(result: KioskQrRedeemResult): KioskQrOutcome {
  return result.status === 'granted'
    ? { kind: 'granted', access: result.access, doorOpened: result.doorOpened }
    : { kind: 'denied', reason: result.reason }
}

const DENIAL_MESSAGES: Record<KioskQrDenialReason, KioskQrMessage> = {
  invalid: {
    tone: 'danger',
    title: 'Código no válido',
    detail: 'No reconocemos este código. Revise que sea el último que le enviaron o marque el departamento.',
  },
  not_yet_valid: {
    tone: 'warning',
    title: 'Todavía no puede ingresar',
    detail: 'Su visita aún no está vigente. Intente de nuevo a la hora indicada.',
  },
  expired: {
    tone: 'danger',
    title: 'Código vencido',
    detail: 'Pida a quien visita que le envíe un código nuevo, o marque el departamento.',
  },
  already_inside: {
    tone: 'warning',
    title: 'Su ingreso ya quedó registrado',
    detail: 'Este código ya se usó para ingresar. Si la puerta no se abrió, avise al conserje.',
  },
  no_uses_left: {
    tone: 'warning',
    title: 'Código sin usos disponibles',
    detail: 'Este código ya no admite más ingresos. Avise a quien visita o marque el departamento.',
  },
  host_inactive: {
    tone: 'danger',
    title: 'No podemos autorizar el ingreso',
    detail: 'Avise al conserje.',
  },
}

/** Pantalla de resultado: un mensaje distinto por cada caso. */
export function describeQrOutcome(outcome: KioskQrOutcome): KioskQrMessage {
  switch (outcome.kind) {
    case 'granted':
      if (!outcome.doorOpened) {
        // El código era válido y el ingreso quedó registrado, pero la apertura no llegó.
        return {
          tone: 'warning',
          title: 'Avise al conserje',
          detail: 'Su código es válido, pero la puerta no se abrió sola.',
        }
      }
      return {
        tone: 'success',
        title: 'Bienvenido',
        detail: outcome.access === 'vehicular' ? 'El portón se está abriendo.' : 'La puerta se está abriendo.',
      }
    case 'denied':
      return DENIAL_MESSAGES[outcome.reason]
    case 'rate-limited':
      return {
        tone: 'warning',
        title: 'Espere un momento',
        detail: 'Hubo muchos intentos seguidos. Intente de nuevo en un minuto.',
      }
    case 'error':
      return {
        tone: 'danger',
        title: 'No pudimos confirmar el código',
        detail: 'Si la puerta no se abrió, avise al conserje o use el citófono.',
      }
    case 'camera-error':
      return {
        tone: 'danger',
        title: 'No pudimos usar la cámara',
        detail: 'Marque el departamento o avise al conserje.',
      }
  }
}
