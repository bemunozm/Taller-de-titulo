import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 4 · P5.A (docs/modulos/hardening-pre-piloto.md §2 "Detalle de la P5"):
 * auditoría por condominio.
 *
 * `audit_logs.organizationId` (uuid, nullable): el condominio del evento. Lo
 * estampan `AuditInterceptor` (desde `request.tenantContext` o la membresía
 * del usuario) y el sink de login (membresía del usuario). `NULL` = sin
 * condominio (`LOGIN_FAILED`, acciones de un super-admin y todo lo registrado
 * antes de esta migración): esas filas las lee solo el super-admin.
 *
 * Índice compuesto (`organizationId`, `createdAt`): la lectura del
 * Administrador filtra por su condominio y ordena por fecha.
 *
 * Sin FK a `organization`: la tabla es de better-auth (sin entidad TypeORM) y
 * un registro de auditoría debe sobrevivir al condominio.
 *
 * Generada con `migration:generate` (el nombre del índice es el que calcula
 * TypeORM, así `migration:check` no reporta drift). Solo los cambios de la
 * P5.A: los de otras entidades no van acá.
 */
export class AuditLogOrganization1791509200125 implements MigrationInterface {
  name = 'AuditLogOrganization1791509200125';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD "organizationId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9885c0f9a2e4081ebae4313d87" ON "audit_logs" ("organizationId", "createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9885c0f9a2e4081ebae4313d87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP COLUMN "organizationId"`,
    );
  }
}
