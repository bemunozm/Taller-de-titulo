import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { ApiError } from '@/helpers/httpErrors'
import { ANONYMIZED_USER_ENABLE_MESSAGE, enableUser, getUserOptions } from './UserAPI'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

function httpError(status: number, data: unknown = {}): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('enableUser', () => {
  it('409 (cuenta anonimizada): mensaje claro de que no se puede recuperar', async () => {
    apiMock.patch.mockRejectedValueOnce(
      httpError(409, { message: 'La cuenta fue anonimizada (Ley 21.719) y no se puede volver a habilitar' }),
    )

    const error = await enableUser('u-1').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, message: ANONYMIZED_USER_ENABLE_MESSAGE })
  })

  it('otro error conserva el mensaje del backend', async () => {
    apiMock.patch.mockRejectedValueOnce(httpError(403, { message: 'Sin permiso' }))

    await expect(enableUser('u-1')).rejects.toThrow('Sin permiso')
  })
})

describe('getUserOptions', () => {
  it('excluye las cuentas deshabilitadas o anonimizadas que trae el detalle', async () => {
    apiMock.get.mockResolvedValueOnce({
      data: [
        { id: 'u-1', name: 'Ana', deletedAt: null },
        { id: 'u-2', name: 'Bruno', deletedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'u-3', name: 'Usuario eliminado', deletedAt: '2026-09-01T00:00:00.000Z', anonymizedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'u-4', name: 'Carla' },
      ],
    })

    expect((await getUserOptions()).map((user) => user.id)).toEqual(['u-1', 'u-4'])
  })
})
