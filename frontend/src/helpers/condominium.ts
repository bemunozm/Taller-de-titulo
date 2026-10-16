import type { OrganizationScoped } from '@/types/index'

/**
 * Reglas del `organizationId` en las creaciones de recursos del condominio
 * (cámaras, unidades, familias, vehículos y usuarios), contrato P5.C:
 * - el super-admin DEBE indicarlo al crear (sin él → 400);
 * - cualquier otro actor que lo envíe recibe 403;
 * - ninguna edición lo acepta (400).
 */

/** Copia de `values` sin `organizationId` (para ediciones y actores sin super-admin). */
export function withoutOrganizationId<T extends { organizationId?: string | null }>(
  values: T,
): Omit<T, 'organizationId'> {
  const copy = { ...values }
  delete copy.organizationId
  return copy
}

/**
 * Body de una creación: el `organizationId` solo viaja si `sendOrganization`
 * (super-admin creando) y hay uno elegido; si no, nunca aparece.
 */
export function scopeCreatePayload<T extends { organizationId?: string | null }>(
  values: T,
  sendOrganization: boolean,
): Omit<T, 'organizationId'> & OrganizationScoped {
  const rest = withoutOrganizationId(values)
  const { organizationId } = values
  return sendOrganization && organizationId ? { ...rest, organizationId } : rest
}

/**
 * Elementos del condominio elegido. Sin condominio elegido no hay opciones:
 * así el super-admin no puede asignar una familia o unidad de otro condominio.
 */
export function filterByOrganization<T extends { organizationId?: string | null }>(
  items: ReadonlyArray<T>,
  organizationId: string | null | undefined,
): T[] {
  if (!organizationId) return []
  return items.filter((item) => item.organizationId === organizationId)
}

/** Mensaje cuando el super-admin intenta crear sin elegir condominio. */
export const CONDOMINIUM_REQUIRED_MESSAGE = 'Selecciona el condominio'
