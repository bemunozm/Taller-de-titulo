import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 · P3 (D2, docs/modulos/hardening-pre-piloto.md §3): máquina de
 * estados de `Visit`.
 *
 * 1. `visits_status_enum` gana `awaiting_approval`: la solicitud que crea el
 *    conserje digital y que el residente todavía no aprueba. Va `BEFORE
 *    'pending'` para que el orden del tipo Postgres (que define `ORDER BY
 *    status`) siga el ciclo de vida y coincida con el orden de `VisitStatus`
 *    en la entidad.
 * 2. `visits.requestedPlate`: la patente que declaró el visitante al pedir la
 *    visita. `VisitsService.approve` crea el `Vehicle` a partir de este valor
 *    (el que vio el residente), no de la sesión del conserje.
 *
 * `ADD VALUE IF NOT EXISTS` es re-ejecutable y, desde Postgres 12, puede ir
 * dentro de la transacción de `migration:run` mientras ninguna sentencia de
 * esa misma transacción use el valor nuevo (esta no lo usa).
 */
export class AddAwaitingApprovalToVisits1791486870040
  implements MigrationInterface
{
  name = 'AddAwaitingApprovalToVisits1791486870040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."visits_status_enum" ADD VALUE IF NOT EXISTS 'awaiting_approval' BEFORE 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "requestedPlate" character varying(16)`,
    );
  }

  /**
   * Postgres no permite quitar un valor de un enum (`ALTER TYPE ... DROP
   * VALUE` no existe): habría que recrear el tipo y reescribir la columna. Por
   * eso el down():
   * 1. Cierra las solicitudes que sigan en 'awaiting_approval' (→ 'expired'):
   *    el código anterior no conoce ese estado y nunca las resolvería.
   * 2. Quita la columna `requestedPlate`.
   * El valor 'awaiting_approval' se queda en `visits_status_enum`. Tras
   * revertir, `npm run migration:check` reporta drift en ese enum (la entidad
   * del código anterior no lo tiene): es esperado y no afecta la operación,
   * porque el código anterior nunca escribe ese valor.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "visits" SET "status" = 'expired' WHERE "status" = 'awaiting_approval'`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP COLUMN IF EXISTS "requestedPlate"`,
    );
  }
}
