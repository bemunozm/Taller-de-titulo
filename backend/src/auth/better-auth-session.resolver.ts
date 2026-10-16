import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { IncomingHttpHeaders } from 'http';
import { Repository } from 'typeorm';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { User } from '../users/entities/user.entity';

/**
 * Relaciones del `User` de la app que necesitan la autorización y el tenant:
 * roles + permisos (`AuthorizationGuard`, `getUserPermissionNames`,
 * super-admin) y familia (alcance por familia, `TenantActor.familyId`).
 */
export const SESSION_USER_RELATIONS: string[] = [
  'roles',
  'roles.permissions',
  'family',
];

/** Sesión de better-auth vigente, tal como la usa el tiempo real. */
export interface ResolvedBetterAuthSession {
  userId: string;
  /** `session.id` (no el token): identifica la sesión en el hook de borrado. */
  sessionId: string;
  expiresAt: Date;
}

/** Forma mínima que leemos de `auth.api.getSession` (con o sin customSession). */
interface GetSessionResult {
  user?: { id?: unknown } | null;
  session?: { id?: unknown; expiresAt?: unknown } | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function validDate(value: unknown): Date | null {
  if (!(value instanceof Date) && typeof value !== 'string') {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Fase 4 · P6.R (D13): ÚNICA lectura de la sesión de better-auth desde la
 * cookie httpOnly. La usan `AuthGuard` (HTTP) y `NotificationsGateway`
 * (handshake y revalidación del socket); antes cada uno tenía su copia de
 * `getSession` + manejo de errores.
 *
 *  - `resolveUserId`: el usuario de una request HTTP. Comportamiento
 *    histórico de `AuthGuard`: la llamada puede extender la sesión (refresh
 *    de better-auth, como cualquier request del navegador).
 *  - `resolveSession`: sesión con `id` y expiración, SIN extenderla
 *    (`disableRefresh`): un socket abierto no es actividad del usuario y no
 *    debe mantener viva la sesión para siempre.
 *  - `loadSessionUser`: el `User` de la app con roles, permisos y familia.
 *    `findOne` excluye a los usuarios deshabilitados (soft-delete).
 *
 * Fail-closed: un error de better-auth o de la BD se trata como "sin sesión"
 * (`null`) y se loguea en `debug` sin datos de la cookie.
 */
@Injectable()
export class BetterAuthSessionResolver {
  private readonly logger = new Logger(BetterAuthSessionResolver.name);

  constructor(
    private readonly betterAuthService: BetterAuthService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /** Id del usuario de la sesión de la request (`null` si no hay sesión). */
  async resolveUserId(headers: IncomingHttpHeaders): Promise<string | null> {
    const result = await this.fetchSession(headers, { refresh: true });
    return nonEmptyString(result?.user?.id);
  }

  /**
   * Sesión vigente con su `id` y expiración, sin extenderla. `null` si no
   * hay sesión, si venció o si better-auth no entrega `id`/`expiresAt`.
   */
  async resolveSession(
    headers: IncomingHttpHeaders,
    now: Date = new Date(),
  ): Promise<ResolvedBetterAuthSession | null> {
    const result = await this.fetchSession(headers, { refresh: false });
    const userId = nonEmptyString(result?.user?.id);
    const sessionId = nonEmptyString(result?.session?.id);
    const expiresAt = validDate(result?.session?.expiresAt);
    if (!userId || !sessionId || !expiresAt) {
      return null;
    }
    if (expiresAt.getTime() <= now.getTime()) {
      return null;
    }
    return { userId, sessionId, expiresAt };
  }

  /** `User` de la app con roles, permisos y familia (`null` si no existe o está deshabilitado). */
  async loadSessionUser(userId: string): Promise<User | null> {
    return await this.userRepository.findOne({
      where: { id: userId },
      relations: SESSION_USER_RELATIONS,
    });
  }

  private async fetchSession(
    headers: IncomingHttpHeaders,
    options: { refresh: boolean },
  ): Promise<GetSessionResult | null> {
    try {
      const result: unknown = await this.betterAuthService.api.getSession({
        headers: fromNodeHeaders(headers),
        ...(options.refresh ? {} : { query: { disableRefresh: true } }),
      });
      return typeof result === 'object' && result !== null ? result : null;
    } catch (error) {
      // No debería lanzar (better-auth devuelve null si no hay sesión válida).
      this.logger.debug(
        `better-auth getSession falló: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
