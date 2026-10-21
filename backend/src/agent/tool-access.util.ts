import type { AgentChannel } from './agent-channel';
import type { AuthorizedContext } from './types/authorized-context.type';
import type { VigiliaTool } from './types/vigilia-tool.type';

/** Tool del catálogo, sin importar sus tipos de entrada/salida. */
type AnyVigiliaTool = VigiliaTool<unknown, unknown>;

/**
 * Fase 4 · P4.B (D8): ¿la tool se puede usar desde este canal? Solo si está
 * en su `allowedChannels` (obligatorio); `unknown` nunca.
 */
export function isToolAllowedOnChannel(
  tool: AnyVigiliaTool,
  channel: AgentChannel,
): boolean {
  if (channel === 'unknown') {
    return false;
  }
  return tool.allowedChannels.includes(channel);
}

/**
 * Regla dura #6 del §5: mismo criterio "alguno de los requeridos" que
 * `AuthorizationGuard` para el caso no-vacío. Implementación PROPIA (no
 * llama a `hasAnyPermission` de auth/utils/permissions.util.ts) porque el
 * caso `[]` tiene semántica opuesta a propósito: una tool con
 * `requiredScopes: []` no declaró ningún gate de permisos, así que cualquier
 * `AuthorizedContext` autenticado puede ejecutarla — a diferencia de
 * `@RequirePermissions()` vacío en una ruta HTTP, que deniega.
 */
export function hasRequiredScopes(
  tool: AnyVigiliaTool,
  ctx: Pick<AuthorizedContext, 'scopes'>,
): boolean {
  if (tool.requiredScopes.length === 0) {
    return true;
  }
  return tool.requiredScopes.some((scope) => ctx.scopes.includes(scope));
}

/**
 * ¿El contexto puede usar la tool? Canal Y scopes: el mismo criterio que
 * aplica el dispatcher al ejecutar y el registry al listar las tools que ve
 * el modelo (una sola fuente de verdad).
 */
export function isToolAvailableFor(
  tool: AnyVigiliaTool,
  ctx: Pick<AuthorizedContext, 'channel' | 'scopes'>,
): boolean {
  return (
    isToolAllowedOnChannel(tool, ctx.channel) && hasRequiredScopes(tool, ctx)
  );
}
