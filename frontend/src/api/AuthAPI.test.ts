import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { RATE_LIMIT_MESSAGE } from '@/helpers/httpErrors'
import {
  authenticateUser,
  confirmAccount,
  forgotPassword,
  requestConfirmationCode,
  updatePasswordWithToken,
  validateToken,
} from './AuthAPI'

const axiosMock = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  authApi: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('@/lib/axios', () => ({ default: axiosMock.api, authApi: axiosMock.authApi }))

function httpError(status: number, data: unknown = {}): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

const THROTTLED = httpError(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AuthAPI: endpoints públicos con throttling', () => {
  it.each([
    ['validate-token', () => validateToken({ token: 't' })],
    ['confirm-account', () => confirmAccount({ token: 't' })],
    ['forgot-password', () => forgotPassword({ email: 'a@b.cl' })],
    ['reset-password', () => updatePasswordWithToken({ formData: { password: 'x', password_confirmation: 'x' }, token: 't' })],
    ['request-code', () => requestConfirmationCode({ email: 'a@b.cl' })],
  ] as const)('%s: un 429 muestra el mensaje amable', async (_endpoint, call) => {
    axiosMock.api.post.mockRejectedValueOnce(THROTTLED)

    await expect(call()).rejects.toThrow(RATE_LIMIT_MESSAGE)
  })

  it('sign-in: un 429 de better-auth muestra el mensaje amable', async () => {
    axiosMock.authApi.post.mockRejectedValueOnce(httpError(429, { message: 'Too many requests' }))

    await expect(authenticateUser({ email: 'a@b.cl', password: 'x' })).rejects.toThrow(RATE_LIMIT_MESSAGE)
  })

  it('mantiene el mensaje del backend para otros errores', async () => {
    axiosMock.api.post.mockRejectedValueOnce(httpError(400, { message: 'El token expiró' }))

    await expect(validateToken({ token: 't' })).rejects.toThrow('El token expiró')
  })

  it('red caída: lanza con un mensaje (antes resolvía undefined y parecía un éxito)', async () => {
    axiosMock.api.post.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))

    await expect(validateToken({ token: 't' })).rejects.toThrow('El enlace de recuperación es inválido o expiró')
  })
})
