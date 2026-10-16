import { describe, expect, it } from 'vitest'
import { ApiError } from '@/helpers/httpErrors'
import { formatUserContact, getDuplicateUserFields, getDuplicateUserFieldsFromError } from './userDisplay'

describe('formatUserContact', () => {
  it('detalle completo: email y RUT', () => {
    expect(formatUserContact({ email: 'ana@example.com', rut: '11.111.111-1' })).toBe('ana@example.com • 11.111.111-1')
  })

  it('usuario embebido { id, name }: sin línea de contacto', () => {
    expect(formatUserContact({})).toBeNull()
    expect(formatUserContact({ email: null, rut: '' })).toBeNull()
  })
})

describe('getDuplicateUserFields (409 de duplicados)', () => {
  it.each([
    ['El email ya está en uso', ['email']],
    ['Ese e-mail ya está en uso', ['email']],
    ['El correo electrónico ya existe', ['email']],
    ['El RUT ya está registrado', ['rut']],
    ['El teléfono ya está en uso', ['phone']],
    ['El email o RUT ya está en uso', ['email', 'rut']],
    ['Conflict', []],
  ] as const)('"%s" → %o', (message, fields) => {
    expect(getDuplicateUserFields(message)).toEqual(fields)
  })
})

describe('getDuplicateUserFieldsFromError', () => {
  it('prefiere el `field` estructurado aunque el texto nombre otro campo', () => {
    expect(getDuplicateUserFieldsFromError(new ApiError('El email ya está en uso', 409, 'phone'))).toEqual(['phone'])
  })

  it('sin `field` cae a la detección por texto', () => {
    expect(getDuplicateUserFieldsFromError(new ApiError('El RUT ya está en uso', 409, null))).toEqual(['rut'])
  })

  it('un `field` desconocido también cae al texto', () => {
    expect(getDuplicateUserFieldsFromError(new ApiError('El email ya está en uso', 409, 'username'))).toEqual(['email'])
  })

  it('no es un 409: nada que marcar', () => {
    expect(getDuplicateUserFieldsFromError(new ApiError('El email ya está en uso', 400, 'email'))).toEqual([])
    expect(getDuplicateUserFieldsFromError(new Error('El email ya está en uso'))).toEqual([])
  })
})
