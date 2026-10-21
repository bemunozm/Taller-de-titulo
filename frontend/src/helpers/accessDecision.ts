import type { ComponentProps } from 'react'
import type { Badge } from '@/components/ui/Badge'

/** Colores que acepta `<Badge>`; derivado del componente para no desalinearse. */
export type AccessDecisionColor = NonNullable<ComponentProps<typeof Badge>['color']>

/**
 * Valores que el backend guarda en `AccessAttempt.decision`
 * (detections.service.ts y expiration.service.ts).
 */
export const ACCESS_DECISIONS = ['Permitido', 'Denegado', 'Duplicado', 'Pendiente', 'Expirado', 'Registrado'] as const

export type AccessDecision = (typeof ACCESS_DECISIONS)[number]

export interface AccessDecisionMeta {
  label: string
  color: AccessDecisionColor
  /** Explicación corta, para el `title` del badge. */
  description: string
}

// `Record<AccessDecision, …>` obliga a declarar aquí cualquier decisión nueva.
const ACCESS_DECISION_META: Record<AccessDecision, AccessDecisionMeta> = {
  Permitido: { label: 'Permitido', color: 'green', description: 'Se autorizó el acceso' },
  Denegado: { label: 'Denegado', color: 'red', description: 'Se rechazó el acceso' },
  // Tono neutro: la lectura repite un paso ya registrado y nunca abre el portón.
  Duplicado: {
    label: 'Duplicado',
    color: 'zinc',
    description: 'Lectura repetida de un paso ya registrado; no abre el portón',
  },
  Pendiente: { label: 'Pendiente', color: 'amber', description: 'Esperando la respuesta del conserje' },
  Expirado: { label: 'Expirado', color: 'orange', description: 'Nadie respondió dentro del plazo' },
  // Informativo (azul cielo): la cámara está en modo "solo registrar"; no autoriza ni niega nada.
  Registrado: {
    label: 'Registrado',
    color: 'sky',
    description: 'Lectura guardada por una cámara en modo solo registrar; no abre el portón',
  },
}

const ACCESS_DECISION_SET: ReadonlySet<string> = new Set(ACCESS_DECISIONS)

export function isAccessDecision(value: unknown): value is AccessDecision {
  return typeof value === 'string' && ACCESS_DECISION_SET.has(value)
}

/** Etiqueta, color y descripción; una decisión desconocida se muestra tal cual, en gris. */
export function getAccessDecisionMeta(decision: string | null | undefined): AccessDecisionMeta {
  if (isAccessDecision(decision)) {
    return ACCESS_DECISION_META[decision]
  }

  return {
    label: decision || 'Sin decisión',
    color: 'zinc',
    description: 'Decisión no reconocida',
  }
}

/** Cuenta intentos por decisión; las decisiones desconocidas no suman en ninguna. */
export function countAccessDecisions(
  attempts: ReadonlyArray<{ decision: string }>,
): Record<AccessDecision, number> {
  const counts = Object.fromEntries(ACCESS_DECISIONS.map((decision) => [decision, 0])) as Record<
    AccessDecision,
    number
  >

  for (const attempt of attempts) {
    if (isAccessDecision(attempt.decision)) {
      counts[attempt.decision] += 1
    }
  }

  return counts
}

export type AttemptDirection = 'entry' | 'exit' | 'both'

const DIRECTION_LABELS: Record<AttemptDirection, string> = {
  entry: 'Entrada',
  exit: 'Salida',
  both: 'Ambas',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Dirección de un intento de acceso. Se prefiere `detection.meta.direction`
 * (la reporta el worker LPR) y, si falta, se deduce del sufijo de `method`
 * (`Patente - Entrada|Salida`; `Patente - Registro` no trae dirección).
 * Devuelve la etiqueta para mostrar, o `null` si no hay dirección conocida.
 */
export function getAttemptDirectionLabel(attempt: {
  method?: string | null
  detection?: { meta?: unknown } | null
}): string | null {
  const meta = attempt.detection?.meta
  const fromMeta = isRecord(meta) ? meta.direction : undefined
  if (fromMeta === 'entry' || fromMeta === 'exit' || fromMeta === 'both') {
    return DIRECTION_LABELS[fromMeta]
  }

  const suffix = attempt.method?.split(' - ')[1]?.trim()
  if (suffix === 'Entrada' || suffix === 'Salida') {
    return suffix
  }
  return null
}
