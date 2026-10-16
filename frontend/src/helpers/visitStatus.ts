import type { ComponentProps } from 'react'
import type { Badge } from '@/components/ui/Badge'
import { formatDateTime } from '@/helpers/index'
import { visitStatusSchema, type VisitStatus } from '@/types/index'

/** Colores que acepta `<Badge>`; derivado del componente para no desalinearse. */
export type VisitStatusColor = NonNullable<ComponentProps<typeof Badge>['color']>

interface VisitStatusMeta {
  /** Etiqueta singular, para badges. */
  label: string
  /** Etiqueta plural, para filtros y contadores. */
  pluralLabel: string
  color: VisitStatusColor
}

// `Record<VisitStatus, …>` obliga a declarar aquí cualquier estado nuevo del schema.
const VISIT_STATUS_META: Record<VisitStatus, VisitStatusMeta> = {
  awaiting_approval: {
    label: 'Esperando aprobación',
    pluralLabel: 'Esperando aprobación',
    color: 'orange',
  },
  pending: { label: 'Pendiente', pluralLabel: 'Pendientes', color: 'amber' },
  active: { label: 'Activa', pluralLabel: 'Activas', color: 'lime' },
  ready: { label: 'Lista para Reingresar', pluralLabel: 'Listas para Reingresar', color: 'cyan' },
  completed: { label: 'Completada', pluralLabel: 'Completadas', color: 'sky' },
  cancelled: { label: 'Cancelada', pluralLabel: 'Canceladas', color: 'zinc' },
  expired: { label: 'Expirada', pluralLabel: 'Expiradas', color: 'rose' },
  denied: { label: 'Rechazada', pluralLabel: 'Rechazadas', color: 'red' },
}

// La API no valida la respuesta con zod: un estado nuevo del backend llega tal cual.
const UNKNOWN_VISIT_STATUS_META: VisitStatusMeta = {
  label: 'Desconocido',
  pluralLabel: 'Desconocidos',
  color: 'zinc',
}

/** Todos los estados, en orden del ciclo de vida. */
export const VISIT_STATUSES: readonly VisitStatus[] = visitStatusSchema.options

const VISIT_STATUS_SET: ReadonlySet<string> = new Set(VISIT_STATUSES)

export function isVisitStatus(value: unknown): value is VisitStatus {
  return typeof value === 'string' && VISIT_STATUS_SET.has(value)
}

function getVisitStatusMeta(status: string | null | undefined): VisitStatusMeta {
  return isVisitStatus(status) ? VISIT_STATUS_META[status] : UNKNOWN_VISIT_STATUS_META
}

export function getVisitStatusLabel(status: string | null | undefined): string {
  return getVisitStatusMeta(status).label
}

export function getVisitStatusPluralLabel(status: string | null | undefined): string {
  return getVisitStatusMeta(status).pluralLabel
}

export function getVisitStatusColor(status: string | null | undefined): VisitStatusColor {
  return getVisitStatusMeta(status).color
}

// Listas blancas alineadas con la máquina de estados del backend
// (docs/modulos/hardening-pre-piloto.md §3). Fuera de ellas el backend responde 409.
const CHECK_IN_STATUSES: ReadonlySet<VisitStatus> = new Set<VisitStatus>(['pending', 'ready'])
const CHECK_OUT_STATUSES: ReadonlySet<VisitStatus> = new Set<VisitStatus>(['active'])
// Solo una visita programada sin usos; una solicitud sin aprobar se rechaza, no se cancela.
const CANCELLABLE_STATUSES: ReadonlySet<VisitStatus> = new Set<VisitStatus>(['pending'])
const EDITABLE_STATUSES: ReadonlySet<VisitStatus> = new Set<VisitStatus>(['pending', 'ready'])
// Una solicitud `awaiting_approval` no tiene QR hasta que el residente la aprueba.
const QR_VISIBLE_STATUSES: ReadonlySet<VisitStatus> = new Set<VisitStatus>([
  'pending',
  'active',
  'ready',
])

export function canCheckInVisit(status: string | null | undefined): boolean {
  return isVisitStatus(status) && CHECK_IN_STATUSES.has(status)
}

export function canCheckOutVisit(status: string | null | undefined): boolean {
  return isVisitStatus(status) && CHECK_OUT_STATUSES.has(status)
}

export function canCancelVisit(status: string | null | undefined): boolean {
  return isVisitStatus(status) && CANCELLABLE_STATUSES.has(status)
}

export function canEditVisit(status: string | null | undefined): boolean {
  return isVisitStatus(status) && EDITABLE_STATUSES.has(status)
}

interface QrCandidate {
  status: string
  qrCode?: string | null
}

/** El QR solo es una credencial vigente en pending/active/ready y si existe. */
export function canShowVisitQr<T extends QrCandidate>(visit: T): visit is T & { qrCode: string } {
  return (
    isVisitStatus(visit.status) &&
    QR_VISIBLE_STATUSES.has(visit.status) &&
    typeof visit.qrCode === 'string' &&
    visit.qrCode.length > 0
  )
}

/** Aviso al crear una visita para otro: el QR no llega a quien la creó. */
export const VISIT_QR_WITHHELD_MESSAGE =
  'Visita creada. El código QR lo reciben solo el anfitrión y su familia.'

/**
 * La visita está en un estado con QR, pero el backend no lo entregó: solo el
 * anfitrión y su familia lo reciben (P5). P.ej. una visita creada por el
 * conserje para un residente.
 */
export function isVisitQrWithheld(visit: QrCandidate): boolean {
  return isVisitStatus(visit.status) && QR_VISIBLE_STATUSES.has(visit.status) && !visit.qrCode
}

interface PlateCandidate {
  vehicle?: { plate: string } | null
  /** Patente de una solicitud que aún no tiene `vehicle` (se crea al aprobar). */
  requestedPlate?: string | null
}

/** Patente a mostrar: la del vehículo asociado o, si no hay, la solicitada. */
export function getVisitPlate(visit: PlateCandidate): string | null {
  return visit.vehicle?.plate || visit.requestedPlate || null
}

/** Cuenta visitas por estado; los estados desconocidos no suman en ninguno. */
export function countVisitsByStatus(
  visits: ReadonlyArray<{ status: string }>,
): Record<VisitStatus, number> {
  const counts = Object.fromEntries(VISIT_STATUSES.map((status) => [status, 0])) as Record<
    VisitStatus,
    number
  >

  for (const visit of visits) {
    if (isVisitStatus(visit.status)) {
      counts[visit.status] += 1
    }
  }

  return counts
}

export type VisitScanSeverity = 'error' | 'warning' | 'info'

export interface VisitScanValidation {
  type: VisitScanSeverity
  message: string
  description: string
}

/** Fechas como `Date` (schema) o `string` (respuesta cruda de la API). */
type DateLike = Date | string

export interface ScannableVisit {
  status: string
  validFrom: DateLike
  validUntil: DateLike
  maxUses?: number | null
  usedCount: number
}

const NO_ACTIONS_DESCRIPTION = 'No se puede registrar entrada ni salida'

/**
 * Explica por qué una visita escaneada no admite acciones, o `null` si no hay
 * nada que advertir. El estado manda sobre la ventana de validez: una solicitud
 * sin aprobar no es válida aunque esté dentro de su horario.
 */
export function getVisitScanValidation(
  visit: ScannableVisit,
  now: Date = new Date(),
): VisitScanValidation | null {
  if (!isVisitStatus(visit.status)) {
    return {
      type: 'error',
      message: 'La visita tiene un estado desconocido',
      description: NO_ACTIONS_DESCRIPTION,
    }
  }

  switch (visit.status) {
    case 'awaiting_approval':
      return {
        type: 'warning',
        message: 'La visita aún no fue aprobada por el residente',
        description: 'El código QR no es válido hasta que el residente apruebe la solicitud',
      }
    case 'denied':
      return {
        type: 'error',
        message: 'La visita fue rechazada',
        description: NO_ACTIONS_DESCRIPTION,
      }
    case 'cancelled':
      return {
        type: 'error',
        message: 'La visita fue cancelada',
        description: NO_ACTIONS_DESCRIPTION,
      }
    case 'expired':
      return {
        type: 'error',
        message: 'La visita expiró',
        description: `Válida hasta: ${formatDateTime(visit.validUntil)}`,
      }
    case 'completed':
      return {
        type: 'info',
        message: 'La visita ya está completada',
        description: 'No se pueden realizar más acciones',
      }
    case 'active':
      // El visitante está dentro: el backend registra la salida sin mirar la
      // ventana ni los usos (con maxUses=1, usedCount=1 es lo normal aquí).
      if (now > new Date(visit.validUntil)) {
        return {
          type: 'warning',
          message: 'La visita superó su período válido',
          description: 'El visitante sigue dentro: registra su salida',
        }
      }
      return null
    case 'pending':
    case 'ready':
      break
  }

  // Desde aquí solo quedan estados que admiten check-in: ventana y usos lo condicionan.
  if (now > new Date(visit.validUntil)) {
    return {
      type: 'error',
      message: 'La visita expiró',
      description: `Válida hasta: ${formatDateTime(visit.validUntil)}`,
    }
  }

  if (now < new Date(visit.validFrom)) {
    return {
      type: 'warning',
      message: 'La visita aún no es válida',
      description: `Válida desde: ${formatDateTime(visit.validFrom)}`,
    }
  }

  if (visit.maxUses !== null && visit.maxUses !== undefined && visit.usedCount >= visit.maxUses) {
    return {
      type: 'error',
      message: 'Se alcanzó el máximo de usos',
      description: `Usos: ${visit.usedCount} / ${visit.maxUses}`,
    }
  }

  return null
}

export interface VisitScanState {
  validation: VisitScanValidation | null
  canCheckIn: boolean
  canCheckOut: boolean
}

/** Qué puede hacer el guardia con una visita escaneada. */
export function getVisitScanState(visit: ScannableVisit, now: Date = new Date()): VisitScanState {
  const validation = getVisitScanValidation(visit, now)

  return {
    validation,
    // La entrada exige un estado válido y ninguna advertencia (aprobación, ventana, usos).
    canCheckIn: canCheckInVisit(visit.status) && validation === null,
    // La salida solo depende del estado, igual que en el backend.
    canCheckOut: canCheckOutVisit(visit.status),
  }
}
