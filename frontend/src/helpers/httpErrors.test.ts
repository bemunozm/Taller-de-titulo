import { describe, expect, it } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import {
  ApiError,
  RATE_LIMIT_MESSAGE,
  getApiErrorStatus,
  getUserFacingErrorMessage,
  isRateLimitError,
  toApiError,
} from './httpErrors'

function httpError(status: number, data: unknown = {}): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

describe('getUserFacingErrorMessage', () => {
  it('429: mensaje amable, nunca el crudo de axios ni el del throttler', () => {
    const error = httpError(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' })

    expect(isRateLimitError(error)).toBe(true)
    expect(getUserFacingErrorMessage(error, 'fallback')).toBe(RATE_LIMIT_MESSAGE)
    expect(RATE_LIMIT_MESSAGE).toBe('Demasiados intentos. Espera un momento e intenta de nuevo.')
  })

  it('otro error HTTP: el message del backend (string o lista)', () => {
    expect(getUserFacingErrorMessage(httpError(400, { message: 'Token inválido' }), 'fallback')).toBe('Token inválido')
    expect(getUserFacingErrorMessage(httpError(400, { message: ['a', 'b'] }), 'fallback')).toBe('a. b')
  })

  it('error HTTP sin message, o red caída: fallback (nunca "Request failed with status code")', () => {
    expect(getUserFacingErrorMessage(httpError(502, '<html>'), 'fallback')).toBe('fallback')
    expect(getUserFacingErrorMessage(new AxiosError('Network Error', 'ERR_NETWORK'), 'fallback')).toBe('fallback')
  })

  it('error no HTTP: su message, o el fallback', () => {
    expect(getUserFacingErrorMessage(new Error('Micrófono bloqueado'), 'fallback')).toBe('Micrófono bloqueado')
    expect(getUserFacingErrorMessage('raro', 'fallback')).toBe('fallback')
    expect(isRateLimitError(new Error('429'))).toBe(false)
  })
})

describe('toApiError', () => {
  it('conserva el código HTTP y prefiere el message del backend', () => {
    const error = toApiError(httpError(409, { message: 'La patente ya existe' }), 'fallback', {
      409: 'Duplicado',
    })

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(409)
    expect(error.message).toBe('La patente ya existe')
    expect(getApiErrorStatus(error)).toBe(409)
  })

  it('sin message del backend usa el mensaje del código y luego el fallback', () => {
    expect(toApiError(httpError(403, ''), 'fallback', { 403: 'Sin permiso' }).message).toBe('Sin permiso')
    expect(toApiError(httpError(500, ''), 'fallback', { 403: 'Sin permiso' }).message).toBe('fallback')
  })

  it('429 siempre da el mensaje de throttling', () => {
    const error = toApiError(httpError(429, { message: 'ThrottlerException' }), 'fallback')

    expect(error.message).toBe(RATE_LIMIT_MESSAGE)
    expect(error.status).toBe(429)
  })

  it('red caída o error no HTTP: sin código', () => {
    expect(toApiError(new AxiosError('Network Error', 'ERR_NETWORK'), 'fallback')).toMatchObject({
      message: 'fallback',
      status: null,
    })
    expect(toApiError(new Error('boom'), 'fallback')).toMatchObject({ message: 'boom', status: null })
    expect(getApiErrorStatus(new Error('boom'))).toBeNull()
  })

  it('no reenvuelve un ApiError', () => {
    const original = new ApiError('ya normalizado', 403)

    expect(toApiError(original, 'fallback')).toBe(original)
  })
})

describe('toApiError: campo estructurado del backend', () => {
  it('conserva `field` del 409 de duplicados', () => {
    const error = toApiError(
      httpError(409, { statusCode: 409, error: 'Conflict', message: 'El teléfono ya está en uso', field: 'phone' }),
      'fallback',
    )

    expect(error).toMatchObject({ status: 409, message: 'El teléfono ya está en uso', field: 'phone' })
  })

  it('sin `field` (o null) queda en null', () => {
    expect(toApiError(httpError(409, { message: 'x', field: null }), 'fallback').field).toBeNull()
    expect(toApiError(httpError(400, { message: 'x' }), 'fallback').field).toBeNull()
    expect(new ApiError('x', 409).field).toBeNull()
  })
})
