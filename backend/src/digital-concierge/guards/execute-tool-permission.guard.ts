import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthorizedContextRequest } from '../../agent/authorized-context.factory';
import {
  getUserPermissionNames,
  hasAnyPermission,
} from '../../auth/utils/permissions.util';

/** Permiso que exige `execute-tool` a una sesión humana. */
export const EXECUTE_TOOL_PERMISSION = 'digital-concierge.access';

/**
 * Corrección P7 (cyber A1): `POST /concierge/session/:id/execute-tool` exige
 * `digital-concierge.access` a una sesión HUMANA antes de validar el body
 * (corre después de `ConciergeAuthGuard`, antes del throttler, que es el
 * último guard del método por convención, y antes del `ValidationPipe`). Antes cualquier usuario con sesión llegaba al
 * dispatcher, que auditaba su input crudo. Un dispositivo (hub físico o
 * kiosko) sigue entrando con su credencial: `HubAuthGuard` ya lo autenticó y
 * su baseline de scopes es justamente ese permiso.
 */
@Injectable()
export class ExecuteToolPermissionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthorizedContextRequest>();
    if (request.hub) {
      return true;
    }
    if (
      request.user &&
      hasAnyPermission(getUserPermissionNames(request.user), [
        EXECUTE_TOOL_PERMISSION,
      ])
    ) {
      return true;
    }
    throw new ForbiddenException(
      `Acceso denegado. Se requiere: Permisos: ${EXECUTE_TOOL_PERMISSION}`,
    );
  }
}
