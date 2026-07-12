import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TenantContextService } from './tenant-context.service';
import { TenantInterceptor } from './tenant.interceptor';

/**
 * Mecanismo de tenant scoping reutilizable (Fase 0, tarea #19 —
 * docs/modulos/auth-multitenant.md §7). `@Global()` para que cualquier
 * módulo de dominio pueda inyectar `TenantContextService` sin re-importar
 * este módulo (mismo criterio que `BetterAuthModule.forRoot` en app.module.ts,
 * que también es global).
 *
 * NOTA de performance: `TenantContextService` es REQUEST-scoped, así que
 * cualquier servicio que lo inyecte se vuelve request-scoped en cascada
 * (instancia por request en vez de singleton). Es el trade-off estándar de
 * Nest para tenant-context — aceptable al tamaño de este sistema. Si en el
 * futuro esto pesa en performance, la alternativa es leer
 * `request.tenantContext` (ya cacheado por TenantInterceptor) directamente
 * vía `@Inject(REQUEST)` en los puntos calientes, sin pasar por el service.
 */
@Global()
@Module({
  providers: [
    TenantContextService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
  exports: [TenantContextService],
})
export class TenantModule {}
