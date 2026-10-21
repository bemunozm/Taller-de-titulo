import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DirectionLine, LprExitSide } from '@/types/index'
import { getExitArrow, pointSide } from './directionLine'

interface Pt {
  x: number
  y: number
}
interface SideCase {
  name: string
  line: { from: Pt; to: Pt }
  point: Pt
  side: LprExitSide
}
interface CrossingCase {
  name: string
  line: DirectionLine
  path: Pt[]
  expected: 'exit' | 'entry' | null
}
interface Contract {
  sideCases: SideCase[]
  crossingCases: CrossingCase[]
}

const contractPath = [
  resolve(process.cwd(), '..', 'contracts', 'direction-line.cases.json'),
  resolve(process.cwd(), 'contracts', 'direction-line.cases.json'),
].find((candidate) => existsSync(candidate))
if (!contractPath) throw new Error('No se encontró contracts/direction-line.cases.json')
const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as Contract

describe('contrato de la convención de la línea (frontend)', () => {
  it('el contrato trae casos', () => {
    expect(contract.sideCases.length).toBeGreaterThan(0)
    expect(contract.crossingCases.length).toBeGreaterThan(0)
  })

  it.each(contract.sideCases.map((c) => [c.name, c] as const))('lado: %s', (_name, c) => {
    expect(pointSide(c.line, c.point)).toBe(c.side)
  })

  it.each(contract.crossingCases.map((c) => [c.name, c] as const))(
    'la flecha cae del lado exitSide: %s',
    (_name, c) => {
      for (const aspect of [1, 16 / 9]) {
        const { base, tip } = getExitArrow(c.line, aspect)
        expect(pointSide(c.line, tip)).toBe(c.line.exitSide)
        expect(pointSide(c.line, base)).toBeNull()
      }
    },
  )

  it.each(contract.crossingCases.filter((c) => c.expected !== null).map((c) => [c.name, c] as const))(
    'trayectoria: %s sale/entra según el lado final respecto de exitSide',
    (_name, c) => {
      const first = c.path[0]!
      const last = c.path[c.path.length - 1]!
      const endsOnExit = pointSide(c.line, last) === c.line.exitSide
      expect(pointSide(c.line, first)).not.toBe(pointSide(c.line, last))
      expect(endsOnExit ? 'exit' : 'entry').toBe(c.expected)
    },
  )
})
