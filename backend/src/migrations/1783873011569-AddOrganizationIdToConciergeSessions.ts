import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fase 1, Bloque A1 (docs/modulos/agente-cerebro.md §7): `concierge_sessions`
 * quedó FUERA del aislamiento multi-tenant de Fase 0 (tarea #19) — no tenía
 * columna `organization_id`, así que toda sesión del conserje digital caía
 * fuera del scoping por condominio (scopeWhere/stampOrganizationId).
 *
 * El tenant se deriva del Hub físico que originó la sesión (`hubs.organization_id`,
 * agregado en la migración AddHubSupportAndDigitalConcierge — columna ya
 * existente, sin CRUD propio todavía) o de la sesión de usuario humano
 * (better-auth/JWT legacy) cuando el transporte es la web — ver
 * `HubAuthGuard`/`ConciergeAuthGuard`/`digital-concierge.controller.ts`.
 *
 * Mismo patrón que el resto de columnas `organizationId` de Fase 0 (uuid
 * nullable + índice, sin FK — ver Family/Hub/Camera entities): nullable
 * porque sesiones ya existentes (o hubs sin organización asignada aún) caen
 * en el "cajón nulo" en vez de romper (mismo criterio de stampOrganizationId).
 */
export class AddOrganizationIdToConciergeSessions1783873011569 implements MigrationInterface {
    name = 'AddOrganizationIdToConciergeSessions1783873011569'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "concierge_sessions"
            ADD COLUMN IF NOT EXISTS "organizationId" uuid
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_concierge_sessions_organization_id"
            ON "concierge_sessions" ("organizationId")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_concierge_sessions_organization_id"`);
        await queryRunner.query(`ALTER TABLE "concierge_sessions" DROP COLUMN IF EXISTS "organizationId"`);
    }
}
