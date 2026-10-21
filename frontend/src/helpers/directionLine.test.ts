import { describe, expect, it } from 'vitest'
import type { DirectionLine } from '@/types/index'
import {
  describeDirectionLine,
  directionLineLength,
  flipExitSide,
  getExitArrow,
} from './directionLine'

const HORIZONTAL: DirectionLine = { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, exitSide: 'left' }

describe('getExitArrow', () => {
  it('izquierda de una línea de izquierda a derecha apunta hacia arriba (y decrece)', () => {
    const { base, tip } = getExitArrow(HORIZONTAL)

    expect(base).toEqual({ x: 0.5, y: 0.5 })
    expect(tip.x).toBeCloseTo(0.5)
    expect(tip.y).toBeLessThan(0.5)
  })

  it('derecha apunta hacia el lado contrario', () => {
    const { tip } = getExitArrow({ ...HORIZONTAL, exitSide: 'right' })

    expect(tip.y).toBeGreaterThan(0.5)
  })

  it('invertir los extremos invierte el lado visual', () => {
    const reversed: DirectionLine = { ...HORIZONTAL, from: HORIZONTAL.to, to: HORIZONTAL.from }

    expect(getExitArrow(reversed).tip.y).toBeGreaterThan(0.5)
  })

  it('en una línea vertical de arriba hacia abajo, la izquierda de quien avanza cae a la derecha de la imagen', () => {
    // Quien baja por la pantalla (y creciente) tiene su izquierda hacia la derecha de la imagen (x crece).
    const vertical: DirectionLine = { from: { x: 0.5, y: 0.2 }, to: { x: 0.5, y: 0.8 }, exitSide: 'left' }
    const { base, tip } = getExitArrow(vertical)

    expect(tip.x).toBeGreaterThan(base.x)
    expect(tip.y).toBeCloseTo(base.y)
  })

  it('es perpendicular en pantalla: con aspecto 16:9 la flecha de una diagonal no queda torcida', () => {
    const diagonal: DirectionLine = { from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.6 }, exitSide: 'left' }
    const aspect = 16 / 9
    const { base, tip } = getExitArrow(diagonal, aspect)

    const lineVec = [(0.6 - 0.2) * aspect, 0.6 - 0.2]
    const arrowVec = [(tip.x - base.x) * aspect, tip.y - base.y]
    const dot = lineVec[0]! * arrowVec[0]! + lineVec[1]! * arrowVec[1]!
    expect(dot).toBeCloseTo(0, 6)
  })

  it('un aspecto inválido usa 16:9 en lugar de producir NaN', () => {
    const { tip } = getExitArrow(HORIZONTAL, Number.NaN)

    expect(Number.isFinite(tip.x)).toBe(true)
    expect(Number.isFinite(tip.y)).toBe(true)
  })

  it('las aletas quedan detrás de la punta, a ambos lados del eje', () => {
    const { base, tip, barbs } = getExitArrow(HORIZONTAL)

    for (const barb of barbs) expect(Math.abs(barb.y - base.y)).toBeLessThan(Math.abs(tip.y - base.y))
    expect(barbs[0].x).not.toBeCloseTo(barbs[1].x)
  })
})

describe('helpers de la línea', () => {
  it('flipExitSide alterna el lado', () => {
    expect(flipExitSide('left')).toBe('right')
    expect(flipExitSide('right')).toBe('left')
  })

  it('directionLineLength mide la distancia normalizada', () => {
    expect(directionLineLength({ from: { x: 0, y: 0 }, to: { x: 0.3, y: 0.4 } })).toBeCloseTo(0.5)
  })

  it('describeDirectionLine resume la línea o su ausencia', () => {
    expect(describeDirectionLine(null)).toMatch(/Sin línea: se usa la dirección fija de la cámara y, si no tiene, se infiere por el tamaño de la patente/)
    expect(describeDirectionLine(HORIZONTAL)).toBe('Línea de dirección definida — salida hacia la izquierda.')
    expect(describeDirectionLine({ ...HORIZONTAL, exitSide: 'right' })).toContain('salida hacia la derecha')
  })
})
