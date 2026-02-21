import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  
  //Atributos
  private readonly jwtService: JwtService;
  //Constructor
  constructor(
    jwtService: JwtService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private reflector: Reflector,
  ) {
    this.jwtService = jwtService;
  }

  async canActivate(context: ExecutionContext,): Promise<boolean> {
    // Verificar si el endpoint está marcado como público
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (isPublic) {
      return true;
    }

    // El objeto context proporciona información
    // sobre la solicitud entrante y el entorno de ejecución.
    const request = context.switchToHttp().getRequest();

    // Aquí puedes implementar tu lógica de autenticación o autorización.
    // Por ejemplo, verificar si el usuario está autenticado, si tiene los roles adecuados, etc.

    // Si la validación es exitosa, devuelve true, permitiendo el acceso.
    // Si la validación falla, devuelve false, denegando el acceso.
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const payload = await this.jwtService.verifyAsync(token);
      
      // Cargar usuario completo con roles, permisos y familia desde la BD
      const user = await this.userRepository.findOne({
        where: { id: payload.id },
        relations: ['roles', 'roles.permissions', 'family']
      });

      if (!user) {
        throw new UnauthorizedException('Usuario no encontrado');
      }

      // Guardar usuario completo en request (no solo payload)
      request.user = user;
    } catch (error) {
      throw new UnauthorizedException('Error validando el token');
    }

    return true;
  }

  private extractTokenFromHeader(request: any) {
    const authHeader = request.headers.authorization;
    if (!authHeader) return undefined;
    
    const parts = authHeader.split(/\s+/);
    const [type, token] = parts;
    return type === "Bearer" ? token : undefined;
  }
}
