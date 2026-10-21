import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pasadas de vehículos (plan dirección + pasadas multicámara, E6):
 *  - `vehicle_passages`: una fila por pasada (lecturas de una misma patente
 *    dentro de la ventana deslizante `LPR_PASSAGE_WINDOW_SECONDS`).
 *    `decidesAccess` distingue la pasada liderada por una cámara de acceso de la
 *    liderada por una de solo registro (que una cámara de acceso puede
 *    promover); `leaderClaimedAt` permite recuperar una pasada huérfana y `leaderToken` (uuid)
 *    identifica al líder vigente: solo él puede guardar el intento.
 *  - `plate_detections."passageId"`: la lectura es evidencia de una pasada.
 *  - `access_attempts."passageId"` + índice ÚNICO parcial: una pasada tiene a
 *    lo sumo UN intento (la BD lo garantiza, no solo el código).
 * Ambas FK son `ON DELETE SET NULL`: borrar una pasada (compensación si el
 * flujo del líder falla) nunca arrastra detecciones ni intentos. Las columnas
 * nuevas son nullable sin default (solo metadatos): los datos existentes
 * quedan sin pasada y siguen funcionando.
 */
export class VehiclePassages1791590000000 implements MigrationInterface {
  name = 'VehiclePassages1791590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "vehicle_passages" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid NOT NULL, "plate" character varying(64) NOT NULL, "direction" character varying(16) NOT NULL DEFAULT 'unknown', "directionSource" character varying(16) NOT NULL DEFAULT 'none', "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL, "sightingCount" integer NOT NULL DEFAULT '1', "decidesAccess" boolean NOT NULL DEFAULT true, "leaderClaimedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "leaderToken" uuid NOT NULL, "methodFollowsDirection" boolean NOT NULL DEFAULT false, "anonymizedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b2856896793a8789fc82c7be862" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3838a09afeeda7a52b0f902fc" ON "vehicle_passages" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vehicle_passages_org_plate_last_seen" ON "vehicle_passages" ("organizationId", "plate", "lastSeenAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" ADD "passageId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "plate_detections" ADD "passageId" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_access_attempts_passage" ON "access_attempts" ("passageId") WHERE "passageId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_plate_detections_passage" ON "plate_detections" ("passageId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" ADD CONSTRAINT "FK_59da54b39b654345ff73d9682aa" FOREIGN KEY ("passageId") REFERENCES "vehicle_passages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "plate_detections" ADD CONSTRAINT "FK_92fb9ac78a47000f0d0fe80acec" FOREIGN KEY ("passageId") REFERENCES "vehicle_passages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "plate_detections" DROP CONSTRAINT "FK_92fb9ac78a47000f0d0fe80acec"`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" DROP CONSTRAINT "FK_59da54b39b654345ff73d9682aa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_plate_detections_passage"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_access_attempts_passage"`);
    await queryRunner.query(
      `ALTER TABLE "plate_detections" DROP COLUMN "passageId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" DROP COLUMN "passageId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vehicle_passages_org_plate_last_seen"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3838a09afeeda7a52b0f902fc"`,
    );
    await queryRunner.query(`DROP TABLE "vehicle_passages"`);
  }
}
