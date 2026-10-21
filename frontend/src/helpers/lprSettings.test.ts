import { describe, expect, it } from 'vitest'
import { lprFormSchema, toLprFormValues, toLprSettingsPayload } from './lprSettings'
import { lprSettingsRequestSchema, type DirectionLine, type LprSettings } from '@/types/index'

const LINE: DirectionLine = { from: { x: 0.2, y: 0.7 }, to: { x: 0.85, y: 0.75 }, exitSide: 'left' }

function submit(settings: LprSettings | null) {
  const parsed = lprFormSchema.safeParse(toLprFormValues(settings))
  if (!parsed.success) throw new Error(parsed.error.message)
  return toLprSettingsPayload(parsed.data)
}

describe('línea de dirección en el formulario LPR', () => {
  it('sin configuración, la línea arranca vacía y no viaja en el payload', () => {
    expect(toLprFormValues(null).directionLine).toBeNull()
    expect(submit(null)).toEqual({ action: 'access' })
  })

  it('carga la línea guardada y la reenvía completa (el PATCH reemplaza todo)', () => {
    expect(toLprFormValues({ directionLine: LINE }).directionLine).toEqual(LINE)
    expect(submit({ action: 'register', directionLine: LINE })).toEqual({ action: 'register', directionLine: LINE })
  })

  it('el payload resultante pasa el esquema estricto de escritura', () => {
    expect(lprSettingsRequestSchema.safeParse(submit({ directionLine: LINE })).success).toBe(true)
  })

  it('rechaza una línea demasiado corta o fuera de rango antes del PATCH', () => {
    const base = toLprFormValues(null)
    const tooShort = { ...base, directionLine: { ...LINE, to: { x: 0.21, y: 0.71 } } }
    const outOfRange = { ...base, directionLine: { ...LINE, from: { x: -0.1, y: 0.7 } } }

    expect(lprFormSchema.safeParse(tooShort).success).toBe(false)
    expect(lprFormSchema.safeParse(outOfRange).success).toBe(false)
  })
})
