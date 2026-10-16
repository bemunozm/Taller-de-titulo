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
 */
export type AccessDecision = 'Permitido' | 'Denegado' | 'Duplicado';

/** Decisión de una lectura duplicada (ver `AccessDecision`). */
export const DUPLICATE_ACCESS_DECISION = 'Duplicado' satisfies AccessDecision;
