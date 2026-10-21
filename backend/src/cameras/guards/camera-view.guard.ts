import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CamerasService } from '../cameras.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import type { TenantContext } from '../../common/tenant/tenant-context.types';
import { isInTenant } from '../../common/tenant/tenant-context.util';
import type { Camera } from '../entities/camera.entity';

/** Cámara ya autorizada por `CameraViewGuard`, expuesta en `request.authorizedCamera`. */
export interface AuthorizedCamera {
  id: string;
  /** Path de MediaMTX de la cámara (su `mountPath`, o su id si no tiene). */
  mountPath: string;
}

/** Lo que el guard lee de la request HTTP y lo que deja en ella. */
export interface CameraViewRequest {
  body?: { cameraMount?: unknown; cameraId?: unknown };
  user?: { roles?: Array<{ id: string } | string> };
  authorizedCamera?: AuthorizedCamera;
}

/**
 * `true` si el actor puede ver cámaras del condominio de `camera`: el
 * super-admin ve todas; el resto, solo las de SU condominio (mismo criterio
 * que `scopeWhere`). Fase 4 · P5.C: un actor sin condominio no ve ninguna
 * (antes, las del "cajón nulo").
 */
export function isCameraInActorTenant(
  camera: Pick<Camera, 'organizationId'>,
  ctx: TenantContext,
): boolean {
  return isInTenant(camera.organizationId, ctx);
}

function roleIdsOf(user: CameraViewRequest['user']): string[] {
  return (user?.roles ?? []).map((role) =>
    typeof role === 'string' ? role : role.id,
  );
}

/**
 * Autorización por cámara de `POST /streams/whep`.
 *
 * Fase 4 · P5.B: antes solo comparaba ids de rol (globales), así que un
 * usuario con el rol asignado a una cámara de OTRO condominio podía verla.
 * Ahora, en este orden:
 *  1. la cámara debe ser del condominio del actor (super-admin: todas). El
 *     contexto se resuelve con `TenantContextService`: el `TenantInterceptor`
 *     todavía no corrió en la fase de guards. Otro condominio o inexistente:
 *     404, ANTES de mirar su estado (no revela que existe ni si está activa);
 *  2. activa y registrada en MediaMTX (503 si no);
 *  3. alguno de los roles del actor está asignado a la cámara (403 si no).
 *
 * Deja la cámara autorizada en `request.authorizedCamera`: el controller usa
 * ESA cámara (no el string crudo del body) para negociar el WHEP.
 */
@Injectable()
export class CameraViewGuard implements CanActivate {
  constructor(
    private readonly camerasService: CamerasService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CameraViewRequest>();

    // cameraMount (mountPath) o cameraId desde el body, por compatibilidad.
    const cameraMount = req.body?.cameraMount ?? req.body?.cameraId;
    if (typeof cameraMount !== 'string' || cameraMount.length === 0) {
      throw new BadRequestException(
        'Se requiere cameraMount o cameraId en el body',
      );
    }

    // AuthGuard ya pobló req.user con sus roles.
    if (!req.user) throw new ForbiddenException('Usuario no autenticado');

    const ctx = await this.tenantContext.getContext();
    const camera = await this.camerasService.getCameraByIdOrMount(cameraMount);
    if (!camera || !isCameraInActorTenant(camera, ctx)) {
      throw new NotFoundException('Cámara no encontrada');
    }

    // Cámara inactiva o no registrada en el gateway: 503.
    if (camera.active === false) {
      throw new ServiceUnavailableException(
        'Cámara encontrada, pero está marcada como inactiva',
      );
    }
    if (!camera.registeredInMediamtx) {
      throw new ServiceUnavailableException(
        'Cámara encontrada, pero no está registrada en el gateway de medios',
      );
    }

    const userRoleIds = roleIdsOf(req.user);
    if (userRoleIds.length === 0) {
      throw new ForbiddenException('Usuario sin roles asignados');
    }
    const cameraRoleIds = (camera.roles ?? []).map((role) => role.id);
    if (!userRoleIds.some((roleId) => cameraRoleIds.includes(roleId))) {
      throw new ForbiddenException(
        'No tiene permisos para ver la cámara solicitada',
      );
    }

    req.authorizedCamera = {
      id: camera.id,
      mountPath:
        camera.mountPath && camera.mountPath.length > 0
          ? camera.mountPath
          : camera.id,
    };
    return true;
  }
}
