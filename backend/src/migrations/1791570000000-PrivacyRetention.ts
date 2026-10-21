import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 · P7.R (Ley 21.719, docs/modulos/privacidad-ley-21719.md §3/§4):
 * retención y derechos de los titulares.
 *
 * 1. `anonymizedAt timestamptz NULL` en `visits`, `concierge_sessions`,
 *    `plate_detections` y `user`: cuándo se anonimizó la fila (retención o
 *    supresión). Hace idempotente el barrido diario.
 * 2. `user.rut` y `user.phone` pasan a NULL-ables: una cuenta deshabilitada
 *    y anonimizada queda sin RUT ni teléfono. Siguen únicos (en Postgres dos
 *    NULL no chocan). Las cuentas activas los siguen exigiendo en el alta.
 * 3. Auditoría: módulo `PRIVACY` y acciones `DATA_EXPORT`, `DATA_ERASURE` y
 *    `RETENTION_SWEEP`, agregados AL FINAL con `ADD VALUE IF NOT EXISTS`
 *    (re-ejecutable; desde Postgres 12 va dentro de la transacción mientras
 *    nada de esta migración use los valores nuevos). `migration:generate`
 *    proponía recrear los tipos (y los índices que los usan); no hace falta
 *    porque el orden coincide con el de la entidad.
 * 4. Índices PARCIALES del barrido (`WHERE "anonymizedAt" IS NULL`, y el de
 *    imágenes): la tabla crece para siempre (las filas anonimizadas quedan),
 *    pero el barrido solo mira las pendientes. TypeORM no expresa índices
 *    parciales ni por expresión: las entidades los declaran con
 *    `@Index(nombre, { synchronize: false })`, así `migration:check` no los
 *    reporta ni los borra. Las expresiones son las MISMAS del SQL del
 *    barrido (privacy/retention-sql.ts y retention.repository.ts).
 */
export class PrivacyRetention1791570000000 implements MigrationInterface {
  name = 'PrivacyRetention1791570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "anonymizedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD "anonymizedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "plate_detections" ADD "anonymizedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "concierge_sessions" ADD "anonymizedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "rut" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "phone" DROP NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_module_enum" ADD VALUE IF NOT EXISTS 'PRIVACY'`,
    );
    for (const action of ['DATA_EXPORT', 'DATA_ERASURE', 'RETENTION_SWEEP']) {
      await queryRunner.query(
        `ALTER TYPE "public"."audit_logs_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX "IDX_visits_retention_candidates" ON "visits" ((COALESCE("exitTime", LEAST("validUntil", "updatedAt")))) WHERE "anonymizedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_concierge_sessions_retention_candidates" ON "concierge_sessions" ((COALESCE("endTime", "updatedAt"))) WHERE "anonymizedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plate_detections_retention_candidates" ON "plate_detections" ("createdAt") WHERE "anonymizedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plate_detections_with_images" ON "plate_detections" ("createdAt") WHERE ("full_frame_path" IS NOT NULL OR (jsonb_typeof("meta") = 'object' AND "meta" ? 'snapshot_jpeg_b64'))`,
    );
  }

  /**
   * - Los valores nuevos de los enums de auditoría se QUEDAN: Postgres no
   *   permite quitarlos sin recrear el tipo y reescribir la columna (y las
   *   filas PRIVACY son registros de auditoría que no se borran). Tras
   *   revertir, `migration:check` reporta drift en esos enums: es esperado.
   * - `rut`/`phone` vuelven a NOT NULL solo si no hay cuentas anonimizadas:
   *   si las hay, el down falla con un mensaje claro (habría que inventarles
   *   un RUT y un teléfono únicos, y eso no se hace en silencio).
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: unknown = await queryRunner.query(
      `SELECT count(*)::int AS "count" FROM "user" WHERE "rut" IS NULL OR "phone" IS NULL`,
    );
    const count =
      Array.isArray(rows) &&
      typeof (rows[0] as { count?: unknown } | undefined)?.count === 'number'
        ? (rows[0] as { count: number }).count
        : 0;
    if (count > 0) {
      throw new Error(
        `PrivacyRetention.down: hay ${count} cuenta(s) sin RUT o teléfono (anonimizadas); no se puede volver a NOT NULL sin inventar valores. Resuélvelo a mano antes de revertir.`,
      );
    }

    await queryRunner.query(
      `DROP INDEX "public"."IDX_plate_detections_with_images"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plate_detections_retention_candidates"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_concierge_sessions_retention_candidates"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_visits_retention_candidates"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "phone" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ALTER COLUMN "rut" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "concierge_sessions" DROP COLUMN "anonymizedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "plate_detections" DROP COLUMN "anonymizedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "anonymizedAt"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "anonymizedAt"`);
  }
}
