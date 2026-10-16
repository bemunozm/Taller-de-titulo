import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 · P4 (D5, docs/modulos/hardening-pre-piloto.md §2 "Detalle de la
 * P4"): seguimiento de la respuesta a una solicitud del conserje digital.
 *
 * 1. `visits.respondedById` / `visits.respondedAt`: quién respondió y cuándo.
 *    `VisitsService.approve`/`deny` los escriben en el MISMO `UPDATE`
 *    condicionado del claim (`AWAITING_APPROVAL → PENDING | DENIED`): solo
 *    los guarda la respuesta que ganó. `ON DELETE SET NULL`: borrar al
 *    usuario no borra ni bloquea la visita.
 * 2. `concierge_sessions.entryRegistered`: el acceso EFECTIVO de una
 *    respuesta aprobada (ingreso registrado por esta respuesta Y orden de
 *    apertura recibida por un hub físico). `NULL` mientras no hay respuesta
 *    aprobada o mientras se procesa; lo lee `/status`, el respaldo por
 *    polling del kiosko.
 *
 * Generada con `migration:generate` (el nombre de la FK es el que calcula
 * TypeORM, así `migration:check` no reporta drift).
 */
export class ConciergeResponseTracking1791498985330
  implements MigrationInterface
{
  name = 'ConciergeResponseTracking1791498985330';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "visits" ADD "respondedById" uuid`);
    await queryRunner.query(
      `ALTER TABLE "visits" ADD "respondedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "concierge_sessions" ADD "entryRegistered" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_a7042de87288e706cd2e6895b82" FOREIGN KEY ("respondedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_a7042de87288e706cd2e6895b82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "concierge_sessions" DROP COLUMN "entryRegistered"`,
    );
    await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "respondedAt"`);
    await queryRunner.query(`ALTER TABLE "visits" DROP COLUMN "respondedById"`);
  }
}
