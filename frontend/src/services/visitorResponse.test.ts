import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { RATE_LIMIT_MESSAGE } from '@/helpers/httpErrors'
import { VISITOR_RESPONSE_MESSAGES, parseVisitorArrivalData, submitVisitorResponse } from './visitorResponse'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const SESSION_ID = 'session-1'
const VISIT_ID = '11111111-1111-4111-8111-111111111111'

function httpError(status: number, data: unknown = {}): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('submitVisitorResponse', () => {
  it.each([
    [true, true, 'approved'],
    [true, false, 'approved-not-opened'],
    [true, undefined, 'approved-not-opened'],
    [false, false, 'denied'],
  ] as const)('approved=%s, entryRegistered=%s → %s', async (approved, entryRegistered, status) => {
    apiMock.post.mockResolvedValueOnce({ data: { success: true, message: 'ok', entryRegistered } })

    const result = await submitVisitorResponse({ sessionId: SESSION_ID, visitId: VISIT_ID, approved })

    expect(result.status).toBe(status)
  })

  it.each([
    [401, 'unauthenticated', VISITOR_RESPONSE_MESSAGES.unauthenticated, false],
    [403, 'forbidden', VISITOR_RESPONSE_MESSAGES.forbidden, true],
    [404, 'not-found', VISITOR_RESPONSE_MESSAGES.notFound, true],
    [409, 'conflict', VISITOR_RESPONSE_MESSAGES.conflict, true],
    [429, 'rate-limited', RATE_LIMIT_MESSAGE, false],
  ] as const)('HTTP %s → %s', async (httpStatus, reason, message, terminal) => {
    apiMock.post.mockRejectedValueOnce(httpError(httpStatus, { message: 'detalle técnico del backend' }))

    await expect(
      submitVisitorResponse({ sessionId: SESSION_ID, visitId: VISIT_ID, approved: true }),
    ).resolves.toEqual({ status: 'error', reason, message, terminal })
  })

  it('400 muestra el mensaje del backend si es un string', async () => {
    apiMock.post.mockRejectedValueOnce(httpError(400, { message: 'La sesión ya no está activa' }))

    await expect(
      submitVisitorResponse({ sessionId: SESSION_ID, visitId: VISIT_ID, approved: true }),
    ).resolves.toMatchObject({ reason: 'invalid', message: 'La sesión ya no está activa', terminal: false })
  })

  it('sin red: mensaje de conexión, reintentable', async () => {
    apiMock.post.mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))

    await expect(
      submitVisitorResponse({ sessionId: SESSION_ID, visitId: VISIT_ID, approved: false }),
    ).resolves.toMatchObject({ reason: 'failed', message: VISITOR_RESPONSE_MESSAGES.network, terminal: false })
  })

  it('/status con visitId null: no llama a /respond', async () => {
    apiMock.post.mockResolvedValueOnce({ data: { active: true, visitId: null, residentResponse: 'pending' } })

    const result = await submitVisitorResponse({ sessionId: SESSION_ID, visitId: null, approved: true })

    expect(result).toMatchObject({ status: 'error', reason: 'missing-visit' })
    expect(apiMock.post).toHaveBeenCalledTimes(1)
    expect(apiMock.post).toHaveBeenCalledWith(`/concierge/session/${SESSION_ID}/status`)
  })
})

describe('parseVisitorArrivalData', () => {
  it('lee sessionId, visitId y los datos del visitante de la notificación', () => {
    expect(
      parseVisitorArrivalData({
        sessionId: SESSION_ID,
        visitId: VISIT_ID,
        expiresAt: '2026-10-08T12:00:00.000Z',
        visitor: { name: 'Ana', plate: 'ABCD12', rut: 42 },
      }),
    ).toEqual({
      sessionId: SESSION_ID,
      visitId: VISIT_ID,
      expiresAt: new Date('2026-10-08T12:00:00.000Z'),
      visitor: { name: 'Ana', plate: 'ABCD12', rut: undefined, phone: undefined, reason: undefined },
    })
  })

  it('sin sessionId no es una solicitud respondible', () => {
    expect(parseVisitorArrivalData({ visitId: VISIT_ID })).toBeNull()
    expect(parseVisitorArrivalData(undefined)).toBeNull()
  })

  it('visitId ausente o vacío queda en null (se pedirá a /status)', () => {
    expect(parseVisitorArrivalData({ sessionId: SESSION_ID, visitId: '' })?.visitId).toBeNull()
    expect(parseVisitorArrivalData({ sessionId: SESSION_ID })?.visitId).toBeNull()
  })
})
