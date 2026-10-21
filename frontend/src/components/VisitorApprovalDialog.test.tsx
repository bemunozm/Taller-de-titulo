import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import type { AppNotification } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { VisitorApprovalDialog } from './VisitorApprovalDialog'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const notificationsMock = vi.hoisted(() => ({
  notifications: [] as AppNotification[],
  markAsRead: vi.fn(),
}))
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => notificationsMock,
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

const SESSION_ID = 'session-1'
const VISIT_ID = '11111111-1111-4111-8111-111111111111'
const STATUS_URL = `/concierge/session/${SESSION_ID}/status`
const RESPOND_URL = `/concierge/session/${SESSION_ID}/respond`

function httpError(status: number, data: unknown = {}): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

function visitorNotification(data: Record<string, unknown>): AppNotification {
  return {
    id: 'notif-1',
    read: false,
    receivedAt: new Date(),
    payload: {
      title: 'Visitante en Portería',
      message: 'Ana está esperando en la entrada',
      type: 'VISITOR_ARRIVAL',
      requiresAction: true,
      timestamp: new Date(),
      data: {
        sessionId: SESSION_ID,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        visitor: { name: 'Ana Visitante', plate: 'ABCD12' },
        ...data,
      },
    },
  }
}

/** Mock de api.post por URL: `/status` activo y `/respond` según el caso. */
function mockBackend(respond: () => Promise<unknown>, status: Record<string, unknown> = {}) {
  apiMock.post.mockImplementation((url: string) => {
    if (url === STATUS_URL) {
      return Promise.resolve({
        data: { active: true, residentResponse: 'pending', entryRegistered: null, ...status },
      })
    }
    if (url === RESPOND_URL) {
      return respond()
    }
    return Promise.reject(new Error(`URL inesperada: ${url}`))
  })
}

function respondCalls(): unknown[][] {
  return apiMock.post.mock.calls.filter(([url]) => url === RESPOND_URL)
}

async function approve() {
  const user = userEvent.setup()
  renderWithProviders(<VisitorApprovalDialog />)
  const approveButton = await screen.findByRole('button', { name: 'Aprobar Acceso' })
  await waitFor(() => expect(approveButton).toBeEnabled())
  await user.click(approveButton)
}

beforeEach(() => {
  vi.clearAllMocks()
  notificationsMock.notifications = []
})

describe('VisitorApprovalDialog', () => {
  it('envía { approved, visitId } de la notificación, sin residentId', async () => {
    notificationsMock.notifications = [visitorNotification({ visitId: VISIT_ID })]
    mockBackend(() => Promise.resolve({ data: { success: true, message: 'ok', entryRegistered: true } }))

    await approve()

    await waitFor(() => expect(respondCalls()).toHaveLength(1))
    const [, body] = respondCalls()[0]
    expect(body).toStrictEqual({ approved: true, visitId: VISIT_ID })
    expect(body).not.toHaveProperty('residentId')
    expect(toastMock.success).toHaveBeenCalledWith('Visita aprobada. El acceso quedó habilitado.')
    expect(notificationsMock.markAsRead).toHaveBeenCalledWith('notif-1')
  })

  it('si la notificación (vieja) no trae visitId, lo toma de /status', async () => {
    notificationsMock.notifications = [visitorNotification({})]
    mockBackend(
      () => Promise.resolve({ data: { success: true, message: 'ok', entryRegistered: true } }),
      { visitId: VISIT_ID },
    )

    await approve()

    await waitFor(() => expect(respondCalls()).toHaveLength(1))
    expect(respondCalls()[0][1]).toStrictEqual({ approved: true, visitId: VISIT_ID })
  })

  it('sin visitId en la notificación ni en /status no llama a /respond y muestra error', async () => {
    notificationsMock.notifications = [visitorNotification({})]
    mockBackend(() => Promise.resolve({ data: { success: true, message: 'ok', entryRegistered: true } }))

    await approve()

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo identificar la solicitud de visita')
    expect(respondCalls()).toHaveLength(0)
  })

  it('aprobada con entryRegistered:false: aviso claro de acceso no abierto (no un éxito plano)', async () => {
    notificationsMock.notifications = [visitorNotification({ visitId: VISIT_ID })]
    mockBackend(() => Promise.resolve({ data: { success: true, message: 'ok', entryRegistered: false } }))

    await approve()

    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('Acceso no abierto automáticamente')
    expect(notice).toHaveTextContent(/no se abrió automáticamente/)
    expect(notice).toHaveTextContent(/Conserjería fue alertada/)
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprobar Acceso' })).not.toBeInTheDocument()
  })

  it('409: "la solicitud ya fue respondida o expiró" y no ofrece reintentar', async () => {
    notificationsMock.notifications = [visitorNotification({ visitId: VISIT_ID })]
    mockBackend(() => Promise.reject(httpError(409, { statusCode: 409, message: 'Conflict' })))

    await approve()

    expect(await screen.findByRole('alert')).toHaveTextContent('La solicitud ya fue respondida o expiró.')
    expect(screen.queryByRole('button', { name: 'Aprobar Acceso' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
    expect(notificationsMock.markAsRead).toHaveBeenCalledWith('notif-1')
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('403: mensaje de falta de autorización', async () => {
    notificationsMock.notifications = [visitorNotification({ visitId: VISIT_ID })]
    mockBackend(() => Promise.reject(httpError(403, { statusCode: 403, message: 'Forbidden' })))

    await approve()

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes autorización para responder esta solicitud.')
    expect(notificationsMock.markAsRead).not.toHaveBeenCalled()
  })
})
