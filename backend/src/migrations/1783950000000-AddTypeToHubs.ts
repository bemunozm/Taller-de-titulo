import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tarea "kiosko web como device del condominio" (2026-07-12): el totem web de
 * `/digital-concierge` (`DigitalConciergeView`) quedaba en 401 contra
 * `ConciergeAuthGuard` por ser ruta pública sin auth. Decisión (Benjamin):
 * tratarlo como un `Hub` más — reusa `HubAuthGuard` + el flujo de
 * provisioning/secret de `HubsService` — pero de un tipo distinto al hub
 * físico (Raspberry Pi con teclado/relés GPIO), porque un web-kiosk no
 * controla GPIO.
 *
 * Agrega `hubs.type` (enum `physical-hub` | `web-kiosk`). Retrocompat: NOT
 * NULL con DEFAULT `'physical-hub'` — toda fila existente hoy es, de hecho,
 * una Raspberry Pi física, así que el default no cambia su comportamiento
 * real ni requiere backfill manual.
 */
export class AddTypeToHubs1783950000000 implements MigrationInterface {
  name = 'AddTypeToHubs1783950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "hubs_type_enum" AS ENUM ('physical-hub', 'web-kiosk');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "hubs"
      ADD COLUMN IF NOT EXISTS "type" "hubs_type_enum" NOT NULL DEFAULT 'physical-hub'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "hubs" DROP COLUMN IF EXISTS "type"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "hubs_type_enum"`);
  }
}
