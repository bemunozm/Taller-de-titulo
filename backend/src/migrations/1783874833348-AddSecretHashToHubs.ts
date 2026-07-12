import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Fase 1, Bloque A1.1 (docs/modulos/agente-cerebro.md §7/§11 — H1, hallazgo
 * ALTO de la auditoría de seguridad): hasta esta migración TODOS los hubs
 * compartían el mismo `HUB_SECRET` (env var global) — la identidad del
 * condominio viajaba en `X-Hub-Id` pero SIN estar atada a un secret por-hub,
 * así que un hub del condominio A podía mandar el `X-Hub-Id` del condominio B
 * y suplantarlo (HubAuthGuard/HubGateway solo validaban "¿el secret es el
 * global correcto?", nunca "¿este secret pertenece a ESTE hubId?").
 *
 * Agrega `secretHash` (hash bcrypt del secret propio de cada hub, generado
 * por `HubsService.provision`/`rotateSecret` — el secret en claro nunca se
 * persiste). Nullable porque las filas `hubs` ya existentes (creadas antes de
 * este CRUD, sin secret propio) deben re-provisionarse explícitamente en vez
 * de heredar un valor por defecto inseguro.
 */
export class AddSecretHashToHubs1783874833348 implements MigrationInterface {
    name = 'AddSecretHashToHubs1783874833348'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "hubs"
            ADD COLUMN IF NOT EXISTS "secretHash" varchar(255)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "hubs" DROP COLUMN IF EXISTS "secretHash"`);
    }
}
