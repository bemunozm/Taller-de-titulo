import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { LogsService } from '../logs.service';
import { ServiceName } from '../entities/system-log.entity';

/**
 * Interceptor global para loguear todas las peticiones HTTP entrantes al backend
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  constructor(private readonly logsService: LogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const correlationId = headers['x-correlation-id'] || uuidv4();

    // Agregar correlation ID a la respuesta
    response.setHeader('X-Correlation-Id', correlationId);

    const startTime = Date.now();

    // Sanitizar datos sensibles del request
    const sanitizedBody = this.sanitizeData(request.body);

    // Log de request
    this.logsService.logHttpRequest({
      service: ServiceName.BACKEND,
      method,
      url,
      requestData: sanitizedBody,
      correlationId,
      ipAddress: ip,
      userAgent,
    }).catch(err => {
      this.logger.error(`Failed to log HTTP request: ${err.message}`);
    });

    return next.handle().pipe(
      tap(data => {
        const responseTime = Date.now() - startTime;
        const statusCode = response.statusCode;

        // Sanitizar datos sensibles de la respuesta
        const sanitizedResponse = this.sanitizeData(data);

        // Log de response exitosa
        this.logsService.logHttpResponse({
          service: ServiceName.BACKEND,
          method,
          url,
          statusCode,
          responseTime,
          responseData: sanitizedResponse,
          correlationId,
        }).catch(err => {
          this.logger.error(`Failed to log HTTP response: ${err.message}`);
        });
      }),
      catchError(error => {
        const responseTime = Date.now() - startTime;

        // Log de error
        this.logsService.logHttpError({
          service: ServiceName.BACKEND,
          method,
          url,
          error,
          correlationId,
          requestData: sanitizedBody,
        }).catch(err => {
          this.logger.error(`Failed to log HTTP error: ${err.message}`);
        });

        throw error;
      }),
    );
  }

  /**
   * Sanitizar datos sensibles (passwords, tokens, etc.)
   */
  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sensitiveFields = [
      'password',
      'currentPassword',
      'newPassword',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'secret',
      'authorization',
    ];

    const sanitized = Array.isArray(data) ? [...data] : { ...data };

    for (const key in sanitized) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    }

    return sanitized;
  }
}
