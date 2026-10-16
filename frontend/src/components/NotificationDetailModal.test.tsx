import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import type { AppNotification } from '@/types/index'
import { renderWithProviders } from '@/test/renderWithProviders'
import { NotificationDetailModal } from './NotificationDetailModal'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  request: vi.fn(),
}))
vi.mock('@/lib/axios', () => ({ default: apiMock }))

const markAsRead = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ markAsRead }),
}))

const toastMock = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: toastMock }))

const SESSION_ID = 'session-9'
const VISIT_ID = '99999999-9999-4999-8999-999999999999'

function httpError(status: number): AxiosError {
  const config: InternalAxiosRequestConfig = { headers: new AxiosHeaders() }
  const response: AxiosResponse = { status, statusText: '', headers: {}, config, data: {} }
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', config, undefined, response)
}

function visitorNotification(data: Record<string, unknown>): AppNotification {
  return {
    id: 'notif-9',
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
        visitor: { name: 'Ana Visitante' },
        ...data,
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NotificationDetailModal: respuesta a un visitante', () => {
  it('envía { approved, visitId } (visitId desde /status si falta) y avisa si el ingreso no se registró', async () => {
    apiMock.post.mockImplementation((url: string) => {
      if (url === `/concierge/session/${SESSION_ID}/status`) {
        return Promise.resolve({ data: { active: true, visitId: VISIT_ID, residentResponse: 'pending' } })
      }
      return Promise.resolve({ data: { success: true, message: 'ok', entryRegistered: false } })
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<NotificationDetailModal notification={visitorNotification({})} isOpen onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Aprobar Acceso' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Acceso no abierto automáticamente')
    expect(apiMock.post).toHaveBeenCalledWith(`/concierge/session/${SESSION_ID}/respond`, {
      approved: true,
      visitId: VISIT_ID,
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(toastMock.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument()
  })

  it('rechazo exitoso: marca como leída y cierra', async () => {
    apiMock.post.mockResolvedValue({ data: { success: true, message: 'ok', entryRegistered: false } })
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <NotificationDetailModal notification={visitorNotification({ visitId: VISIT_ID })} isOpen onClose={onClose} />,
    )

    await user.click(screen.getByRole('button', { name: 'Rechazar' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(apiMock.post).toHaveBeenCalledWith(`/concierge/session/${SESSION_ID}/respond`, {
      approved: false,
      visitId: VISIT_ID,
    })
    expect(markAsRead).toHaveBeenCalledWith('notif-9')
  })

  it('409: muestra que la solicitud ya fue respondida o expiró', async () => {
    apiMock.post.mockRejectedValue(httpError(409))
    const user = userEvent.setup()
    renderWithProviders(
      <NotificationDetailModal notification={visitorNotification({ visitId: VISIT_ID })} isOpen onClose={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Aprobar Acceso' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('La solicitud ya fue respondida o expiró.')
    expect(screen.queryByRole('button', { name: 'Aprobar Acceso' })).not.toBeInTheDocument()
  })
})
