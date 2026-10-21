import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { RATE_LIMIT_MESSAGE } from '@/helpers/httpErrors'
import { renderWithProviders } from '@/test/renderWithProviders'
import NewPasswordView from './NewPasswordView'

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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NewPasswordView', () => {
  it('un 429 al validar el enlace muestra "Demasiados intentos…", no el error crudo', async () => {
    axiosMock.api.post.mockRejectedValueOnce(
      httpError(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
    )

    renderWithProviders(<NewPasswordView />, { route: '/auth/new-password?token=abc' })

    expect(await screen.findByText(RATE_LIMIT_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByText(/ThrottlerException|status code 429/)).not.toBeInTheDocument()
    expect(axiosMock.api.post).toHaveBeenCalledWith('/auth/validate-token', { token: 'abc' })
  })
})
