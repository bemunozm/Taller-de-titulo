import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2, Bloque F2.1 (docs/modulos/agente-cerebro.md §12): tabla del
 * mecanismo de autonomía/aprobación del agente-cerebro. `VigiliaTool.requiresApproval`
 * existía en el contrato desde Fase 1 (§5 del diseño) pero no tenía dónde
 * persistir una acción escalada — este bloque activa esa política.
 *
 * Mismo criterio que el resto de columnas `organizationId`/`tenantId` de
 * Fase 0/1 (uuid nullable + índice, sin FK — ver docstring de
 * AddOrganizationIdToConciergeSessions): nullable porque una acción puede
 * escalar desde un contexto sin condominio resuelto (hub aún no asociado).
 */
export class CreatePendingActions1783890290995 implements MigrationInterface {
  name = 'CreatePendingActions1783890290995';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "pending_actions_status_enum" AS ENUM ('pending', 'approved', 'rejected', 'executed');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pending_actions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenantId" uuid,
        "sessionId" uuid,
        "toolName" character varying(128) NOT NULL,
        "input" jsonb NOT NULL,
        "requestId" character varying(64) NOT NULL,
        "status" "pending_actions_status_enum" NOT NULL DEFAULT 'pending',
        "contextSnapshot" jsonb,
        "result" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "resolvedBy" uuid,
        "resolvedAt" timestamptz,
        CONSTRAINT "PK_pending_actions_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pending_actions_tenant_id"
      ON "pending_actions" ("tenantId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pending_actions_session_id"
      ON "pending_actions" ("sessionId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_pending_actions_status"
      ON "pending_actions" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pending_actions_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pending_actions_session_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pending_actions_tenant_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pending_actions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pending_actions_status_enum"`);
  }
}
