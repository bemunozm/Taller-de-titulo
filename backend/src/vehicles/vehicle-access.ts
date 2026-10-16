/**
 * Valores de `Vehicle.vehicleType` y `Vehicle.accessLevel` (Fase 4 · P5.C,
 * "Vehículos, modelo corregido" en docs/modulos/hardening-pre-piloto.md §2).
 *
 * Enum en el código y `@IsIn` en los DTO, SIN enum en la BD (las columnas
 * siguen siendo `varchar`). La migración `VehicleAccessModel` convirtió los
 * datos del modelo anterior.
 *
 * El bug que corrige: la UI guardaba la carrocería ("auto", "moto") en
 * `vehicleType` y el portón comparaba ese mismo campo con
 * `residente`/`visitante`, así que nada de lo registrado por la UI abría.
 */

/** Carrocería del vehículo. Solo descriptiva: NO interviene en el portón. */
export enum VehicleType {
  CAR = 'auto',
  PICKUP = 'camioneta',
  MOTORCYCLE = 'moto',
  TRUCK = 'camion',
  OTHER = 'otro',
}

/**
 * Nivel de acceso: lo ÚNICO que decide el portón
 * (`DetectionsService.createDetection`, `vehicleAccessRuleFor`):
 *  - `residente` → permitido;
 *  - `visitante` → abre solo con una visita válida;
 *  - `servicio` (o sin nivel) → escala al conserje (fail-closed, D4).
 */
export enum VehicleAccessLevel {
  RESIDENT = 'residente',
  VISITOR = 'visitante',
  SERVICE = 'servicio',
}

export const VEHICLE_TYPES: readonly VehicleType[] = Object.freeze(
  Object.values(VehicleType),
);

export const VEHICLE_ACCESS_LEVELS: readonly VehicleAccessLevel[] =
  Object.freeze(Object.values(VehicleAccessLevel));

/** Qué hace el portón con un vehículo registrado y activo. */
export type VehicleAccessRule = 'allow' | 'requires-visit' | 'concierge';

/**
 * Regla del portón para un `accessLevel` (Fase 4 · P5.C): solo mira el nivel
 * de acceso, nunca la carrocería. Cualquier valor que no sea `residente` ni
 * `visitante` (incluidos `servicio`, `null` y valores legacy) escala al
 * conserje.
 */
export function vehicleAccessRuleFor(
  accessLevel: string | null | undefined,
): VehicleAccessRule {
  if (accessLevel === VehicleAccessLevel.RESIDENT) {
    return 'allow';
  }
  if (accessLevel === VehicleAccessLevel.VISITOR) {
    return 'requires-visit';
  }
  return 'concierge';
}

/**
 * Rango de un nivel de acceso (corrección P5, cyber M1): `residente` 3 >
 * `visitante` 2 > `servicio`/`null`/otro 1. Quien está acotado a su familia
 * puede BAJAR el nivel de un vehículo, nunca subirlo: así la revocación del
 * Administrador (bajarlo, desactivarlo) no se deshace desde la familia.
 */
export function vehicleAccessLevelRank(
  accessLevel: string | null | undefined,
): number {
  if (accessLevel === VehicleAccessLevel.RESIDENT) {
    return 3;
  }
  if (accessLevel === VehicleAccessLevel.VISITOR) {
    return 2;
  }
  return 1;
}
