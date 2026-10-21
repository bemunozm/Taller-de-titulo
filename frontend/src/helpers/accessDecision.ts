import type { ComponentProps } from 'react'
import type { Badge } from '@/components/ui/Badge'

/** Colores que acepta `<Badge>`; derivado del componente para no desalinearse. */
export type AccessDecisionColor = NonNullable<ComponentProps<typeof Badge>['color']>

/**
 * Valores que el backend guarda en `AccessAttempt.decision`
 * (detections.service.ts y expiration.service.ts).
 */
export const ACCESS_DECISIONS = ['Permitido', 'Denegado', 'Duplicado', 'Pendiente', 'Expirado'] as const

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
