import { CanActivate, ExecutionContext, Injectable, Inject, ForbiddenException, BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CamerasService } from '../cameras.service';
import { User } from 'src/users/entities/user.entity';

@Injectable()
export class CameraViewGuard implements CanActivate {
  constructor(private readonly camerasService: CamerasService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // Intentamos leer cameraMount (mountPath) o cameraId desde body para mayor compatibilidad
    const cameraMount = req?.body?.cameraMount ?? req?.body?.cameraId;
    if (!cameraMount) throw new BadRequestException('Se requiere cameraMount o cameraId en el body');

    // Se espera que auth guard haya poblado req.user con roles (array)
    const user = req.user as Partial<User>;
    if (!user) throw new ForbiddenException('Usuario no autenticado');

    // Comprobar que la cámara existe y su estado
  const cameraEntity = await this.camerasService.getCameraByIdOrMount(cameraMount as string);
  if (!cameraEntity) throw new NotFoundException('Cámara no encontrada');

  // Si la cámara existe pero está inactiva o no registrada en el gateway, devolver 503 (servicio no disponible)
  if (cameraEntity.active === false) throw new ServiceUnavailableException('Cámara encontrada, pero está marcada como inactiva');
  if (!cameraEntity.registeredInMediamtx) throw new ServiceUnavailableException('Cámara encontrada, pero no está registrada en el gateway de medios');

    // Extraer role ids desde user.roles (puede variar según implementación)
    if (!user.roles || user.roles.length === 0) {
      throw new ForbiddenException('Usuario sin roles asignados');
    }
    let userRoleIds: string[] = [];
    if (Array.isArray(user.roles)) {
      userRoleIds = user.roles.map((r: any) => (typeof r === 'string' ? r : r.id));
    }

    const allowed = await this.camerasService.userHasAccessToCameraByRoles(cameraMount as string, userRoleIds);
    if (!allowed) throw new ForbiddenException('No tiene permisos para ver la cámara solicitada');
    return true;
  }
}
