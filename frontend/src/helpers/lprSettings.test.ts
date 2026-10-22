import { describe, expect, it } from 'vitest'
import {
  lprFormSchema,
  recommendedPlateFormValues,
  toLprFormValues,
  toLprSettingsPayload,
  usesWorkerDetectionDefaults,
} from './lprSettings'
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

describe('valores recomendados para patentes', () => {
  it('completan resolución, FPS, recorte y lecturas, y el payload pasa el esquema estricto', () => {
    const values = { ...toLprFormValues(null), ...recommendedPlateFormValues() }
    expect(values).toMatchObject({
      detectorImgsz: '1920',
      sampleFps: '8',
      minWidth: '60',
      maxWidth: '250',
      minRatio: '0.8',
      maxRatio: '6',
      confirmReads: '3',
      unlimitedMaxWidth: false,
    })

    const parsed = lprFormSchema.safeParse(values)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const payload = toLprSettingsPayload(parsed.data)
    expect(payload).toEqual({
      action: 'access',
      detectorImgsz: 1920,
      sampleFps: 8,
      confirmReads: 3,
      crop: { minWidth: 60, maxWidth: 250, minRatio: 0.8, maxRatio: 6 },
    })
    expect(lprSettingsRequestSchema.safeParse(payload).success).toBe(true)
  })

  it('no tocan modo, dirección, zona ni línea', () => {
    expect(Object.keys(recommendedPlateFormValues()).sort()).toEqual(
      ['confirmReads', 'detectorImgsz', 'maxRatio', 'maxWidth', 'minRatio', 'minWidth', 'sampleFps', 'unlimitedMaxWidth'].sort(),
    )
  })
})

describe('usesWorkerDetectionDefaults', () => {
  const recommended = recommendedPlateFormValues()

  it('sin nada configurado usa los defaults del worker', () => {
    expect(usesWorkerDetectionDefaults(toLprFormValues(null))).toBe(true)
  })

  it('con los valores recomendados no hay aviso', () => {
    expect(usesWorkerDetectionDefaults(recommended)).toBe(false)
  })

  it.each([
    ['resolución vacía', { detectorImgsz: '' }],
    ['FPS vacíos', { sampleFps: '  ' }],
    ['recorte vacío', { minWidth: '', maxWidth: '', minRatio: '', maxRatio: '', unlimitedMaxWidth: false }],
  ])('%s: avisa', (_case, override) => {
    expect(usesWorkerDetectionDefaults({ ...recommended, ...override })).toBe(true)
  })

  it('"sin tope" de ancho cuenta como recorte definido', () => {
    const noCropFields = { minWidth: '', maxWidth: '', minRatio: '', maxRatio: '' }
    expect(usesWorkerDetectionDefaults({ ...recommended, ...noCropFields, unlimitedMaxWidth: true })).toBe(false)
  })
})

describe('plateRotationDeg', () => {
  const withRotation = (value: unknown) => lprSettingsRequestSchema.safeParse({ plateRotationDeg: value }).success

  it.each([15, -12.5, 0, 45, -45])('acepta %s', (value) => {
    expect(withRotation(value)).toBe(true)
  })

  it.each([46, -46, '15', null])('rechaza %s', (value) => {
    expect(withRotation(value)).toBe(false)
  })

  it('el formulario acepta decimales (también con coma) y los envía como número', () => {
    const parsed = lprFormSchema.safeParse({ ...toLprFormValues(null), plateRotationDeg: '-12,5' })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const payload = toLprSettingsPayload(parsed.data)
    expect(payload.plateRotationDeg).toBe(-12.5)
    expect(lprSettingsRequestSchema.safeParse(payload).success).toBe(true)
  })

  it('vacío se omite del payload (no null) y fuera de rango o texto se rechaza', () => {
    expect(submit(null)).not.toHaveProperty('plateRotationDeg')
    for (const bad of ['46', '-46', 'abc']) {
      expect(lprFormSchema.safeParse({ ...toLprFormValues(null), plateRotationDeg: bad }).success).toBe(false)
    }
  })

  it('carga el valor guardado y lo reenvía; 0 explícito se conserva', () => {
    expect(submit({ action: 'access', plateRotationDeg: 20 }).plateRotationDeg).toBe(20)
    expect(submit({ action: 'access', plateRotationDeg: 0 }).plateRotationDeg).toBe(0)
  })

  it('los valores recomendados no tocan la rotación', () => {
    expect(Object.keys(recommendedPlateFormValues())).not.toContain('plateRotationDeg')
  })
})
