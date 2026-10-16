import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import type { auth } from '../auth/better-auth';
import {
  isActiveMemberOfOrganization,
  resolveOrganizationIdForUser,
} from '../common/tenant/tenant-context.util';
import {
  countUsersWithoutMembership,
  type SqlExecutor,
} from './membership-backfill';

/** Rol de better-auth dentro del condominio: solo pertenencia (el RBAC fino es app-side). */
export type OrganizationMemberRole = 'member' | 'owner';

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerUserId: string;
}

/** Condominio tal como lo lista el selector del super-admin (P5.C). */
export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

/** `DataSource` de TypeORM como `SqlExecutor` (membership-backfill.ts). */
export function dataSourceSqlExecutor(dataSource: DataSource): SqlExecutor {
  return {
    query: <T extends object>(sql: string, params: readonly unknown[]) =>
      dataSource.query<T[]>(sql, [...params]),
  };
}

/**
 * Membresías de condominio (Fase 4 · P5, D11): la ÚNICA puerta para crear
 * membresías (`member` de better-auth) y para consultarlas desde los flujos de
 * usuarios. Crea vía `auth.api.createOrganization`/`addMember` server-side (sin
 * headers: llamada privilegiada del backend; esas rutas no existen por HTTP,
 * ver better-auth-http-allowlist.ts). Lee con SQL directo sobre el mismo
 * `DataSource` (la tabla `member` no tiene entidad TypeORM).
 *
 * Al arrancar avisa cuántos usuarios (no super-admin) no tienen membresía:
 * con el aislamiento por condominio no aparecen en ninguno. Se corrigen con
 * `node scripts/backfill-memberships.js`.
 */
@Injectable()
export class OrganizationMembershipService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrganizationMembershipService.name);

  constructor(
    // Tipado con `typeof auth` para conocer los endpoints del plugin
    // `organization` (mismo criterio que OnboardingService antes de la P5).
    // Los genéricos se borran en runtime: la DI resuelve la misma instancia.
    private readonly betterAuthService: BetterAuthService<typeof auth>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.warnAboutUsersWithoutMembership();
  }

  /** Aviso al arrancar. Nunca bloquea el arranque. */
  async warnAboutUsersWithoutMembership(): Promise<number | null> {
    try {
      const count = await countUsersWithoutMembership(
        dataSourceSqlExecutor(this.dataSource),
      );
      if (count > 0) {
        this.logger.warn(
          `${count} usuario(s) que no son super-admin no tienen membresía de condominio: no aparecen en ningún condominio. ` +
            'Revisa y corrige con `node scripts/backfill-memberships.js` (dry-run) y luego `--apply`.',
        );
      }
      return count;
    } catch (error) {
      this.logger.error(
        'No se pudo contar los usuarios sin membresía de condominio',
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /** Agrega al usuario como miembro del condominio. Propaga el error de better-auth. */
  async addMember(
    userId: string,
    organizationId: string,
    role: OrganizationMemberRole = 'member',
  ): Promise<void> {
    await this.betterAuthService.api.addMember({
      body: { userId, organizationId, role },
    });
  }

  /**
   * Crea el condominio (`organization`) con `ownerUserId` como owner (better-auth
   * crea también su membresía). Propaga el error de better-auth.
   */
  async createOrganization(input: CreateOrganizationInput) {
    return this.betterAuthService.api.createOrganization({
      body: {
        name: input.name,
        slug: input.slug,
        userId: input.ownerUserId,
      },
    });
  }

  /**
   * Todos los condominios (`organization`), ordenados por nombre. Solo para
   * la plataforma: `GET /onboarding/condominiums` (Fase 4 · P5.C, selector
   * del super-admin al crear usuarios o recursos). A diferencia de las
   * consultas de membresía, un error de BD se propaga (500): un listado vacío
   * por error confundiría al operador.
   */
  async listOrganizations(): Promise<OrganizationSummary[]> {
    return this.dataSource.query<OrganizationSummary[]>(
      `SELECT id, name, slug FROM organization ORDER BY name ASC, id ASC`,
    );
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return this.exists(
      `SELECT 1 AS ok FROM organization WHERE id = $1 LIMIT 1`,
      [organizationId],
    );
  }

  async isSlugTaken(slug: string): Promise<boolean> {
    return this.exists(
      `SELECT 1 AS ok FROM organization WHERE slug = $1 LIMIT 1`,
      [slug],
    );
  }

  /** Condominio del usuario por membresía (la más antigua), o `null`. */
  async getOrganizationIdForUser(userId: string): Promise<string | null> {
    return resolveOrganizationIdForUser(userId, this.dataSource);
  }

  /**
   * ¿El usuario tiene membresía en el condominio? Sin mirar si la cuenta está
   * deshabilitada: un usuario deshabilitado sigue siendo del condominio (su
   * administrador lo ve y lo puede habilitar). Fail-closed ante errores.
   */
  async isMemberOfOrganization(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    return this.exists(
      `SELECT 1 AS ok FROM member WHERE "userId" = $1 AND "organizationId" = $2 LIMIT 1`,
      [userId, organizationId],
    );
  }

  /** Miembro del condominio Y con la cuenta activa (no deshabilitada). */
  async isActiveMember(
    userId: string,
    organizationId: string,
  ): Promise<boolean> {
    return isActiveMemberOfOrganization(
      userId,
      organizationId,
      this.dataSource,
    );
  }

  /** `true` si la consulta devuelve alguna fila; `false` ante errores (fail-closed). */
  private async exists(sql: string, params: unknown[]): Promise<boolean> {
    try {
      const rows = await this.dataSource.query<Array<{ ok: number }>>(
        sql,
        params,
      );
      return rows.length > 0;
    } catch (error) {
      this.logger.warn(
        `Consulta de membresía fallida (se trata como inexistente): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
