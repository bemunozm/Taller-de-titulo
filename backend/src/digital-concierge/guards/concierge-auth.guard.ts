import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { HubAuthGuard } from '../../hub/guards/hub-auth.guard';

/**
 * Guard de transporte para `/concierge/*` (Fase 1, Bloque A1 —
 * docs/modulos/agente-cerebro.md §7). Antes de esta tarea el controller no
 * tenía NINGÚN guard — cualquiera podía llamar `execute-tool`/`respond`/etc.
 *
 * Los dos clientes-transporte válidos son:
 *  (a) el HUB físico (Raspberry Pi) — credenciales de máquina, ver
 *      `HubAuthGuard` (headers `X-Hub-Secret` + `X-Hub-Id`).
 *  (b) un usuario humano autenticado — sesión de better-auth o JWT legacy,
 *      ver `AuthGuard` (el MISMO guard que usa el resto del sistema
 *      post-Fase 0 — se reutiliza tal cual, sin reinventar un esquema).
 *
 * Precedencia EXPLÍCITA (no se intentan ambos "a ciegas"): si llega el header
 * `X-Hub-Secret`, el request se trata como transporte de hub y DEBE pasar
 * `HubAuthGuard` — si el secret/hubId son inválidos, falla con 401 en vez de
 * caer silenciosamente a intentar sesión humana (evita enmascarar un hub mal
 * configurado como "no autenticado" genérico). Si NO llega ese header, se
 * exige sesión humana vía `AuthGuard`.
 *
 * SUPUESTO A CONFIRMAR (reportado en la tarea): hoy `/digital-concierge` en
 * el frontend (`DigitalConciergeView.tsx`) es una ruta PÚBLICA sin login —
 * no pasa por el Hub físico ni abre sesión de better-auth. Tras este guard,
 * ese flujo por navegador puro (sin pasar por el Hub) quedará en 401 hasta
 * que se le agregue un paso de autenticación — cambio de frontend, fuera de
 * alcance de este bloque.
 */
@Injectable()
export class ConciergeAuthGuard implements CanActivate {
  constructor(
    private readonly hubAuthGuard: HubAuthGuard,
    private readonly authGuard: AuthGuard,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const hasHubSecret = typeof request.headers?.['x-hub-secret'] === 'string';

    if (hasHubSecret) {
      return this.hubAuthGuard.canActivate(context);
    }

    return this.authGuard.canActivate(context);
  }
}
