import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingHttpHeaders } from 'http';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import { User } from '../users/entities/user.entity';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { BetterAuthSessionResolver } from './better-auth-session.resolver';

/**
 * Guard de autenticación. Resuelve SOLO la sesión de better-auth (cookie
 * httpOnly): `AuthorizationGuard` y los `@RequirePermissions`/`@RequireRoles`
 * siguen intactos porque `request.user` se puebla con el User de TypeORM
 * (roles + roles.permissions + family).
 *
 * P2 (hardening): se retiró el fallback de JWT Bearer legacy. Un
 * `Authorization: Bearer <JWT>` ya NO autentica; las credenciales de máquina
 * usan `ServiceApiKeyGuard` (header `x-api-key`).
 *
 * `BetterAuthService` se inyecta vía DI porque `BetterAuthModule.forRoot(...)`
 * en app.module.ts es global.
 *
 * Fase 4 · P6.R (D13): la lectura de la sesión y la carga del usuario viven en
 * `BetterAuthSessionResolver`, compartido con el gateway de tiempo real. El
 * guard lo COMPONE con sus propias dependencias en vez de recibirlo por
 * constructor: Nest instancia `@UseGuards(AuthGuard)` en el módulo de cada
 * controller (25 módulos, y varios specs lo declaran como provider), y una
 * dependencia nueva obligaría a registrar el resolver en todos ellos.
 */
/** Request HTTP tal como la usa este guard: lee headers y deja `user`. */
interface SessionRequest {
  headers: IncomingHttpHeaders;
  user?: User;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly sessionResolver: BetterAuthSessionResolver;

  constructor(
    @InjectRepository(User)
    userRepository: Repository<User>,
    private readonly reflector: Reflector,
    betterAuthService: BetterAuthService,
  ) {
    this.sessionResolver = new BetterAuthSessionResolver(
      betterAuthService,
      userRepository,
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Verificar si el endpoint está marcado como público
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<SessionRequest>();

    const userId = await this.sessionResolver.resolveUserId(request.headers);

    if (!userId) {
      throw new UnauthorizedException();
    }

    // Cargar usuario completo con roles, permisos y familia desde la BD —
    // MISMA forma que antes, para que AuthorizationGuard no note el cambio.
    const user = await this.sessionResolver.loadSessionUser(userId);

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    request.user = user;
    return true;
  }
}
