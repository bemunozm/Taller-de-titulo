/**
 * Decisión automática de una detección que no escala al conserje.
 *
 * `Duplicado` (Fase 4 · P3): la lectura repite un paso que YA quedó
 * registrado (la entrada o la salida de una visita, por otra detección o
 * dentro de la espera posterior a ese paso). No cambia el estado de la
 * visita, no abre el portón ni alerta a nadie: el paso original ya lo hizo.
 * Se distingue de `Denegado` para no disparar una alerta HIGH por un auto que
 * pasó bien, y no cuenta en las métricas de tiempo de respuesta del
 * dashboard (no es una decisión de acceso).
 *
 * `Registrado` (plan LPR por cámara, D8): la cámara está en modo "solo
 * registrar" (`lprSettings.action = 'register'`). La lectura queda guardada
 * pero no se evalúa acceso: no abre el portón, no escala al conserje, no toca
 * visitas ni notifica. Tampoco es una decisión de acceso (se guarda sin
 * `responseTimeMs`, así que no entra en las métricas de tiempo de respuesta).
 */
export type AccessDecision =
  | 'Permitido'
  | 'Denegado'
  | 'Duplicado'
  | 'Registrado';

/** Decisión de una lectura duplicada (ver `AccessDecision`). */
export const DUPLICATE_ACCESS_DECISION = 'Duplicado' satisfies AccessDecision;

/** Decisión de una lectura en una cámara de solo registro (ver `AccessDecision`). */
export const REGISTERED_ACCESS_DECISION = 'Registrado' satisfies AccessDecision;
