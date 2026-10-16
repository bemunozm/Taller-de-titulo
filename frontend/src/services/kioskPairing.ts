import { isAxiosError } from 'axios'
import {
  ConciergeAPI,
  UnexpectedDeviceResponseError,
  type KioskDeviceIdentity,
} from '@/api/ConciergeAPI'
import { kioskCredentialStore, type KioskCredential } from '@/services/kioskCredentialStore'
import { RATE_LIMIT_MESSAGE } from '@/helpers/httpErrors'

export type KioskPairingErrorReason =
  | 'missing-fields'
  | 'invalid-credential'
  | 'wrong-device-type'
  | 'unexpected-response'
  | 'rate-limited'
  | 'network'
  | 'server'
  | 'storage-unavailable'

export type KioskPairingResult =
  | { status: 'paired'; device: KioskDeviceIdentity }
  | { status: 'error'; reason: KioskPairingErrorReason; message: string }

function pairingError(reason: KioskPairingErrorReason, message: string): KioskPairingResult {
  return { status: 'error', reason, message }
}

/**
 * Empareja el kiosko: valida la credencial con `GET /concierge/device` y la
 * guarda SOLO si el backend responde 2xx, el dispositivo es `web-kiosk` y el
 * `hubId` coincide con el ingresado. Cualquier otro caso no guarda nada.
 */
export async function pairKiosk(input: KioskCredential): Promise<KioskPairingResult> {
  const candidate: KioskCredential = {
    hubId: input.hubId.trim(),
    hubSecret: input.hubSecret.trim(),
  }
  if (candidate.hubId === '' || candidate.hubSecret === '') {
    return pairingError('missing-fields', 'Ingresa el ID del dispositivo y su secreto.')
  }

  let device: KioskDeviceIdentity
  try {
    device = await ConciergeAPI.getDeviceIdentity(candidate)
  } catch (error) {
    if (error instanceof UnexpectedDeviceResponseError) {
      return pairingError(
        'unexpected-response',
        'El servidor respondió algo inesperado. La credencial no se guardó.',
      )
    }
    if (isAxiosError(error)) {
      const status = error.response?.status
      if (status === 401) {
        return pairingError(
          'invalid-credential',
          'Credencial inválida: revisa el ID del dispositivo y el secreto.',
        )
      }
      if (status === 429) {
        return pairingError('rate-limited', RATE_LIMIT_MESSAGE)
      }
      if (status === undefined) {
        return pairingError('network', 'No se pudo conectar con el servidor. Revisa la red del kiosko.')
      }
      return pairingError('server', `No se pudo validar la credencial (error ${status}).`)
    }
    return pairingError('server', 'No se pudo validar la credencial.')
  }

  if (device.type !== 'web-kiosk') {
    return pairingError(
      'wrong-device-type',
      'Esta credencial es de un hub físico (citófono), no de un kiosko web. Usa la credencial de un dispositivo web-kiosk.',
    )
  }
  if (device.hubId !== candidate.hubId) {
    return pairingError(
      'unexpected-response',
      'El servidor identificó otro dispositivo. La credencial no se guardó.',
    )
  }

  if (!kioskCredentialStore.save(candidate)) {
    return pairingError(
      'storage-unavailable',
      'La credencial es válida, pero este navegador no permite guardarla (almacenamiento local bloqueado).',
    )
  }

  return { status: 'paired', device }
}
