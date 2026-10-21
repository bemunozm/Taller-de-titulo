import { describe, expect, it } from 'vitest'
import { filenameFromContentDisposition, toLocalIsoDate } from './download'

describe('filenameFromContentDisposition', () => {
  it.each([
    ['attachment; filename="vigilia-mis-datos-2026-10-09.json"', 'vigilia-mis-datos-2026-10-09.json'],
    ['attachment; filename=vigilia-mis-datos-2026-10-09.json', 'vigilia-mis-datos-2026-10-09.json'],
    ['attachment;filename="datos.json"; size=10', 'datos.json'],
    // `filename*` (RFC 5987) tiene prioridad y se decodifica.
    [`attachment; filename="fallback.json"; filename*=UTF-8''mis%20datos%20%C3%B1.json`, 'mis datos ñ.json'],
  ])('%s → %s', (header, expected) => {
    expect(filenameFromContentDisposition(header)).toBe(expected)
  })

  it('se queda con el nombre base: sin rutas ni caracteres reservados', () => {
    expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd')
    expect(filenameFromContentDisposition('attachment; filename="C:\\\\Windows\\\\x.json"')).toBe('x.json')
    expect(filenameFromContentDisposition('attachment; filename="a<b>c|d?.json"')).toBe('abcd.json')
  })

  it('devuelve null si no hay un nombre usable', () => {
    expect(filenameFromContentDisposition(undefined)).toBeNull()
    expect(filenameFromContentDisposition('')).toBeNull()
    expect(filenameFromContentDisposition('attachment')).toBeNull()
    expect(filenameFromContentDisposition('attachment; filename=""')).toBeNull()
    expect(filenameFromContentDisposition('attachment; filename=".."')).toBeNull()
  })

  it('un filename* mal codificado cae al filename= simple', () => {
    expect(filenameFromContentDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="ok.json"`)).toBe('ok.json')
  })
})

describe('toLocalIsoDate', () => {
  it('usa la fecha local con ceros a la izquierda', () => {
    expect(toLocalIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
