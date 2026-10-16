import { describe, expect, it } from 'vitest'
import { formatRUT, isValidRUT } from './index'

describe('formatRUT', () => {
  it('formatea un RUT sin puntos ni guion', () => {
    expect(formatRUT('123456785')).toBe('12.345.678-5')
  })

  it('normaliza el digito verificador K a mayuscula', () => {
    expect(formatRUT('12.345.678-k')).toBe('12.345.678-K')
  })
})

describe('isValidRUT', () => {
  it('acepta un RUT con digito verificador correcto', () => {
    expect(isValidRUT('12.345.678-5')).toBe(true)
  })

  it('rechaza un RUT con digito verificador incorrecto', () => {
    expect(isValidRUT('12.345.678-9')).toBe(false)
  })

  it('rechaza un cuerpo no numerico', () => {
    expect(isValidRUT('abc-1')).toBe(false)
  })
})
