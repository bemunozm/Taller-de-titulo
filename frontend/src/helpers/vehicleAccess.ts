import type { ComponentProps } from 'react'
import type { Badge } from '@/components/ui/Badge'
import { withoutOrganizationId } from '@/helpers/condominium'
import {
  VEHICLE_ACCESS_LEVELS,
  VEHICLE_TYPES,
  type CreateVehicleFormData,
  type CreateVehiclePayload,
  type UpdateVehiclePayload,
  type VehicleAccessLevel,
  type VehicleType,
} from '@/types/index'

type BadgeColor = NonNullable<ComponentProps<typeof Badge>['color']>

// `Record<VehicleType, …>` obliga a etiquetar cualquier carrocería nueva.
const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  auto: 'Auto',
  camioneta: 'Camioneta',
  moto: 'Moto',
  camion: 'Camión',
  otro: 'Otro',
}

interface AccessLevelMeta {
  label: string
  /** Qué hace el portón con esta patente (ayuda del formulario). */
  gateBehavior: string
  color: BadgeColor
}

const ACCESS_LEVEL_META: Record<VehicleAccessLevel, AccessLevelMeta> = {
  residente: {
    label: 'Residente',
    gateBehavior: 'El portón abre automáticamente al reconocer la patente.',
    color: 'lime',
  },
  visitante: {
    label: 'Visitante',
    gateBehavior: 'El portón abre solo si la patente tiene una visita vigente.',
    color: 'amber',
  },
  servicio: {
    label: 'Servicio',
    gateBehavior: 'El portón no abre solo: el conserje decide cada ingreso.',
    color: 'sky',
  },
}

/** Sin nivel de acceso el portón también escala al conserje. */
export const NO_ACCESS_LEVEL_BEHAVIOR = 'Sin nivel: el portón no abre solo y el conserje decide cada ingreso.'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export const VEHICLE_TYPE_OPTIONS: ReadonlyArray<SelectOption<VehicleType>> = VEHICLE_TYPES.map((value) => ({
  value,
  label: VEHICLE_TYPE_LABELS[value],
}))

export const ACCESS_LEVEL_OPTIONS: ReadonlyArray<SelectOption<VehicleAccessLevel>> = VEHICLE_ACCESS_LEVELS.map(
  (value) => ({ value, label: ACCESS_LEVEL_META[value].label }),
)

const VEHICLE_TYPE_SET: ReadonlySet<string> = new Set(VEHICLE_TYPES)
const ACCESS_LEVEL_SET: ReadonlySet<string> = new Set(VEHICLE_ACCESS_LEVELS)

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === 'string' && VEHICLE_TYPE_SET.has(value)
}

export function isVehicleAccessLevel(value: unknown): value is VehicleAccessLevel {
  return typeof value === 'string' && ACCESS_LEVEL_SET.has(value)
}

/** Etiqueta de la carrocería; un valor desconocido se muestra tal cual. */
export function getVehicleTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return isVehicleType(value) ? VEHICLE_TYPE_LABELS[value] : value
}

export function getAccessLevelLabel(value: string | null | undefined): string | null {
  if (!value) return null
  return isVehicleAccessLevel(value) ? ACCESS_LEVEL_META[value].label : value
}

export function getAccessLevelColor(value: string | null | undefined): BadgeColor {
  return isVehicleAccessLevel(value) ? ACCESS_LEVEL_META[value].color : 'zinc'
}

/** Ayuda del formulario según el nivel elegido ('' = sin nivel). */
export function getAccessLevelGateBehavior(value: string | null | undefined): string {
  return isVehicleAccessLevel(value) ? ACCESS_LEVEL_META[value].gateBehavior : NO_ACCESS_LEVEL_BEHAVIOR
}

/** Valor del <select> para un vehículo existente: un literal desconocido queda sin elegir. */
export function toVehicleTypeFieldValue(value: string | null | undefined): VehicleType | '' {
  return isVehicleType(value) ? value : ''
}

export function toAccessLevelFieldValue(value: string | null | undefined): VehicleAccessLevel | '' {
  return isVehicleAccessLevel(value) ? value : ''
}

interface VehiclePayloadOptions {
  /**
   * Al editar, "Sin propietario" envía `ownerId: null` para quitarlo. Solo un
   * actor con `condominium.view-all` puede hacerlo; sin él se omite (el
   * propietario queda igual).
   */
  allowOwnerRemoval?: boolean
  /**
   * Al editar, no enviar la patente: sin `condominium.view-all` cambiarla es
   * un 403 (hay que borrar el vehículo y registrarlo de nuevo).
   */
  omitPlate?: boolean
}

/**
 * Body del formulario de vehículo. Un <select> sin elegir envía '', que el
 * backend rechaza (400): al crear se omite el campo y al editar se envía
 * `null` para limpiarlo (el propietario, solo con `allowOwnerRemoval`).
 */
export function toVehiclePayload(values: CreateVehicleFormData, mode: 'create'): CreateVehiclePayload
export function toVehiclePayload(
  values: CreateVehicleFormData,
  mode: 'update',
  options?: VehiclePayloadOptions,
): UpdateVehiclePayload
export function toVehiclePayload(
  values: CreateVehicleFormData,
  mode: 'create' | 'update',
  options: VehiclePayloadOptions = {},
): CreateVehiclePayload | UpdateVehiclePayload {
  // El condominio lo agrega el formulario solo si corresponde (ver scopeCreatePayload).
  const { vehicleType, accessLevel, ownerId, ...rest } = withoutOrganizationId(values)

  if (mode === 'create') {
    const payload: CreateVehiclePayload = { ...rest }
    if (vehicleType) payload.vehicleType = vehicleType
    if (accessLevel) payload.accessLevel = accessLevel
    if (ownerId) payload.ownerId = ownerId
    return payload
  }

  const payload: UpdateVehiclePayload = {
    ...rest,
    vehicleType: vehicleType || null,
    accessLevel: accessLevel || null,
  }
  if (ownerId) {
    payload.ownerId = ownerId
  } else if (options.allowOwnerRemoval) {
    payload.ownerId = null
  }
  if (options.omitPlate) {
    delete payload.plate
  }
  return payload
}

/** Ayuda junto a la patente de solo lectura (actores sin `condominium.view-all`). */
export const PLATE_LOCKED_HINT = 'Para cambiar la patente, elimina el vehículo y regístralo de nuevo'

/** 403 al borrar un vehículo inactivo sin `condominium.view-all`. */
export const INACTIVE_VEHICLE_DELETE_FORBIDDEN_MESSAGE =
  'Solo un administrador puede eliminar un vehículo inactivo'

// Cuánto abre cada nivel: residente > visitante > servicio / sin nivel.
const ACCESS_LEVEL_RANK: Record<VehicleAccessLevel, number> = {
  servicio: 0,
  visitante: 1,
  residente: 2,
}

function accessLevelRank(value: string | null | undefined): number {
  return isVehicleAccessLevel(value) ? ACCESS_LEVEL_RANK[value] : 0
}

/** `true` si el cambio abre más el portón (p.ej. visitante → residente). */
export function isAccessLevelUpgrade(from: string | null | undefined, to: string | null | undefined): boolean {
  return accessLevelRank(to) > accessLevelRank(from)
}

/** 403 al editar: un residente no reactiva su vehículo ni le sube el nivel de acceso. */
export const VEHICLE_ESCALATION_FORBIDDEN_MESSAGE =
  'Solo un administrador puede reactivar o ampliar el acceso de este vehículo'

interface VehicleEscalationCandidate {
  active?: boolean | null
  accessLevel?: string | null
}

/** `true` si la edición reactiva el vehículo o le amplía el acceso. */
export function isVehicleEscalation(
  before: VehicleEscalationCandidate,
  after: { active?: boolean; accessLevel?: string | null },
): boolean {
  const reactivates = before.active === false && after.active === true
  return reactivates || isAccessLevelUpgrade(before.accessLevel, after.accessLevel)
}
