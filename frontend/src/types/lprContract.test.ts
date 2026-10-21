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

  it.each(contract.valid.map((c) => [c.name, c.settings] as const))('acepta: %s', (_name, settings) => {
    expect(lprSettingsRequestSchema.safeParse(settings).success).toBe(true)
  })

  it.each(contract.invalid.map((c) => [c.name, c.settings] as const))('rechaza: %s', (_name, settings) => {
    expect(lprSettingsRequestSchema.safeParse(settings).success).toBe(false)
  })
})
