import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHubSupportAndDigitalConcierge1707754800000 implements MigrationInterface {
    name = 'AddHubSupportAndDigitalConcierge1707754800000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Agregar campos a concierge_sessions para hub support
        await queryRunner.query(`
            ALTER TABLE "concierge_sessions" 
            ADD COLUMN IF NOT EXISTS "hub_id" varchar(64),
            ADD COLUMN IF NOT EXISTS "source" varchar(16) DEFAULT 'web'
        `);

        // Agregar campo digitalConciergeEnabled a families
        await queryRunner.query(`
            ALTER TABLE "families" 
            ADD COLUMN IF NOT EXISTS "digital_concierge_enabled" boolean DEFAULT false
        `);

        // Crear tabla hubs
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "hubs" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "hub_id" varchar(64) UNIQUE NOT NULL,
                "location" varchar(256) NOT NULL,
                "description" varchar(128),
                "active" boolean DEFAULT true,
                "firmware_version" varchar(64),
                "config" jsonb,
                "last_seen" timestamptz,
                "ip_address" varchar(45),
                "created_at" timestamptz DEFAULT now(),
                "updated_at" timestamptz DEFAULT now()
            )
        `);

        // Crear índices
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_concierge_sessions_hub_id" 
            ON "concierge_sessions" ("hub_id")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_concierge_sessions_source" 
            ON "concierge_sessions" ("source")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_families_digital_concierge_enabled" 
            ON "families" ("digital_concierge_enabled")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_hubs_active" 
            ON "hubs" ("active")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Eliminar índices
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_hubs_active"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_families_digital_concierge_enabled"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_concierge_sessions_source"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_concierge_sessions_hub_id"`);

        // Eliminar tabla hubs
        await queryRunner.query(`DROP TABLE IF EXISTS "hubs"`);

        // Eliminar columnas
        await queryRunner.query(`ALTER TABLE "families" DROP COLUMN IF EXISTS "digital_concierge_enabled"`);
        await queryRunner.query(`ALTER TABLE "concierge_sessions" DROP COLUMN IF EXISTS "source"`);
        await queryRunner.query(`ALTER TABLE "concierge_sessions" DROP COLUMN IF EXISTS "hub_id"`);
    }
}
