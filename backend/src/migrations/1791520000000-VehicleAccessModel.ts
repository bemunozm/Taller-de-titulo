import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  VEHICLE_ACCESS_DOWN_SQL,
  VEHICLE_ACCESS_UP_SQL,
} from './support/vehicle-access-model';

/**
 * Fase 4 · P5.C — "Vehículos, modelo corregido" (docs/modulos/
 * hardening-pre-piloto.md §2). Migración SOLO de datos: las columnas siguen
 * siendo `varchar` (enum en el código, sin enum en la BD), así que no hay
 * cambio de esquema ni drift.
 *
 * Antes la UI guardaba la carrocería ("auto", "moto") en `vehicleType` y el
 * portón comparaba ese mismo campo con `residente`/`visitante`. Ahora:
 *  - `vehicleType` = carrocería: `auto | camioneta | moto | camion | otro`
 *    (o `null`). Descriptiva.
 *  - `accessLevel` = `residente | visitante | servicio` (o `null`): lo ÚNICO
 *    que decide el portón.
 *
 * Conversión (ver `migrateVehicleAccess` en support/vehicle-access-model.ts,
 * espejo exacto del SQL):
 *  - `accessLevel`: conserva la decisión que tomaba el portón ANTES de esta
 *    migración (que miraba primero "residente" y después "visitante"):
 *      `vehicleType = 'residente'` o `accessLevel IN ('permanente','residente')`
 *        → `residente`;
 *      si no, `vehicleType = 'visitante'` o `accessLevel IN
 *        ('temporal','visitante')` → `visitante`;
 *      si no, `accessLevel = 'servicio'` → `servicio`;
 *      cualquier otro valor → `null` (escala al conserje, como antes).
 *    Las comparaciones son EXACTAS, como las del portón anterior: un
 *    "Residente" escrito a mano nunca abrió y sigue sin abrir.
 *  - `vehicleType`: la carrocería normalizada (`lower(btrim(...))`) si está
 *    en el enum; cualquier otro valor (incluidos `residente`/`visitante`, que
 *    pasaron a `accessLevel`) → `null`.
 *
 * CAMBIO OPERATIVO (avisar antes de desplegar): desde esta migración los
 * vehículos con `accessLevel = 'residente'` ABREN SOLOS el portón, sin
 * conserje, siempre que su propietario sea miembro activo del condominio de
 * la cámara (corrección P5, cyber A1; decisión de Benjamin del 2026-10-09).
 * Incluye los que antes tenían `vehicleType = 'residente'` o
 * `accessLevel = 'permanente'` (ya abrían) y, desde la P5.C, los que un
 * residente registra para su familia con `accessLevel = 'residente'`, que
 * abren de inmediato.
 * Revisar la lista de vehículos `residente` de cada condominio antes de
 * activar el LPR en el piloto.
 *
 * Idempotente: los valores del modelo nuevo se mapean a sí mismos, y el
 * `UPDATE` solo toca las filas que cambian (correrla dos veces no hace nada).
 *
 * `down` es best-effort y con pérdida (la carrocería no se puede devolver a
 * `vehicleType` sin pisar datos): vuelve `accessLevel` al vocabulario
 * anterior (`residente` → `permanente`, `visitante` → `temporal`,
 * `servicio` → `null`), que el portón anterior trata igual.
 */

export class VehicleAccessModel1791520000000 implements MigrationInterface {
  name = 'VehicleAccessModel1791520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(VEHICLE_ACCESS_UP_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(VEHICLE_ACCESS_DOWN_SQL);
  }
}
