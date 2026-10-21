import { describe, expect, it } from 'vitest'
import { getAttemptDirectionLabel } from './accessDecision'

describe('getAttemptDirectionLabel con pasada (E7)', () => {
  it('prefiere passage.direction sobre meta.direction y method', () => {
    expect(
      getAttemptDirectionLabel({
        method: 'Patente - Entrada',
        detection: { meta: { direction: 'entry' } },
        passage: { direction: 'exit' },
      }),
    ).toBe('Salida')
    expect(getAttemptDirectionLabel({ passage: { direction: 'entry' }, detection: { meta: { direction: 'exit' } } })).toBe(
      'Entrada',
    )
  })

  it('con passage.direction unknown cae a meta y luego al sufijo de method', () => {
    expect(
      getAttemptDirectionLabel({ passage: { direction: 'unknown' }, detection: { meta: { direction: 'exit' } } }),
    ).toBe('Salida')
    expect(getAttemptDirectionLabel({ passage: { direction: 'unknown' }, method: 'Patente - Entrada' })).toBe('Entrada')
    expect(getAttemptDirectionLabel({ passage: { direction: 'unknown' }, method: 'Patente - Registro' })).toBeNull()
  })

  it('sin pasada (null o ausente, datos antiguos) conserva el comportamiento previo', () => {
    expect(getAttemptDirectionLabel({ passage: null, method: 'Patente - Salida' })).toBe('Salida')
    expect(getAttemptDirectionLabel({ method: 'Patente - Registro' })).toBeNull()
  })

  it('una dirección de pasada inesperada no se muestra', () => {
    expect(getAttemptDirectionLabel({ passage: { direction: 'sideways' }, method: 'Patente - Registro' })).toBeNull()
  })
})
