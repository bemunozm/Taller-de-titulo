import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Backfill de `organizationId` en `visits` (branch fix/visits-tenant-isolation
 * — hardening del aislamiento multi-tenant de Fase 0, tarea #19).
 *
 * El módulo Visits quedó fuera del scoping por tenant de Fase 0 (ver
 * docstring en src/visits/entities/visit.entity.ts): la columna
 * `organizationId` existe desde entonces pero nunca se estampó, así que TODAS
 * las visitas creadas hasta ahora tienen `organizationId = NULL`.
 *
 * Este backfill usa el MISMO criterio de derivación que `VisitsService.create`
 * tras el fix (ver su docstring):
 *   1. La familia del host (`families.organizationId`, ya scopeada desde
 *      Fase 0) — fuente primaria, cubre la enorme mayoría de las visitas
 *      (residentes con familia asignada).
 *   2. Si el host no tiene familia (o la familia todavía no tiene
 *      organización — legacy pre-Fase 0), fallback a la membresía de
 *      organización del host (tabla `member`, creada por el plugin
 *      `organization` de better-auth — mismo criterio que
 *      `resolveOrganizationIdForUser` en
 *      src/common/tenant/tenant-context.util.ts).
 *
 * Visitas cuyo host no tenga NI familia con organización NI membresía
 * resoluble quedan con `organizationId = NULL` — mismo "cajón" visible solo
 * por super-admin (y otros recursos sin organización) que ya usa el resto del
 * sistema desde Fase 0 (ver `scopeWhere`/`stampOrganizationId`), no es un caso
 * nuevo que este backfill deba inventar una solución distinta para.
 */
export class BackfillVisitsOrganizationId1783887400000 implements MigrationInterface {
    name = 'BackfillVisitsOrganizationId1783887400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Paso 1: derivar organizationId desde la familia del host.
        await queryRunner.query(`
            UPDATE "visits" v
            SET "organizationId" = f."organizationId"
            FROM "user" u
            INNER JOIN "families" f ON f."id" = u."familyId"
            WHERE v."hostId" = u."id"
              AND v."organizationId" IS NULL
              AND f."organizationId" IS NOT NULL
        `);

        // Paso 2 (fallback): visitas cuyo host no tiene familia con
        // organización — resolver desde la membresía de organización del host
        // (tabla `member` de better-auth). Esta tabla la crea el CLI de
        // better-auth (npx @better-auth/cli migrate); si aún no corrió en este
        // entorno, no rompemos la migración — se deja como "cajón sin
        // organización" (mismo criterio de resolveOrganizationIdForUser).
        try {
            await queryRunner.query(`
                UPDATE "visits" v
                SET "organizationId" = m."organizationId"
                FROM "user" u
                INNER JOIN LATERAL (
                    SELECT "organizationId"
                    FROM "member"
                    WHERE "userId" = u."id"
                    ORDER BY "createdAt" ASC
                    LIMIT 1
                ) m ON true
                WHERE v."hostId" = u."id"
                  AND v."organizationId" IS NULL
            `);
        } catch (error) {
            // Tabla `member` no existe todavía en este entorno (better-auth
            // CLI no ha corrido) — no bloquear el resto de la migración.
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Backfill de datos, no de esquema: no hay forma de distinguir, entre
        // las visitas que hoy tienen organizationId poblado, cuáles lo tenían
        // ya (estampadas por VisitsService.create tras el fix) de cuáles lo
        // recibieron de este backfill — revertir a NULL sería destructivo y
        // reintroduciría el bug que esta migración corrige. Down() es
        // deliberadamente un no-op.
    }
}
