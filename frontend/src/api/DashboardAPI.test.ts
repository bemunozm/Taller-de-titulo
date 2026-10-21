import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardAPI from './DashboardAPI'

const apiMock = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardAPI.getSummary', () => {
  it('no escribe la respuesta (con nombres de visitantes) en la consola', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    apiMock.get.mockResolvedValueOnce({ data: { recentVisits: [{ visitorName: 'Pedro Pérez' }] } })

    const failure = await DashboardAPI.getSummary().catch((caught: unknown) => caught)

    expect(failure).toBeInstanceOf(Error)
    // El mensaje no arrastra el detalle de zod ni los datos recibidos.
    expect((failure as Error).message).toBe('Los datos del dashboard llegaron con un formato inesperado.')
    expect(log).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('un error HTTP se propaga sin registrarse en la consola', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    apiMock.get.mockRejectedValueOnce(new Error('Network Error'))

    await expect(DashboardAPI.getSummary()).rejects.toThrow('Network Error')
    expect(error).not.toHaveBeenCalled()
  })
})
