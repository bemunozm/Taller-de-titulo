import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { fromNodeHeaders } from 'better-auth/node';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { User } from '../users/entities/user.entity';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

/**
 * Guard de autenticación — Fase 0, tarea #17 (docs/modulos/auth-multitenant.md
 * §3/§12). Reemplaza SOLO la capa de sesión: `AuthorizationGuard` y los 114
 * usos de `@RequirePermissions`/`@RequireRoles` siguen intactos porque ambos
 * caminos de abajo terminan poblando `request.user` con el MISMO User de
 * TypeORM (roles + roles.permissions + family) que poblaban antes.
 *
 * MODO DUAL (transitorio — se retira en #21):
 *   1) Sesión de better-auth (cookie httpOnly) — PRIMARIO. El frontend aún no
 *      migra a cookies hasta la tarea #20.
 *   2) JWT Bearer legacy (`AuthService`/`auth.guard` propio) — FALLBACK,
 *      mientras el frontend siga mandando `Authorization: Bearer <JWT>`.
 * Si ninguno de los dos resuelve un usuario, 401.
 *
 * `BetterAuthService` se inyecta vía DI (no se importa el singleton `auth` de
 * better-auth.ts a mano) porque `BetterAuthModule.forRoot(...)` en
 * app.module.ts es global por defecto (`isGlobal` no está seteado a false),
 * así que el provider está disponible en todo el árbol de DI sin imports
 * adicionales.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly reflector: Reflector,
    private readonly betterAuthService: BetterAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Verificar si el endpoint está marcado como público
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    const userId =
      (await this.resolveUserIdFromBetterAuthSession(request)) ??
      (await this.resolveUserIdFromLegacyJwt(request));

    if (!userId) {
      throw new UnauthorizedException();
    }

    // Cargar usuario completo con roles, permisos y familia desde la BD —
    // MISMA forma que antes, para que AuthorizationGuard no note el cambio.
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['roles', 'roles.permissions', 'family'],
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    request.user = user;
    return true;
  }

  /** Camino primario: sesión de better-auth vía cookie httpOnly. */
  private async resolveUserIdFromBetterAuthSession(request: any): Promise<string | null> {
    try {
      const session = await this.betterAuthService.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      return session?.user?.id ?? null;
    } catch (error) {
      // No debería lanzar (better-auth devuelve null si no hay sesión válida),
      // pero si lo hace no rompemos el camino legacy — solo lo logueamos.
      this.logger.debug(`better-auth getSession falló, se intenta JWT legacy: ${error}`);
      return null;
    }
  }

  /** Camino fallback: JWT Bearer legacy (retirar en la tarea #21). */
  private async resolveUserIdFromLegacyJwt(request: any): Promise<string | null> {
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      return null;
    }

    try {
      // Tarea #21: restringe explícitamente el algoritmo de verificación a
      // HS256 (defensa en profundidad — JwtModule ya lo fija por default vía
      // `verifyOptions` en auth.module.ts, pero fijarlo también acá evita que
      // un cambio futuro en esa config debilite silenciosamente este guard).
      // Sin esto, un JWT firmado con `alg: none` u otro algoritmo inesperado
      // podría ser aceptado dependiendo de la configuración de jsonwebtoken.
      const payload = await this.jwtService.verifyAsync(token, { algorithms: ['HS256'] });
      return payload?.id ?? null;
    } catch {
      throw new UnauthorizedException('Error validando el token');
    }
  }

  private extractTokenFromHeader(request: any) {
    const authHeader = request.headers.authorization;
    if (!authHeader) return undefined;

    const parts = authHeader.split(/\s+/);
    const [type, token] = parts;
    return type === "Bearer" ? token : undefined;
  }
}
