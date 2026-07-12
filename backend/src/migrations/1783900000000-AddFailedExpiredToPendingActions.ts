import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 (revisión pre-F2.2): agrega los estados `failed`/`expired` al
 * mecanismo de autonomía/aprobación (ver
 * `PendingActionStatus`/`PendingActionsService.approve`) y la columna
 * `lastError` para guardar el motivo. Complementa
 * `CreatePendingActions1783890290995` en vez de reescribirla — el enum ya
 * tiene filas en `pending`/`approved`/`rejected`/`executed` en cualquier
 * ambiente donde este bloque ya corrió.
 *
 * `ALTER TYPE ... ADD VALUE` no puede ejecutarse dentro de una transacción en
 * versiones viejas de Postgres — se envuelve en el mismo patrón
 * `DO $$ ... EXCEPTION duplicate_object` que ya usa la migración anterior
 * para que sea re-ejecutable sin romper si el valor ya existe (Postgres 12+
 * soporta `ADD VALUE IF NOT EXISTS` directo, que es lo que se usa acá).
 */
export class AddFailedExpiredToPendingActions1783900000000
  implements MigrationInterface
{
  name = 'AddFailedExpiredToPendingActions1783900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "pending_actions_status_enum" ADD VALUE IF NOT EXISTS 'failed'`,
    );
    await queryRunner.query(
      `ALTER TYPE "pending_actions_status_enum" ADD VALUE IF NOT EXISTS 'expired'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pending_actions" ADD COLUMN IF NOT EXISTS "lastError" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres no soporta remover valores de un enum sin recrear el tipo
    // (requeriría reescribir la tabla y cualquier fila que ya use
    // 'failed'/'expired'). Se deja como limitación documentada — el down()
    // revierte lo que SÍ es seguro revertir (la columna).
    await queryRunner.query(
      `ALTER TABLE "pending_actions" DROP COLUMN IF EXISTS "lastError"`,
    );
  }
}
