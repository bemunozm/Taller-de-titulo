import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { createVehicle, updateVehicle } from './VehicleAPI'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

beforeEach(() => {
  vi.clearAllMocks()
})

function httpError(status: number, data: unknown): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

const ID = '33333333-3333-4333-8333-333333333333'

describe('createVehicle / updateVehicle: rechazos del backend', () => {
  it('409: patente duplicada en el condominio', async () => {
    apiMock.post.mockRejectedValueOnce(httpError(409, { statusCode: 409 }))

    await expect(createVehicle({ plate: 'ABCD12' })).rejects.toMatchObject({
      status: 409,
      message: 'Ya existe un vehículo con esa patente en el condominio',
    })
  })

  it('403: propietario ajeno, con el mensaje del backend si lo trae', async () => {
    apiMock.post.mockRejectedValueOnce(httpError(403, { message: 'El propietario no es de tu condominio' }))

    await expect(createVehicle({ plate: 'ABCD12', ownerId: ID })).rejects.toMatchObject({
      status: 403,
      message: 'El propietario no es de tu condominio',
    })
  })

  it('400: enum inválido, y el body enviado es el del contrato', async () => {
    apiMock.put.mockRejectedValueOnce(httpError(400, {}))

    await expect(
      updateVehicle({ id: ID, formData: { plate: 'ABCD12', vehicleType: null, accessLevel: 'servicio' } }),
    ).rejects.toMatchObject({ status: 400, message: 'Revisa los datos: tipo de vehículo o nivel de acceso no válido' })
    expect(apiMock.put).toHaveBeenCalledWith(`/vehicles/${ID}`, {
      plate: 'ABCD12',
      vehicleType: null,
      accessLevel: 'servicio',
    })
  })
})
