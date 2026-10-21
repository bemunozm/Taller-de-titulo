import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 · P5.B (docs/modulos/hardening-pre-piloto.md §2 "Detalle de la P5"):
 * unicidad POR CONDOMINIO de patentes y de identificadores de unidad.
 *
 * Antes `vehicles.plate` y `units.identifier` eran únicos en TODA la
 * plataforma: el auto de un residente no podía registrarse en otro
 * condominio, ni el "A-101" de un condominio crearse en otro (el INSERT
 * respondía 500). Ahora:
 *  - `UNIQUE (organizationId, plate)` y `UNIQUE (organizationId, identifier)`;
 *  - con `NULLS NOT DISTINCT` (Postgres 15): las filas sin condominio
 *    (`organizationId IS NULL`, hasta P5.C) también comparten UN espacio de
 *    nombres, en vez de admitir duplicados ilimitados (con el `NULLS
 *    DISTINCT` por defecto, dos `NULL` nunca chocan).
 * Los datos existentes ya cumplen el índice nuevo: el único global anterior
 * es más estricto.
 *
 * Generada con `migration:generate` y ajustada a mano solo para agregar
 * `NULLS NOT DISTINCT`. TypeORM 0.3 no lo expresa en la entidad, pero
 * tampoco lo compara (solo nombre, columnas y unicidad del índice), así que
 * `migration:check` no reporta drift. Los nombres de los índices son los de
 * `@Index` en `Unit`/`Vehicle`.
 *
 * `down` restaura el único global: falla si ya hay la misma patente o el
 * mismo identificador en dos condominios (hay que resolverlos antes).
 */
export class PerOrganizationUniqueness1791509282253
  implements MigrationInterface
{
  name = 'PerOrganizationUniqueness1791509282253';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "units" DROP CONSTRAINT "UQ_d124fa977ca6c41f5c84801e8ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" DROP CONSTRAINT "UQ_ec7181ebdab798d97070122a5bf"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_units_organization_identifier" ON "units" ("organizationId", "identifier") NULLS NOT DISTINCT`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vehicles_organization_plate" ON "vehicles" ("organizationId", "plate") NULLS NOT DISTINCT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vehicles_organization_plate"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_units_organization_identifier"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" ADD CONSTRAINT "UQ_ec7181ebdab798d97070122a5bf" UNIQUE ("plate")`,
    );
    await queryRunner.query(
      `ALTER TABLE "units" ADD CONSTRAINT "UQ_d124fa977ca6c41f5c84801e8ea" UNIQUE ("identifier")`,
    );
  }
}
