/**
 * Permisos con los que el backend une un socket a la sala de seguridad de su
 * condominio (`org:<id>:security`, P6): solo esos usuarios reciben
 * `security:anomaly_highlight`.
 */
export const SECURITY_ALERT_PERMISSIONS = ['detections.read', 'condominium.view-all'] as const

interface SecurityAlertActor {
  isSuperAdmin: boolean
  /** Nombres de los permisos del usuario (`usePermissions().userPermissions`). */
  permissions: ReadonlyArray<string>
}

/**
 * Espejo de `securityRoomFor` del backend: `detections.read` +
 * `condominium.view-all` (Conserje, Administrador). El super-admin queda
 * fuera aunque tenga ambos permisos: no pertenece a un condominio, el
 * servidor no lo une a ninguna sala de seguridad y la plataforma consulta
 * `GET /anomalies` en vez de un feed en vivo.
 */
export function canReceiveSecurityAlerts(actor: SecurityAlertActor): boolean {
  if (actor.isSuperAdmin) {
    return false
  }
  return SECURITY_ALERT_PERMISSIONS.every((permission) => actor.permissions.includes(permission))
}

export type AnomalySeverity = 'HIGH' | 'MEDIUM' | 'LOW'

/** Aviso de anomalía recibido por WebSocket. Nunca trae la foto. */
export interface AnomalyHighlight {
  anomalyId: string
  cameraId: string | null
  cameraName: string | null
  type: string | null
  /** `null` si el backend no lo envía o trae un nivel desconocido. */
  severity: AnomalySeverity | null
  reasoning: string | null
  timestamp: Date | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function firstString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
  }
  return null
}

function toSeverity(value: string | null): AnomalySeverity | null {
  const upper = value?.toUpperCase()
  return upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW' ? upper : null
}

function toDate(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Lee `security:anomaly_highlight` sin confiar en su forma. El contrato es
 * `{ anomalyId, cameraId, cameraName, type, severity, reasoning, timestamp }`;
 * también se aceptan los nombres de la entidad (`id`, `anomalyType`,
 * `suspicionLevel`, `aiReasoning`). Sin id no hay aviso, porque la foto se
 * pide por id. Una imagen incluida en el payload se ignora: la foto solo
 * llega por `GET /anomalies/:id`, acotado a la sesión.
 */
export function parseAnomalyHighlight(raw: unknown): AnomalyHighlight | null {
  if (!isRecord(raw)) {
    return null
  }
  const anomalyId = firstString(raw, 'anomalyId', 'id')
  if (!anomalyId) {
    return null
  }
  return {
    anomalyId,
    cameraId: firstString(raw, 'cameraId'),
    cameraName: firstString(raw, 'cameraName'),
    type: firstString(raw, 'type', 'anomalyType'),
    severity: toSeverity(firstString(raw, 'severity', 'suspicionLevel')),
    reasoning: firstString(raw, 'reasoning', 'aiReasoning'),
    timestamp: toDate(raw.timestamp),
  }
}

const ANOMALY_TYPE_LABELS = new Map<string, string>([
  ['intrusion', 'Intrusión en zona prohibida'],
  ['loitering', 'Merodeo prolongado'],
])

export function anomalyTypeLabel(type: string | null): string {
  return (type && ANOMALY_TYPE_LABELS.get(type.toLowerCase())) || 'Actividad anómala'
}

const DATA_URL_PREFIX = /^data:image\/[a-z]+;base64,/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * `data:` URL de la foto JPEG en base64 de una anomalía, o `null` si el
 * valor no es base64 (sin foto o con un formato inesperado).
 */
export function toJpegDataUrl(base64: string | null | undefined): string | null {
  if (typeof base64 !== 'string') {
    return null
  }
  const compact = base64.replace(DATA_URL_PREFIX, '').replace(/\s+/g, '')
  if (compact === '' || !BASE64.test(compact)) {
    return null
  }
  return `data:image/jpeg;base64,${compact}`
}
