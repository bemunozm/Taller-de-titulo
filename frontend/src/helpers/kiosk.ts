/** Ruta del kiosko del conserje digital: un dispositivo público, no una sesión humana. */
export const KIOSK_ROUTE = '/digital-concierge'

export function isKioskRoute(pathname: string): boolean {
  return pathname === KIOSK_ROUTE || pathname.startsWith(`${KIOSK_ROUTE}/`)
}

/**
 * Panel "Residente notificado" del kiosko. Las tools ya no entregan nombres
 * al kiosko (un dispositivo público frente al visitante): solo la casa y la
 * cantidad notificada.
 */
export function describeNotifiedResidents(house: string | null | undefined, count?: number): string {
  const trimmed = typeof house === 'string' ? house.trim() : ''
  const place = trimmed === '' ? 'la casa marcada' : `la casa ${trimmed}`
  if (typeof count === 'number' && Number.isInteger(count) && count > 1) {
    return `${count} residentes de ${place}`
  }
  return `Residente de ${place}`
}

const HUB_ID_MASK = '••••'
/** Caracteres finales del hubId que quedan visibles en la pantalla del kiosko. */
export const HUB_ID_VISIBLE_CHARS = 4

/**
 * hubId para la pantalla pública del kiosko: `••••` y sus últimos 4
 * caracteres, lo justo para que el operador reconozca el dispositivo sin que
 * el visitante lea el identificador completo. Si el id es tan corto que esos
 * 4 caracteres serían la mitad o más, no se muestra nada de él.
 */
export function maskHubId(hubId: string): string {
  const trimmed = hubId.trim()
  if (trimmed.length < HUB_ID_VISIBLE_CHARS * 2) {
    return HUB_ID_MASK
  }
  return `${HUB_ID_MASK}${trimmed.slice(-HUB_ID_VISIBLE_CHARS)}`
}
