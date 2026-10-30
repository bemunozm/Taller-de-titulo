import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Revisión de anomalías y estado del análisis de IA (Guardián, Fase 1):
 *  - `status` (open|reviewed|dismissed|false_alarm), `resolvedById`,
 *    `resolvedAt` y `resolutionNote`: quién revisó la anomalía y cómo.
 *  - `aiStatus` (pending|done|failed|skipped) y `aiFalsePositive`: el análisis
 *    de Vision ahora corre en segundo plano y deja de bloquear la ingesta.
 * Son varchar (no ENUM de Postgres) para poder sumar estados sin migración;
 * la validación vive en el DTO. Las filas existentes quedan `open` y con
 * `aiStatus` NULL (se analizaron de forma síncrona antes de este cambio).
 * Índice `(organizationId, status, timestamp)` para el listado filtrado.
 *
 * El número es intencionalmente mayor que el `1791600000000` de la rama LPR.
 */
export class AnomalyReviewAndAiStatus1791610000000
  implements MigrationInterface
{
  name = 'AnomalyReviewAndAiStatus1791610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" ADD "status" character varying(16) NOT NULL DEFAULT 'open'`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" ADD "resolvedById" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" ADD "resolvedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" ADD "resolutionNote" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" ADD "aiStatus" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" ADD "aiFalsePositive" boolean`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_anomaly_events_org_status_timestamp" ON "anomaly_events" ("organizationId", "status", "timestamp") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_anomaly_events_org_status_timestamp"`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" DROP COLUMN "aiFalsePositive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" DROP COLUMN "aiStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" DROP COLUMN "resolutionNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" DROP COLUMN "resolvedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" DROP COLUMN "resolvedById"`,
    );
    await queryRunner.query(
      `ALTER TABLE "anomaly_events" DROP COLUMN "status"`,
    );
  }
}
