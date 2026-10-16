import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — H1): permiso
 * exclusivo de plataforma para provisionar/gestionar hubs físicos (mismo
 * criterio que `platform.manage-organizations`, doc auth-multitenant.md §7b —
 * "Administrador" de UN condominio NO lo tiene).
 *
 * `DataInitializationService.onModuleInit` (src/common/services/
 * data-initialization.service.ts) crea el permiso si falta, pero SOLO asigna
 * permisos por defecto a un rol si ese rol tiene CERO permisos ("si ya tiene
 * permisos asignados, no los sobreescribir") — en cualquier ambiente que ya
 * bootstrapeó roles antes de esta tarea, "Super Administrador" ya tiene
 * permisos, así que el nuevo permiso NO se asignaría solo. Esta migración
 * inserta el permiso y lo asocia a "Super Administrador" directamente
 * (idempotente — usa NOT EXISTS, corre bien sin importar el orden respecto al
 * boot de Nest).
 */
export class AddPlatformManageHubsPermission1783874833349 implements MigrationInterface {
    name = 'AddPlatformManageHubsPermission1783874833349'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            INSERT INTO "permission" ("id", "name", "description", "module", "action")
            SELECT uuid_generate_v4(), 'platform.manage-hubs', 'Provisionar y gestionar hubs físicos (citófono)', 'platform', 'manage-hubs'
            WHERE NOT EXISTS (SELECT 1 FROM "permission" WHERE "name" = 'platform.manage-hubs')
        `);

        await queryRunner.query(`
            INSERT INTO "role_permissions_permission" ("roleId", "permissionId")
            SELECT r."id", p."id"
            FROM "role" r, "permission" p
            WHERE r."name" = 'Super Administrador' AND p."name" = 'platform.manage-hubs'
            AND NOT EXISTS (
                SELECT 1 FROM "role_permissions_permission" rp
                WHERE rp."roleId" = r."id" AND rp."permissionId" = p."id"
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DELETE FROM "role_permissions_permission"
            WHERE "permissionId" IN (SELECT "id" FROM "permission" WHERE "name" = 'platform.manage-hubs')
        `);
        await queryRunner.query(`DELETE FROM "permission" WHERE "name" = 'platform.manage-hubs'`);
    }
}
