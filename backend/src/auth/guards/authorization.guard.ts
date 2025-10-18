import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Si no hay restricciones, permite el acceso
    if (!requiredRoles && !requiredPermissions) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    if (!user.roles || user.roles.length === 0) {
      throw new ForbiddenException('Usuario sin roles asignados');
    }

    // Obtener nombres de roles del usuario
    const userRoleNames = user.roles.map(role => role.name);
    
    // Obtener todos los permisos del usuario
    const userPermissions = user.roles.reduce((allPermissions, role) => {
      const rolePermissions = role.permissions?.map(p => p.name) || [];
      return [...allPermissions, ...rolePermissions];
    }, []);

    // Verificar roles (si están definidos)
    if (requiredRoles) {
      const hasRole = requiredRoles.some(role => userRoleNames.includes(role));
      if (hasRole) {
        return true; // Si tiene el rol, no necesita verificar permisos
      }
    }

    // Verificar permisos (si están definidos)
    if (requiredPermissions) {
      const hasPermission = requiredPermissions.some(permission => 
        userPermissions.includes(permission)
      );
      if (hasPermission) {
        return true;
      }
    }

    // Si llegamos aquí, no tiene ni el rol ni los permisos
    const roleNames = requiredRoles ? `Roles: ${requiredRoles.join(', ')}` : '';
    const permissionNames = requiredPermissions ? `Permisos: ${requiredPermissions.join(', ')}` : '';
    const requirements = [roleNames, permissionNames].filter(Boolean).join(' o ');
    
    throw new ForbiddenException(`Acceso denegado. Se requiere: ${requirements}`);
  }
}