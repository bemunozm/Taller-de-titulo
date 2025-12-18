import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { FILTER_BY_USER_KEY } from '../decorators/filter-by-user.decorator';

/**
 * Interceptor que agrega automáticamente filtros de usuario a las queries
 * basándose en el rol del usuario autenticado.
 * 
 * - ADMIN/SUPER ADMIN: No aplica filtros (ve todos los datos)
 * - OTROS ROLES: Aplica filtros automáticamente:
 *   - 'self': Filtra por userId (solo ve sus propios datos)
 *   - 'family': Filtra por familyId (ve datos de toda su familia)
 */
@Injectable()
export class UserFilterInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UserFilterInterceptor.name);

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const filterType = this.reflector.get<string>(FILTER_BY_USER_KEY, context.getHandler());
    
    if (!filterType) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.logger.warn('⚠️ No hay usuario en el request - omitiendo filtro');
      return next.handle();
    }

    // Verificar si el usuario tiene permisos de administrador
    const isAdmin = this.checkIfAdmin(user);

    if (isAdmin) {
      this.logger.debug(`🔓 Usuario ${user.email} es ADMIN - sin filtros`);
      return next.handle();
    }

    // Aplicar filtro según el tipo para usuarios NO admin
    this.applyFilter(filterType, request, user);

    return next.handle();
  }

  /**
   * Verifica si el usuario tiene permisos de administrador
   */
  private checkIfAdmin(user: any): boolean {
    // Verificar por nombre de rol (según default-roles.constant.ts)
    const adminRoles = ['super administrador', 'administrador'];
    if (user.roles?.some((role) => adminRoles.includes(role.name?.toLowerCase()))) {
      return true;
    }

    // Verificar por permiso específico de admin.dashboard (según default-permissions.constant.ts)
    if (
      user.roles?.some((role) =>
        role.permissions?.some((p) => p.name === 'admin.dashboard'),
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Aplica el filtro correspondiente al query
   */
  private applyFilter(filterType: string, request: any, user: any): void {
    switch (filterType) {
      case 'self':
        // Filtrar solo por el usuario actual
        request.query.userId = user.id;
        request.filterUserId = user.id; // También guardarlo en el request directamente
        this.logger.debug(`🔒 Usuario ${user.email} - Filtro SELF: userId = ${user.id}`);
        break;

      case 'family':
        // Filtrar por toda la familia del usuario
        if (user.family?.id) {
          request.query.familyId = user.family.id;
          request.filterFamilyId = user.family.id; // También guardarlo en el request directamente
          this.logger.debug(`🔒 Usuario ${user.email} - Filtro FAMILY: familyId = ${user.family.id}`);
        } else {
          this.logger.warn(`⚠️ Usuario ${user.email} no tiene familia asignada - sin filtros aplicados`);
        }
        break;

      default:
        this.logger.warn(`⚠️ Tipo de filtro desconocido: "${filterType}". Solo se permiten 'self' y 'family'`);
    }
  }
}
