import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { cancelVisit, checkInVisit, checkOutVisit, getVisitByQRCode, updateVisit } from './VisitAPI'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

beforeEach(() => {
  vi.clearAllMocks()
})

function httpError(status: number, data: unknown): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, undefined, response)
}

const ID = '22222222-2222-4222-8222-222222222222'

describe('VisitAPI: errores del backend', () => {
  it.each([
    ['cancelar', () => cancelVisit(ID), 'post', 'No se puede cancelar la visita: está activa'],
    ['check-in', () => checkInVisit(ID), 'post', 'No se puede registrar la entrada: la visita está cancelada'],
    ['check-out', () => checkOutVisit(ID), 'post', 'La visita cambió mientras se registraba la salida; vuelve a intentarlo'],
    ['editar', () => updateVisit({ id: ID, formData: {} }), 'patch', 'No se puede editar la visita: está activa'],
  ] as const)('%s: propaga el mensaje del 409 tal cual', async (_action, call, method, message) => {
    apiMock[method].mockRejectedValueOnce(
      httpError(409, { statusCode: 409, message, error: 'Conflict' }),
    )

    await expect(call()).rejects.toMatchObject({ message })
  })

  it('une los mensajes de validación (message: string[])', async () => {
    apiMock.patch.mockRejectedValueOnce(
      httpError(400, { statusCode: 400, message: ['validFrom must be a date', 'maxUses must be >= 1'] }),
    )

    await expect(updateVisit({ id: ID, formData: {} })).rejects.toMatchObject({
      message: 'validFrom must be a date. maxUses must be >= 1',
    })
  })

  it('usa el fallback de la acción si la respuesta no trae mensaje', async () => {
    apiMock.post.mockRejectedValueOnce(httpError(502, '<html>Bad Gateway</html>'))

    await expect(cancelVisit(ID)).rejects.toMatchObject({ message: 'Error al cancelar la visita' })
  })

  it('usa el fallback de la acción si no hubo respuesta (red caída)', async () => {
    apiMock.post.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))

    await expect(checkInVisit(ID)).rejects.toMatchObject({ message: 'Error al realizar el check-in' })
  })
})

describe('getVisitByQRCode', () => {
  it('codifica el contenido escaneado para que no altere la ruta de la API', async () => {
    apiMock.get.mockResolvedValueOnce({ data: {} })

    await getVisitByQRCode('../users?x=1#y')

    expect(apiMock.get).toHaveBeenCalledWith('/visits/qr/..%2Fusers%3Fx%3D1%23y')
  })

  it('no altera un código hexadecimal válido', async () => {
    apiMock.get.mockResolvedValueOnce({ data: {} })

    await getVisitByQRCode('0123456789abcdef0123456789abcdef')

    expect(apiMock.get).toHaveBeenCalledWith('/visits/qr/0123456789abcdef0123456789abcdef')
  })
})
