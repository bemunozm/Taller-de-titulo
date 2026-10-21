import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan LPR por cámara (F2): `camera."lprSettings" jsonb NULL`. `NULL` = el
 * worker usa sus defaults globales (comportamiento previo: control de acceso).
 * Columna nullable sin default: el ADD COLUMN es solo de metadatos (no
 * reescribe la tabla) y las cámaras existentes quedan en `NULL`.
 */
export class CameraLprSettings1791580000000 implements MigrationInterface {
  name = 'CameraLprSettings1791580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "camera" ADD "lprSettings" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "camera" DROP COLUMN "lprSettings"`);
  }
}
