/**
 * Conversión de datos de la migración `VehicleAccessModel1791520000000`
 * (Fase 4 · P5.C). Vive fuera de `migrations/*.ts` a propósito: TypeORM carga
 * como migración TODA función exportada por esos archivos, así que la función
 * pura de abajo rompería la carga. El glob de migraciones es de un solo nivel
 * (no entra a `support/`). Autocontenido: no importa los enums de la app,
 * para que la migración no cambie si el enum cambia después.
 */

/** Carrocerías válidas (`VehicleType`) al momento de esta migración. */
const BODY_TYPES: readonly string[] = [
  'auto',
  'camioneta',
  'moto',
  'camion',
  'otro',
];

export interface VehicleAccessColumns {
  vehicleType: string | null;
  accessLevel: string | null;
}

/**
 * Conversión de una fila, espejo exacto del SQL de `up` (lo usan los tests y
 * la verificación contra Postgres).
 */
export function migrateVehicleAccess(
  row: VehicleAccessColumns,
): VehicleAccessColumns {
  const { vehicleType, accessLevel } = row;

  let nextAccessLevel: string | null = null;
  if (
    vehicleType === 'residente' ||
    accessLevel === 'permanente' ||
    accessLevel === 'residente'
  ) {
    nextAccessLevel = 'residente';
  } else if (
    vehicleType === 'visitante' ||
    accessLevel === 'temporal' ||
    accessLevel === 'visitante'
  ) {
    nextAccessLevel = 'visitante';
  } else if (accessLevel === 'servicio') {
    nextAccessLevel = 'servicio';
  }

  const bodyType =
    vehicleType === null ? null : vehicleType.trim().toLowerCase();
  const nextVehicleType =
    bodyType !== null && BODY_TYPES.includes(bodyType) ? bodyType : null;

  return { vehicleType: nextVehicleType, accessLevel: nextAccessLevel };
}

const BODY_TYPES_SQL = BODY_TYPES.map((type) => `'${type}'`).join(', ');

/** SQL de `up` (exportado para los tests). */
export const VEHICLE_ACCESS_UP_SQL = `
WITH mapped AS (
  SELECT
    "id",
    CASE
      WHEN "vehicleType" = 'residente'
        OR "accessLevel" IN ('permanente', 'residente') THEN 'residente'
      WHEN "vehicleType" = 'visitante'
        OR "accessLevel" IN ('temporal', 'visitante') THEN 'visitante'
      WHEN "accessLevel" = 'servicio' THEN 'servicio'
      ELSE NULL
    END AS "accessLevel",
    CASE
      WHEN lower(btrim("vehicleType")) IN (${BODY_TYPES_SQL})
        THEN lower(btrim("vehicleType"))
      ELSE NULL
    END AS "vehicleType"
  FROM "vehicles"
)
UPDATE "vehicles" AS v
   SET "accessLevel" = m."accessLevel",
       "vehicleType" = m."vehicleType"
  FROM mapped AS m
 WHERE v."id" = m."id"
   AND (v."accessLevel" IS DISTINCT FROM m."accessLevel"
     OR v."vehicleType" IS DISTINCT FROM m."vehicleType")
`;

/** SQL de `down` (best-effort, ver el docstring del archivo). */
export const VEHICLE_ACCESS_DOWN_SQL = `
UPDATE "vehicles"
   SET "accessLevel" = CASE "accessLevel"
         WHEN 'residente' THEN 'permanente'
         WHEN 'visitante' THEN 'temporal'
         ELSE NULL
       END
 WHERE "accessLevel" IN ('residente', 'visitante', 'servicio')
`;
