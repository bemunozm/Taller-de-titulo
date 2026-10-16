import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { ApiError } from '@/helpers/httpErrors'
import {
  PENDING_ALREADY_RESPONDED_MESSAGE,
  PENDING_EXPIRED_MESSAGE,
  isPendingAlreadyRespondedError,
  respondToPendingDetection,
} from './PendingDetectionsAPI'

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

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111'

describe('respondToPendingDetection', () => {
  it('envía la decisión a PATCH /detections/pending/:id/respond', async () => {
    apiMock.patch.mockResolvedValueOnce({ data: { ok: true } })

    await respondToPendingDetection(ATTEMPT_ID, 'approved', 'Aprobado')

    expect(apiMock.patch).toHaveBeenCalledWith(`/detections/pending/${ATTEMPT_ID}/respond`, {
      decision: 'approved',
      response: 'Aprobado',
    })
  })

  it('409 (segunda respuesta): ApiError con un mensaje claro', async () => {
    apiMock.patch.mockRejectedValueOnce(httpError(409, { message: 'Conflict' }))

    const error = await respondToPendingDetection(ATTEMPT_ID, 'denied').catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, message: PENDING_ALREADY_RESPONDED_MESSAGE })
    expect(isPendingAlreadyRespondedError(error)).toBe(true)
  })

  it('400 (vencida): no es un "ya respondida"', async () => {
    apiMock.patch.mockRejectedValueOnce(httpError(400, {}))

    const error = await respondToPendingDetection(ATTEMPT_ID, 'approved').catch((reason: unknown) => reason)

    expect(error).toMatchObject({ status: 400, message: PENDING_EXPIRED_MESSAGE })
    expect(isPendingAlreadyRespondedError(error)).toBe(false)
  })
})
