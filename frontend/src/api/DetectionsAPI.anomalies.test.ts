import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { listAnomalies, updateAnomalyStatus } from './DetectionsAPI'

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

beforeEach(() => {
  vi.clearAllMocks()
})

function httpError(status: number, data: unknown): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

const ID = '11111111-1111-4111-8111-111111111111'

describe('listAnomalies', () => {
  it('envía solo los filtros presentes como query params', async () => {
    apiMock.get.mockResolvedValue({ data: { items: [], total: 0 } })

    await listAnomalies({ status: 'open', type: 'loitering', limit: 20, offset: 40 })
    await listAnomalies()

    expect(apiMock.get).toHaveBeenNthCalledWith(1, '/anomalies', {
      params: { status: 'open', type: 'loitering', limit: 20, offset: 40 },
    })
    expect(apiMock.get).toHaveBeenNthCalledWith(2, '/anomalies', { params: {} })
  })

  it('un offset 0 sí se envía', async () => {
    apiMock.get.mockResolvedValue({ data: { items: [], total: 0 } })

    await listAnomalies({ offset: 0 })

    expect(apiMock.get).toHaveBeenCalledWith('/anomalies', { params: { offset: 0 } })
  })

  it('devuelve { items, total } normalizado', async () => {
    apiMock.get.mockResolvedValue({ data: { items: [{ id: 'a', status: 'reviewed' }, { sin: 'id' }], total: 12 } })

    const result = await listAnomalies()

    expect(result.total).toBe(12)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'a', status: 'reviewed' })
  })

  it('403 con mensaje claro', async () => {
    apiMock.get.mockRejectedValue(httpError(403, {}))

    await expect(listAnomalies()).rejects.toMatchObject({
      status: 403,
      message: 'No tienes permiso para ver las anomalías',
    })
  })
})

describe('updateAnomalyStatus', () => {
  it('hace PATCH /anomalies/:id/status con estado y nota recortada', async () => {
    apiMock.patch.mockResolvedValue({ data: { id: ID, status: 'dismissed', resolutionNote: 'ok' } })

    const result = await updateAnomalyStatus(ID, 'dismissed', '  ok  ')

    expect(apiMock.patch).toHaveBeenCalledWith(`/anomalies/${ID}/status`, { status: 'dismissed', note: 'ok' })
    expect(result).toMatchObject({ id: ID, status: 'dismissed', resolutionNote: 'ok' })
  })

  it('sin nota (o vacía) no envía el campo note', async () => {
    apiMock.patch.mockResolvedValue({ data: { id: ID, status: 'reviewed' } })

    await updateAnomalyStatus(ID, 'reviewed')
    await updateAnomalyStatus(ID, 'reviewed', '   ')

    expect(apiMock.patch).toHaveBeenNthCalledWith(1, `/anomalies/${ID}/status`, { status: 'reviewed' })
    expect(apiMock.patch).toHaveBeenNthCalledWith(2, `/anomalies/${ID}/status`, { status: 'reviewed' })
  })

  it.each([
    [403, 'No tienes permiso para resolver anomalías'],
    [404, 'La anomalía no existe o no pertenece a tu condominio'],
  ])('%s: mensaje claro y status en el ApiError', async (status, message) => {
    apiMock.patch.mockRejectedValue(httpError(status, {}))

    await expect(updateAnomalyStatus(ID, 'reviewed')).rejects.toMatchObject({ status, message })
  })

  it('una respuesta sin id es un error de formato', async () => {
    apiMock.patch.mockResolvedValue({ data: {} })

    await expect(updateAnomalyStatus(ID, 'reviewed')).rejects.toThrow('formato inesperado')
  })
})
