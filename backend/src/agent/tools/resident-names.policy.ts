import type { AuthorizedContext } from '../types/authorized-context.type';

/**
 * Fase 4 · P7.L (docs/modulos/privacidad-ley-21719.md §5.1): ¿la salida de
 * una tool puede traer nombres de residentes? Solo en el canal humano
 * (conserje o administración con sesión). Los dispositivos (`physical-hub`,
 * `web-kiosk`) y cualquier canal no reconocido reciben ids y conteos:
 * fail-closed.
 */
export function exposesResidentNames(
  ctx: Pick<AuthorizedContext, 'channel'>,
): boolean {
  return ctx.channel === 'human';
}
