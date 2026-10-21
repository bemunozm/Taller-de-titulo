import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lprSettingsRequestSchema } from './index'

// Contrato compartido con el backend (DTO) y el worker LPR: contracts/lpr-settings.cases.json.
interface ContractCase {
  name: string
  settings: unknown
}
interface Contract {
  valid: ContractCase[]
  invalid: ContractCase[]
}

// vitest corre con cwd = frontend/ (o la raíz del repo si se lanza desde allí).
const contractPath = [
  resolve(process.cwd(), '..', 'contracts', 'lpr-settings.cases.json'),
  resolve(process.cwd(), 'contracts', 'lpr-settings.cases.json'),
].find((candidate) => existsSync(candidate))
if (!contractPath) throw new Error('No se encontró contracts/lpr-settings.cases.json')
const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as Contract

describe('contrato lprSettings (zod del frontend)', () => {
  it('el contrato trae casos', () => {
    expect(contract.valid.length).toBeGreaterThan(0)
    expect(contract.invalid.length).toBeGreaterThan(0)
  })

  it('el contrato cubre directionLine (válidos e inválidos) y se evalúa contra el mismo esquema', () => {
    const mentionsLine = (c: ContractCase) => JSON.stringify(c.settings).includes('directionLine')
    expect(contract.valid.filter(mentionsLine).length).toBeGreaterThanOrEqual(2)
    expect(contract.invalid.filter(mentionsLine).length).toBeGreaterThanOrEqual(5)
  })

  it('exitSide solo acepta left y right, y la línea no admite coordenadas fuera de [0, 1]', () => {
    const line = { from: { x: 0.2, y: 0.5 }, to: { x: 0.8, y: 0.5 }, exitSide: 'right' }
    expect(lprSettingsRequestSchema.safeParse({ directionLine: line }).success).toBe(true)
    expect(lprSettingsRequestSchema.safeParse({ directionLine: { ...line, exitSide: 'up' } }).success).toBe(false)
    expect(lprSettingsRequestSchema.safeParse({ directionLine: { ...line, to: { x: 1.2, y: 0.5 } } }).success).toBe(false)
    expect(lprSettingsRequestSchema.safeParse({ directionLine: null }).success).toBe(false)
  })

  it.each(contract.valid.map((c) => [c.name, c.settings] as const))('acepta: %s', (_name, settings) => {
    expect(lprSettingsRequestSchema.safeParse(settings).success).toBe(true)
  })

  it.each(contract.invalid.map((c) => [c.name, c.settings] as const))('rechaza: %s', (_name, settings) => {
    expect(lprSettingsRequestSchema.safeParse(settings).success).toBe(false)
  })
})
