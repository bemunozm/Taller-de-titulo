import { HubType } from '../hub/entities/hub.entity';

/**
 * Canales por los que llega un turno del agente-cerebro (Fase 4 · P4.B, D6/D8):
 *  - `physical-hub`: citófono físico (Raspberry Pi con relés del portón).
 *  - `web-kiosk`: tótem web del condominio (navegador público, sin relés).
 *  - `human`: usuario con sesión de better-auth (conserje, admin).
 *  - `unknown`: request sin identidad reconocible. Nunca ejecuta tools.
 *
 * El canal lo deriva SIEMPRE el backend (`AuthorizedContextFactory`) a partir
 * de la credencial autenticada, nunca del body ni del modelo.
 */
export const AGENT_CHANNELS = [
  'physical-hub',
  'web-kiosk',
  'human',
  'unknown',
] as const;

export type AgentChannel = (typeof AGENT_CHANNELS)[number];

/** Canales con identidad: los que puede habilitar una tool. */
export type IdentifiedAgentChannel = Exclude<AgentChannel, 'unknown'>;

export function isAgentChannel(value: unknown): value is AgentChannel {
  return (
    typeof value === 'string' &&
    (AGENT_CHANNELS as readonly string[]).includes(value)
  );
}

/**
 * Canal de un dispositivo según su `Hub.type`. Un tipo no contemplado (p. ej.
 * un valor nuevo del enum sin regla de canal) cae en `unknown`: fail-closed.
 */
export function channelForHubType(type: HubType): AgentChannel {
  switch (type) {
    case HubType.PHYSICAL_HUB:
      return 'physical-hub';
    case HubType.WEB_KIOSK:
      return 'web-kiosk';
    default:
      return 'unknown';
  }
}
