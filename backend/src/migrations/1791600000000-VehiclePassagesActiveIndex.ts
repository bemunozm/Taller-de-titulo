import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índice parcial para la búsqueda de variantes de OCR entre cámaras
 * (`LPR_PASSAGE_FUZZY_SECONDS`): pasadas recientes de un condominio, sin
 * importar la patente (`organizationId`, `lastSeenAt` donde `anonymizedAt IS
 * NULL`). El índice por patente existente no sirve a esa consulta, que cruza
 * patentes.
 */
export class VehiclePassagesActiveIndex1791600000000
  implements MigrationInterface
{
  name = 'VehiclePassagesActiveIndex1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_vehicle_passages_org_last_seen_active" ON "vehicle_passages" ("organizationId", "lastSeenAt") WHERE "anonymizedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vehicle_passages_org_last_seen_active"`,
    );
  }
}
