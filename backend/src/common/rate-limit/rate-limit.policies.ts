import type { ThrottlerModuleOptions } from '@nestjs/throttler';

const MINUTE_MS = 60_000;

/** Límite de una política: `limit` requests por ventana de `ttl` ms. */
export interface RateLimitPolicy {
  readonly limit: number;
  readonly ttl: number;
}

/**
 * Fase 4 · P4.B (D9): políticas de rate limit por ruta, en un solo lugar.
 * Cada ruta elige la suya con `@RateLimit('<política>')`; el contador es por
 * ruta y por quién llama (`hub:`/`user:`/`ip:`, ver `VigiliaThrottlerGuard`).
 *
 *  - `concierge-session-start`: crea un token efímero de OpenAI (costo).
 *  - `concierge-execute-tool`: una llamada de citófono dispara varias tools.
 *  - `concierge-status`: polling del kiosko mientras espera al residente.
 *  - `concierge-respond`: respuesta del residente o conserje (abre el portón).
 *  - `concierge-device`: identidad del dispositivo (emparejamiento del kiosko).
 *  - `concierge-session`: `/end`, `agent-config`, `context/:houseNumber`.
 *  - `agent-chat`: canal de texto del agente (costo por token).
 *  - `pending-action-resolve`: aprobar o rechazar una acción escalada del
 *    agente (la aprobación puede abrir el portón).
 *  - `auth-password`: verificar o cambiar la contraseña con sesión.
 *  - `auth-public`: flujos de cuenta sin sesión (por IP).
 *  - `auth-token-validate`: validar el token del link de recuperación (por
 *    IP). Los tokens son de alta entropía: el límite es más holgado para que
 *    recargar la página no bloquee.
 *  - `mediamtx-auth` (Fase 4 · P6.M): autorización interna que pide MediaMTX
 *    (por IP: todas sus llamadas salen de su host). Una por cada stream que
 *    se abre (WHEP); holgado para un panel con varias cámaras y usuarios. El
 *    secreto se valida antes de tocar la BD.
 *  - `privacy-data-export` (Fase 4 · P7.R): el titular descarga TODOS sus
 *    datos (`GET /auth/me/data-export`, por usuario). Consulta varias tablas
 *    y entrega datos personales: bajo.
 *  - `privacy-erasure` (Fase 4 · P7.R): supresión por RUT, patente o usuario
 *    (`POST /privacy/erasure`, por usuario). Irreversible y barre varias
 *    tablas: acotado para frenar un abuso o un script descontrolado.
 */
export const RATE_LIMIT_POLICIES = {
  'concierge-session-start': { limit: 6, ttl: MINUTE_MS },
  'concierge-execute-tool': { limit: 60, ttl: MINUTE_MS },
  'concierge-status': { limit: 40, ttl: MINUTE_MS },
  'concierge-respond': { limit: 10, ttl: MINUTE_MS },
  'concierge-device': { limit: 10, ttl: MINUTE_MS },
  'concierge-session': { limit: 30, ttl: MINUTE_MS },
  'agent-chat': { limit: 20, ttl: MINUTE_MS },
  'pending-action-resolve': { limit: 20, ttl: MINUTE_MS },
  'auth-password': { limit: 5, ttl: 15 * MINUTE_MS },
  'auth-public': { limit: 5, ttl: 15 * MINUTE_MS },
  'auth-token-validate': { limit: 20, ttl: 15 * MINUTE_MS },
  'mediamtx-auth': { limit: 300, ttl: MINUTE_MS },
  'privacy-data-export': { limit: 5, ttl: 60 * MINUTE_MS },
  'privacy-erasure': { limit: 20, ttl: 60 * MINUTE_MS },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

/**
 * Nombre del único throttler registrado. Con un solo throttler, cada ruta
 * aplica UN límite (antes, `ThrottlerGuard` aplicaba todos los throttlers
 * nombrados a cada ruta y el más bajo ganaba).
 */
export const DEFAULT_THROTTLER_NAME = 'default';

/**
 * Opciones de `ThrottlerModule.forRoot`. El límite base solo aplica a una ruta
 * con `VigiliaThrottlerGuard` sin `@Throttle` (no debería haber: se usa
 * siempre vía `@RateLimit`). No hay guard global (`APP_GUARD`): correría antes
 * de la autenticación y frenaría la ingesta del LPR.
 */
export const THROTTLER_MODULE_OPTIONS: ThrottlerModuleOptions = [
  { name: DEFAULT_THROTTLER_NAME, ttl: MINUTE_MS, limit: 30 },
];
