import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from '../audit.service';
import { AUDITABLE_KEY, AuditableOptions } from '../decorators/auditable.decorator';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly jwtService: JwtService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditConfig = this.reflector.get<AuditableOptions>(
      AUDITABLE_KEY,
      context.getHandler(),
    );

    if (!auditConfig) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const ip = request.ip || request.connection.remoteAddress;
    const userAgent = request.headers['user-agent'];
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: async (response) => {
          const duration = Date.now() - startTime;
          
          // Para el caso de LOGIN, extraer userId del JWT token
          let userId = user?.sub || user?.id;
          let entityId = response?.id || request.params?.id;
          
          if (auditConfig.action === 'LOGIN' && typeof response === 'string') {
            try {
              const decoded = this.jwtService.decode(response);
              userId = decoded?.id || decoded?.sub;
              // Para LOGIN, el entityId es el mismo usuario que inició sesión
              entityId = userId;
            } catch (error) {
              console.error('Failed to decode JWT for audit:', error);
            }
          }
          
          try {
            await this.auditService.log({
              module: auditConfig.module,
              action: auditConfig.action,
              userId: userId,
              entityId: entityId,
              entityType: auditConfig.entityType,
              newValue: auditConfig.captureResponse ? this.sanitizeData(response) : undefined,
              oldValue: auditConfig.captureOldValue ? request.oldValue : undefined,
              metadata: {
                ip,
                userAgent,
                endpoint: request.url,
                method: request.method,
                statusCode: context.switchToHttp().getResponse().statusCode,
                duration,
              },
              description: auditConfig.description,
            });
          } catch (error) {
            // No bloquear la respuesta si falla el logging
            console.error('Failed to log audit:', error);
          }
        },
        error: async (error) => {
          const duration = Date.now() - startTime;
          
          try {
            await this.auditService.log({
              module: auditConfig.module,
              action: auditConfig.action,
              userId: user?.sub || user?.id,
              entityId: request.params?.id,
              entityType: auditConfig.entityType,
              metadata: {
                ip,
                userAgent,
                endpoint: request.url,
                method: request.method,
                statusCode: error.status || 500,
                duration,
              },
              description: `${auditConfig.description} - FAILED: ${error.message}`,
            });
          } catch (logError) {
            console.error('Failed to log audit error:', logError);
          }
        },
      }),
    );
  }

  private sanitizeData(data: any): any {
    if (!data) return data;
    
    const sanitized = { ...data };
    const sensitiveFields = ['password', 'token', 'refreshToken', 'secret', 'apiKey'];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
}
