import { describe, expect, it } from 'vitest'
import {
  ACCESS_DECISIONS,
  countAccessDecisions,
  getAccessDecisionMeta,
  isAccessDecision,
} from './accessDecision'

describe('isAccessDecision', () => {
  it.each(['Permitido', 'Denegado', 'Duplicado', 'Pendiente', 'Expirado'])('reconoce %s', (value) => {
    expect(isAccessDecision(value)).toBe(true)
  })

  // 'Aprovado' era el valor que comparaba el frontend; el backend nunca lo emite.
  it.each(['Aprovado', 'permitido', '', null, undefined, 1])('rechaza %o', (value) => {
    expect(isAccessDecision(value)).toBe(false)
  })
})

describe('getAccessDecisionMeta', () => {
  it('Duplicado tiene etiqueta propia y un tono neutro distinto de Permitido', () => {
    const duplicate = getAccessDecisionMeta('Duplicado')

    expect(duplicate.label).toBe('Duplicado')
    expect(duplicate.color).toBe('zinc')
    expect(duplicate.color).not.toBe(getAccessDecisionMeta('Permitido').color)
    expect(duplicate.description).toMatch(/no abre el portón/)
  })

  it('cada decisión conocida tiene un color distinto', () => {
    const colors = ACCESS_DECISIONS.map((decision) => getAccessDecisionMeta(decision).color)

    expect(new Set(colors).size).toBe(ACCESS_DECISIONS.length)
  })

  it('una decisión desconocida se muestra tal cual, en gris', () => {
    expect(getAccessDecisionMeta('Manual-X')).toEqual({
      label: 'Manual-X',
      color: 'zinc',
      description: 'Decisión no reconocida',
    })
    expect(getAccessDecisionMeta('').label).toBe('Sin decisión')
  })
})

describe('countAccessDecisions', () => {
  it('cuenta por decisión; Duplicado no suma como Permitido y lo desconocido no suma', () => {
    const counts = countAccessDecisions([
      { decision: 'Permitido' },
      { decision: 'Permitido' },
      { decision: 'Duplicado' },
      { decision: 'Denegado' },
      { decision: 'Aprovado' },
    ])

    expect(counts).toEqual({ Permitido: 2, Denegado: 1, Duplicado: 1, Pendiente: 0, Expirado: 0 })
  })

  it('una lista vacía da todo en cero', () => {
    expect(Object.values(countAccessDecisions([]))).toEqual([0, 0, 0, 0, 0])
  })
})
