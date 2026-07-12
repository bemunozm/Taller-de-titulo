import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Observable } from 'rxjs';
import { resolveTenantContext } from './tenant-context.util';

/**
 * Interceptor GLOBAL (registrado como APP_INTERCEPTOR en tenant.module.ts) —
 * resuelve el TenantContext UNA vez por request y lo cachea en
 * `request.tenantContext`, para que `TenantContextService` (y cualquier
 * servicio que lo consuma) no repita la query a `member` en cada inyección.
 *
 * Corre DESPUÉS de los guards (AuthGuard ya pobló `request.user` si aplica) y
 * ANTES del handler del controller — orden estándar de Nest
 * (Guards → Interceptors(pre) → Handler). Si la ruta es @Public o es un
 * endpoint de worker (sin AuthGuard), `request.user` es `undefined` y el
 * contexto resultante es el "vacío" (sin organización, sin bypass) — no
 * lanza, para no romper esos endpoints.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest();
      if (!request.tenantContext) {
        request.tenantContext = await resolveTenantContext(request.user, this.dataSource);
      }
    }
    return next.handle();
  }
}
